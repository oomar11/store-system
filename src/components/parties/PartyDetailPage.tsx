"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort, smartSearchMatch } from "@/lib/utils";
import {
  buildPartyOpeningRow,
  fetchCrossAppPartyHistory,
  fetchCustomerHistory,
  fetchSupplierHistory,
  invoiceTypeLabel,
  partyPaymentToHistoryRow,
  type CrossAppLedgerLine,
  type PartyInvoiceRow,
} from "@/lib/history";
import {
  InvoiceOperationModal,
  type InvoiceOpSelection,
} from "@/components/history/InvoiceOperationModal";
import {
  deletePartyPayment,
  listPartyPayments,
  partyPaymentDocNumber,
  type PartyPaymentRow,
} from "@/lib/party-payments";
import {
  computeNetBalance,
  computeNettingOffset,
  ensureCustomerForSupplier,
  ensureSupplierForCustomer,
  linkPartyAccounts,
  settlePartyNetting,
  unlinkPartyAccounts,
} from "@/lib/party-link";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { EntityStatementPreview } from "@/components/print/EntityStatementPreview";
import { PartyStatementPreview } from "@/components/print/PartyStatementPreview";
import { PartyPaymentPrintPreview } from "@/components/print/PartyPaymentPrintPreview";
import {
  DocumentPrintPreview,
  type DocumentPrintKind,
  type PrintLineItem,
} from "@/components/print/DocumentPrintPreview";
import {
  partyHistoryColumns,
  partyPaymentPrintColumns,
} from "@/components/print/report-columns";
import type { Customer, Settings, Supplier } from "@/types";
import {
  getSnapshot,
  isBrowserOnline,
  withTimeout,
} from "@/lib/offline";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Link2,
  Link2Off,
  Printer,
  Scale,
  Trash2,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { Modal } from "@/components/ui/Modal";
import {
  BusinessLineBadges,
  BusinessLineEditor,
} from "@/components/parties/BusinessLineBadges";
import {
  normalizeBusinessLines,
  type BusinessLine,
} from "@/lib/business-lines";
import {
  businessLinesFromNotes,
  saveCustomerBusinessLinesManual,
  unlockAndRefreshCustomerBusinessLines,
} from "@/lib/customer-business-lines";
import {
  listCustomerProjectReceivables,
  type ProjectReceivableRow,
} from "@/lib/project-receivables";

type PartyKind = "customer" | "supplier";
type TypeFilter =
  | ""
  | "sale"
  | "purchase"
  | "sale_return"
  | "purchase_return"
  | "opening"
  | "collection"
  | "disbursement"
  | "settlement"
  | "workshop_sale"
  | "workshop_collection"
  | "workshop_adjustment";

interface PartyDetailPageProps {
  kind: PartyKind;
  partyId: string;
}

type InvoiceItemDetail = {
  id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  product?: {
    name?: string;
    sku?: string;
  } | null;
};

type InlineInvoicePrintState = {
  kind: DocumentPrintKind;
  documentNumber: string;
  items: PrintLineItem[];
  partyName?: string;
  partyPhone?: string;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  paid: number;
  paymentMethod?: string;
  notes?: string;
  issuedAt: string;
};

export function PartyDetailPage({ kind, partyId }: PartyDetailPageProps) {
  const router = useRouter();
  const supabase = createClient();
  const { profile, canWriteCustomers, canAccessSuppliers } = useAuth();
  const { info: toastInfo, success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const listHref = kind === "customer" ? "/customers" : "/suppliers";
  const listLabel = kind === "customer" ? "العملاء" : "الموردون";
  const entityLabel = kind === "customer" ? "العميل" : "المورد";
  const canManageLink = canWriteCustomers || canAccessSuppliers;

  const [party, setParty] = useState<(Customer | Supplier) | null>(null);
  const [linkedParty, setLinkedParty] = useState<(Customer | Supplier) | null>(
    null
  );
  const [projectReceivables, setProjectReceivables] = useState<
    ProjectReceivableRow[]
  >([]);
  const [editLines, setEditLines] = useState<BusinessLine[]>([]);
  const [linesBusy, setLinesBusy] = useState(false);
  const [rows, setRows] = useState<PartyInvoiceRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [selectedOp, setSelectedOp] = useState<InvoiceOpSelection | null>(null);
  const [showMovementsPrint, setShowMovementsPrint] = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const [showDetailedStatement, setShowDetailedStatement] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [partyPayments, setPartyPayments] = useState<PartyPaymentRow[]>([]);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(
    null
  );
  const [printPayment, setPrintPayment] = useState<PartyPaymentRow | null>(
    null
  );
  const [showPaymentsPrint, setShowPaymentsPrint] = useState(false);
  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState<Record<string, boolean>>(
    {}
  );
  const [invoiceItemsByInvoiceId, setInvoiceItemsByInvoiceId] = useState<
    Record<string, InvoiceItemDetail[]>
  >({});
  const [itemsLoadingByInvoiceId, setItemsLoadingByInvoiceId] = useState<
    Record<string, boolean>
  >({});
  const [inlinePrintState, setInlinePrintState] =
    useState<InlineInvoicePrintState | null>(null);
  const [inlinePrintLoadingId, setInlinePrintLoadingId] = useState<string | null>(null);
  const [showBalanceDetails, setShowBalanceDetails] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkCandidates, setLinkCandidates] = useState<
    { id: string; name: string; phone?: string | null; balance: number }[]
  >([]);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);

  function paymentHref(paymentId?: string) {
    const base =
      kind === "customer"
        ? `/customers/${partyId}/payments`
        : `/suppliers/${partyId}/payments`;
    return paymentId ? `${base}/${paymentId}` : `${base}/new`;
  }

  async function refreshData(opts?: { isStale?: () => boolean }) {
    const stale = () => opts?.isStale?.() === true;
    setExpandedInvoiceIds({});
    setInvoiceItemsByInvoiceId({});
    setItemsLoadingByInvoiceId({});
    setInlinePrintState(null);
    setInlinePrintLoadingId(null);

    // Local-first: party header from snapshot when offline / slow net
    if (!isBrowserOnline()) {
      const snap = await getSnapshot();
      const fromSnap =
        kind === "customer"
          ? snap?.customers.find((c) => c.id === partyId)
          : snap?.suppliers.find((s) => s.id === partyId);
      if (fromSnap) {
        const linkedId =
          kind === "customer"
            ? fromSnap.linked_supplier_id
            : fromSnap.linked_customer_id;
        const linkedFromSnap = linkedId
          ? kind === "customer"
            ? snap?.suppliers.find((s) => s.id === linkedId)
            : snap?.customers.find((c) => c.id === linkedId)
          : null;
        const partyData = {
          id: fromSnap.id,
          name: fromSnap.name,
          phone: fromSnap.phone || undefined,
          balance: fromSnap.balance,
          linked_supplier_id:
            kind === "customer" ? fromSnap.linked_supplier_id : undefined,
          linked_customer_id:
            kind === "supplier" ? fromSnap.linked_customer_id : undefined,
          business_lines:
            kind === "customer"
              ? normalizeBusinessLines(fromSnap.business_lines)
              : undefined,
          business_lines_locked:
            kind === "customer"
              ? fromSnap.business_lines_locked === true
              : undefined,
          created_at: "",
        } as Customer | Supplier;
        const linkedData = linkedFromSnap
          ? ({
              id: linkedFromSnap.id,
              name: linkedFromSnap.name,
              phone: linkedFromSnap.phone || undefined,
              balance: linkedFromSnap.balance,
              created_at: "",
            } as Customer | Supplier)
          : null;
        const openingRows = [
          buildPartyOpeningRow(partyData),
          linkedData ? buildPartyOpeningRow(linkedData) : null,
        ].filter(Boolean) as PartyInvoiceRow[];
        const recent = (snap?.recentInvoices || [])
          .filter((inv) => {
            if (kind === "customer") {
              return (
                inv.customer_id === partyId ||
                (linkedId != null && inv.supplier_id === linkedId)
              );
            }
            return (
              inv.supplier_id === partyId ||
              (linkedId != null && inv.customer_id === linkedId)
            );
          })
          .map(
            (inv) =>
              ({
                id: inv.id,
                invoice_number: inv.invoice_number,
                type: inv.type,
                status: inv.status,
                total: inv.total,
                paid_amount: inv.paid_amount,
                created_at: inv.created_at,
                payment_method: inv.payment_method,
              }) as PartyInvoiceRow
          );
        if (stale()) return;
        setParty(partyData);
        if (kind === "customer") {
          setEditLines(
            normalizeBusinessLines((partyData as Customer).business_lines)
          );
          setProjectReceivables([]);
        }
        setLinkedParty(linkedData);
        setRows(
          [...openingRows, ...recent].sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        );
        if (snap?.settings) setSettings(snap.settings as unknown as Settings);
        setPartyPayments([]);
        setLoading(false);
        return;
      }
      if (stale()) return;
      setParty(null);
      setLinkedParty(null);
      setRows([]);
      setProjectReceivables([]);
      setLoading(false);
      return;
    }

    try {
      const table = kind === "customer" ? "customers" : "suppliers";
      const [partyRes, history, crossAppHistory, settingsRes, payments] =
        await withTimeout(
          Promise.all([
            supabase.from(table).select("*").eq("id", partyId).maybeSingle(),
            kind === "customer"
              ? fetchCustomerHistory(partyId)
              : fetchSupplierHistory(partyId),
            fetchCrossAppPartyHistory(kind, partyId),
            supabase.from("settings").select("*").limit(1).maybeSingle(),
            listPartyPayments(supabase, kind, partyId).catch(
              () => [] as PartyPaymentRow[]
            ),
          ]),
          5000
        );

      if (stale()) return;

      if (!partyRes.data) {
        setParty(null);
        setLinkedParty(null);
        setRows([]);
        setPartyPayments([]);
        setProjectReceivables([]);
        setLoading(false);
        return;
      }

      const partyData = partyRes.data as Customer | Supplier;
      const linkedId =
        kind === "customer"
          ? (partyData as Customer).linked_supplier_id
          : (partyData as Supplier).linked_customer_id;

      let linkedData: Customer | Supplier | null = null;
      let linkedHistory: PartyInvoiceRow[] = [];
      let linkedCrossApp: PartyInvoiceRow[] = [];
      let linkedPayments: PartyPaymentRow[] = [];

      if (linkedId) {
        const linkedTable = kind === "customer" ? "suppliers" : "customers";
        const linkedKind = kind === "customer" ? "supplier" : "customer";
        const [linkedRes, linkedHist, linkedXApp, linkedPays] =
          await Promise.all([
            supabase
              .from(linkedTable)
              .select("*")
              .eq("id", linkedId)
              .maybeSingle(),
            kind === "customer"
              ? fetchSupplierHistory(linkedId)
              : fetchCustomerHistory(linkedId),
            fetchCrossAppPartyHistory(linkedKind, linkedId),
            listPartyPayments(supabase, linkedKind, linkedId).catch(
              () => [] as PartyPaymentRow[]
            ),
          ]);
        if (linkedRes.data) {
          linkedData = linkedRes.data as Customer | Supplier;
          linkedHistory = linkedHist;
          linkedCrossApp = linkedXApp;
          linkedPayments = linkedPays;
        }
      }

      const openingRows = [
        buildPartyOpeningRow(partyData),
        linkedData ? buildPartyOpeningRow(linkedData) : null,
      ].filter(Boolean) as PartyInvoiceRow[];
      const allPayments = [...payments, ...linkedPayments];
      // Dedupe settlement pair rows that appear on both sides of combined view
      const seenPaymentIds = new Set<string>();
      const paymentRows = allPayments
        .filter((p) => {
          if (seenPaymentIds.has(p.id)) return false;
          if (p.settlement_group_id) {
            const twin = allPayments.find(
              (x) =>
                x.id !== p.id &&
                x.settlement_group_id === p.settlement_group_id
            );
            if (twin) {
              seenPaymentIds.add(p.id);
              seenPaymentIds.add(twin.id);
              // Keep one settlement row (customer side preferred)
              return p.party_type === "customer" || !twin;
            }
          }
          seenPaymentIds.add(p.id);
          return true;
        })
        .map(partyPaymentToHistoryRow);

      const merged = [
        ...openingRows,
        ...history,
        ...linkedHistory,
        ...crossAppHistory,
        ...linkedCrossApp,
        ...paymentRows,
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      if (stale()) return;
      setParty(partyData);
      setLinkedParty(linkedData);
      setRows(merged);
      setPartyPayments(payments);
      if (kind === "customer") {
        const cust = partyData as Customer;
        const lines = normalizeBusinessLines(
          cust.business_lines?.length
            ? cust.business_lines
            : businessLinesFromNotes(cust.notes)
        );
        setEditLines(lines);
        setParty({ ...cust, business_lines: lines });
        try {
          const owed = await listCustomerProjectReceivables(supabase, partyId);
          if (stale()) return;
          setProjectReceivables(
            owed.filter((row) => row.customerId === partyId)
          );
        } catch {
          if (stale()) return;
          setProjectReceivables([]);
        }
      } else {
        setProjectReceivables([]);
      }
      if (settingsRes.data) setSettings(settingsRes.data);
      setLoading(false);
    } catch {
      if (stale()) return;
      // Fall back to snapshot on timeout / network
      const snap = await getSnapshot();
      if (stale()) return;
      const fromSnap =
        kind === "customer"
          ? snap?.customers.find((c) => c.id === partyId)
          : snap?.suppliers.find((s) => s.id === partyId);
      if (fromSnap) {
        setParty({
          id: fromSnap.id,
          name: fromSnap.name,
          phone: fromSnap.phone || undefined,
          balance: fromSnap.balance,
          linked_supplier_id:
            kind === "customer" ? fromSnap.linked_supplier_id : undefined,
          linked_customer_id:
            kind === "supplier" ? fromSnap.linked_customer_id : undefined,
          created_at: "",
        } as Customer | Supplier);
        const linkedId =
          kind === "customer"
            ? fromSnap.linked_supplier_id
            : fromSnap.linked_customer_id;
        const linkedFromSnap = linkedId
          ? kind === "customer"
            ? snap?.suppliers.find((s) => s.id === linkedId)
            : snap?.customers.find((c) => c.id === linkedId)
          : null;
        setLinkedParty(
          linkedFromSnap
            ? ({
                id: linkedFromSnap.id,
                name: linkedFromSnap.name,
                phone: linkedFromSnap.phone || undefined,
                balance: linkedFromSnap.balance,
                created_at: "",
              } as Customer | Supplier)
            : null
        );
        if (snap?.settings) setSettings(snap.settings as unknown as Settings);
      }
      setProjectReceivables([]);
      setLoading(false);
    }
  }

  function isInvoiceRow(row: PartyInvoiceRow) {
    return (
      row.type === "sale" ||
      row.type === "purchase" ||
      row.type === "sale_return" ||
      row.type === "purchase_return"
    );
  }

  function workshopDetailLines(row: PartyInvoiceRow): CrossAppLedgerLine[] {
    return row.crossAppDetails?.lines || [];
  }

  function hasWorkshopDetails(row: PartyInvoiceRow) {
    return Boolean(row.isCrossApp && workshopDetailLines(row).length > 0);
  }

  function canExpandDetails(row: PartyInvoiceRow) {
    return isInvoiceRow(row) || Boolean(row.isCrossApp);
  }

  async function loadInvoiceItems(invoiceId: string) {
    if (invoiceItemsByInvoiceId[invoiceId] || itemsLoadingByInvoiceId[invoiceId]) return;
    setItemsLoadingByInvoiceId((prev) => ({ ...prev, [invoiceId]: true }));
    try {
      const { data, error } = await supabase
        .from("invoice_items")
        .select("id, quantity, unit_price, discount, total, product:products(name, sku)")
        .eq("invoice_id", invoiceId)
        .order("id", { ascending: true });
      if (error) throw error;
      setInvoiceItemsByInvoiceId((prev) => ({
        ...prev,
        [invoiceId]: (data || []) as unknown as InvoiceItemDetail[],
      }));
    } catch {
      toastError("تعذر تحميل تفاصيل الفاتورة");
    } finally {
      setItemsLoadingByInvoiceId((prev) => ({ ...prev, [invoiceId]: false }));
    }
  }

  async function toggleInvoiceDetails(row: PartyInvoiceRow) {
    if (!canExpandDetails(row)) return;
    const isExpanded = !!expandedInvoiceIds[row.id];
    if (isExpanded) {
      setExpandedInvoiceIds((prev) => ({ ...prev, [row.id]: false }));
      return;
    }
    setExpandedInvoiceIds((prev) => ({ ...prev, [row.id]: true }));
    if (isInvoiceRow(row)) {
      await loadInvoiceItems(row.id);
    }
  }

  async function printInvoiceDetails(row: PartyInvoiceRow) {
    if (!isInvoiceRow(row) || inlinePrintLoadingId) return;
    setInlinePrintLoadingId(row.id);
    try {
      const [{ data: invoice, error: invErr }, { data: lines, error: linesErr }] =
        await Promise.all([
          supabase
            .from("invoices")
            .select(
              "*, customer:customers(name, phone), supplier:suppliers(name, phone)"
            )
            .eq("id", row.id)
            .single(),
          supabase
            .from("invoice_items")
            .select("*, product:products(name, sku)")
            .eq("invoice_id", row.id),
        ]);
      if (invErr || !invoice) throw new Error(invErr?.message || "الفاتورة غير موجودة");
      if (linesErr) throw new Error(linesErr.message);

      const printKind = invoice.type as DocumentPrintKind;
      if (
        printKind !== "sale" &&
        printKind !== "purchase" &&
        printKind !== "sale_return" &&
        printKind !== "purchase_return"
      ) {
        throw new Error("نوع الفاتورة غير مدعوم للطباعة التفصيلية");
      }

      setInlinePrintState({
        kind: printKind,
        documentNumber: String(invoice.invoice_number || row.invoice_number),
        items:
          (lines || []).map((line) => ({
            name: line.product?.name || "صنف",
            sku: line.product?.sku || "",
            quantity: Number(line.quantity),
            unit_price: Number(line.unit_price),
            discount: Number(line.discount) || 0,
            total: Number(line.total),
          })) || [],
        partyName: invoice.customer?.name || invoice.supplier?.name || party?.name,
        partyPhone: invoice.customer?.phone || invoice.supplier?.phone || party?.phone,
        subtotal:
          Number(invoice.subtotal) ||
          (lines || []).reduce((sum, line) => sum + Number(line.total), 0),
        discount: Number(invoice.discount_amount) || 0,
        taxAmount: Number(invoice.tax_amount) || 0,
        total: Number(invoice.total) || 0,
        paid: Number(invoice.paid_amount) || 0,
        paymentMethod: invoice.payment_method || undefined,
        notes: invoice.notes || undefined,
        issuedAt: String(invoice.created_at || row.created_at),
      });
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر تجهيز الفاتورة للطباعة");
    } finally {
      setInlinePrintLoadingId(null);
    }
  }

  async function handleDeletePayment(payment: PartyPaymentRow) {
    if (deletingPaymentId) return;
    if (
      !(await confirm({
        message: payment.is_settlement
          ? `حذف مقاصة ${formatCurrency(payment.amount)}؟ سيرجع رصيد العميل والمورد كما كانا (بدون خزنة).`
          : kind === "customer"
            ? `حذف تحصيل ${formatCurrency(payment.amount)}؟ سترجع الفواتير والرصيد والخزنة كما كانوا.`
            : `حذف سداد ${formatCurrency(payment.amount)}؟ سترجع الفواتير والرصيد والخزنة كما كانوا.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;

    setDeletingPaymentId(payment.id);
    setPaymentBusy(true);
    try {
      await deletePartyPayment(supabase, payment.id);
      toastSuccess(
        payment.is_settlement ? "تم حذف المقاصة" : "تم حذف الدفعة وعكس التوزيع"
      );
      await refreshData();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر حذف الدفعة");
    } finally {
      setDeletingPaymentId(null);
      setPaymentBusy(false);
    }
  }

  async function loadLinkCandidates(term: string) {
    setLinkLoading(true);
    try {
      const targetTable = kind === "customer" ? "suppliers" : "customers";
      const linkCol =
        kind === "customer" ? "linked_customer_id" : "linked_supplier_id";
      let q = supabase
        .from(targetTable)
        .select("id, name, phone, balance")
        .is(linkCol, null)
        .eq("is_active", true)
        .order("name")
        .limit(40);
      if (term.trim()) {
        q = q.or(`name.ilike.%${term.trim()}%,phone.ilike.%${term.trim()}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      setLinkCandidates(
        (data || []).map((r) => ({
          id: r.id as string,
          name: String(r.name || ""),
          phone: (r.phone as string | null) || null,
          balance: Number(r.balance) || 0,
        }))
      );
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر جلب القائمة");
      setLinkCandidates([]);
    } finally {
      setLinkLoading(false);
    }
  }

  async function handleLinkExisting(otherId: string) {
    if (!party || linkBusy) return;
    setLinkBusy(true);
    try {
      if (kind === "customer") {
        await linkPartyAccounts(supabase, party.id, otherId);
      } else {
        await linkPartyAccounts(supabase, otherId, party.id);
      }
      toastSuccess("تم ربط الحسابين");
      setShowLinkModal(false);
      await refreshData();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر الربط");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleEnsureDualRole() {
    if (!party || linkBusy) return;
    setLinkBusy(true);
    try {
      if (kind === "customer") {
        await ensureSupplierForCustomer(supabase, party.id);
        toastSuccess("تم إنشاء مورد مربوط بنفس البيانات");
      } else {
        await ensureCustomerForSupplier(supabase, party.id);
        toastSuccess("تم إنشاء عميل مربوط بنفس البيانات");
      }
      setShowLinkModal(false);
      await refreshData();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر التفعيل");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleUnlink() {
    if (!party || !linkedParty) return;
    if (
      !(await confirm({
        message:
          "فك الربط بين العميل والمورد؟ الأرصدة والحركات تبقى كما هي على كل حساب.",
        tone: "danger",
        confirmLabel: "فك الربط",
      }))
    )
      return;
    setLinkBusy(true);
    try {
      await unlinkPartyAccounts(supabase, {
        customerId: kind === "customer" ? party.id : linkedParty.id,
        supplierId: kind === "supplier" ? party.id : linkedParty.id,
      });
      toastSuccess("تم فك الربط");
      await refreshData();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر فك الربط");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleSettleNetting() {
    if (!party || !linkedParty) return;
    const customerBalance =
      kind === "customer" ? party.balance : linkedParty.balance;
    const supplierBalance =
      kind === "supplier" ? party.balance : linkedParty.balance;
    const offset = computeNettingOffset(customerBalance, supplierBalance);
    if (offset <= 0) {
      toastInfo("لا يوجد مبلغ قابل للمقاصة");
      return;
    }
    if (
      !(await confirm({
        message: `مقاصة ${formatCurrency(offset)} بين عليه/علينا؟ الرصيد الصافي لن يتغير، ويُصفَّى الدين المزدوج بدون حركة خزنة.`,
        confirmLabel: "تنفيذ المقاصة",
      }))
    )
      return;
    setLinkBusy(true);
    try {
      const result = await settlePartyNetting(supabase, {
        customerId: kind === "customer" ? party.id : linkedParty.id,
        supplierId: kind === "supplier" ? party.id : linkedParty.id,
      });
      toastSuccess(`تمت المقاصة بمبلغ ${formatCurrency(result.offset)}`);
      await refreshData();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر إجراء المقاصة");
    } finally {
      setLinkBusy(false);
    }
  }

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      // Drop previous customer's owed projects before the new fetch settles.
      setProjectReceivables([]);
      await refreshData({ isStale: () => cancelled });
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, kind]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (typeFilter && row.type !== typeFilter) return false;
      return smartSearchMatch(searchTerm, [
        row.invoice_number,
        invoiceTypeLabel(row.type, row.sourceSystem),
        row.notes,
      ]);
    });
  }, [rows, searchTerm, typeFilter]);
  const visibleInvoiceRows = useMemo(
    () =>
      filtered.filter(
        (row) =>
          row.type === "sale" ||
          row.type === "purchase" ||
          row.type === "sale_return" ||
          row.type === "purchase_return" ||
          Boolean(row.isCrossApp)
      ),
    [filtered]
  );
  const allVisibleDetailsExpanded =
    visibleInvoiceRows.length > 0 &&
    visibleInvoiceRows.every((row) => expandedInvoiceIds[row.id]);
  const expandedVisibleCount = visibleInvoiceRows.reduce(
    (count, row) => (expandedInvoiceIds[row.id] ? count + 1 : count),
    0
  );

  async function expandAllVisibleInvoiceDetails() {
    if (visibleInvoiceRows.length === 0) return;
    setExpandedInvoiceIds((prev) => {
      const next = { ...prev };
      for (const row of visibleInvoiceRows) next[row.id] = true;
      return next;
    });
    await Promise.all(
      visibleInvoiceRows
        .filter((row) => isInvoiceRow(row))
        .map((row) => loadInvoiceItems(row.id))
    );
  }

  function collapseAllVisibleInvoiceDetails() {
    if (visibleInvoiceRows.length === 0) return;
    setExpandedInvoiceIds((prev) => {
      const next = { ...prev };
      for (const row of visibleInvoiceRows) next[row.id] = false;
      return next;
    });
  }

  const totalAmount = filtered
    .filter(
      (r) =>
        r.type !== "opening" &&
        r.type !== "collection" &&
        r.type !== "disbursement" &&
        r.type !== "settlement"
    )
    .reduce((s, r) => s + Number(r.total), 0);
  const totalPaid = filtered
    .filter(
      (r) =>
        r.type !== "opening" &&
        r.type !== "collection" &&
        r.type !== "disbursement" &&
        r.type !== "settlement"
    )
    .reduce((s, r) => s + Number(r.paid_amount), 0);
  const unpaidInvoicesCount = useMemo(() => {
    return rows.filter(
      (r) =>
        (r.type === "sale" || r.type === "purchase") &&
        !r.isOpening &&
        !r.isPartyPayment &&
        Number(r.paid_amount) + 0.001 < Number(r.total)
    ).length;
  }, [rows]);

  const customerBalanceForNet =
    kind === "customer"
      ? party?.balance ?? 0
      : linkedParty?.balance ?? 0;
  const supplierBalanceForNet =
    kind === "supplier"
      ? party?.balance ?? 0
      : linkedParty?.balance ?? 0;
  const isDualLinked = Boolean(linkedParty);
  const netBalance = isDualLinked
    ? computeNetBalance(customerBalanceForNet, supplierBalanceForNet)
    : null;
  const nettingOffset = isDualLinked
    ? computeNettingOffset(customerBalanceForNet, supplierBalanceForNet)
    : 0;
  const linkedHref = linkedParty
    ? kind === "customer"
      ? `/suppliers/${linkedParty.id}`
      : `/customers/${linkedParty.id}`
    : null;

  function openOperation(row: PartyInvoiceRow) {
    if (row.isOpening || row.type === "opening") {
      toastInfo(
        `هذا رصيد افتتاحي — يمكن تعديله من تعديل ${entityLabel} (حقل الرصيد الافتتاحي).`
      );
      return;
    }
    if (row.isCrossApp) {
      void toggleInvoiceDetails(row);
      return;
    }
    if (row.isPartyPayment && row.partyPaymentId) {
      if (row.type === "settlement") {
        toastInfo("هذه حركة مقاصة — يمكن حذفها من جدول التحصيلات/السدادات إن لزم.");
        return;
      }
      router.push(paymentHref(row.partyPaymentId));
      return;
    }
    setSelectedOp({
      invoiceId: row.id,
      invoiceNumber: row.invoice_number,
      type: row.type,
      party: party?.name || "—",
      createdAt: row.created_at,
    });
  }

  function balanceLabel(balance: number, forKind: PartyKind = kind) {
    if (forKind === "customer") {
      if (balance > 0) return `${formatCurrency(balance)} (عليه)`;
      if (balance < 0) return `${formatCurrency(Math.abs(balance))} (له)`;
      return formatCurrency(0);
    }
    if (balance > 0) return `${formatCurrency(balance)} (علينا)`;
    if (balance < 0) return `${formatCurrency(Math.abs(balance))} (لنا)`;
    return formatCurrency(0);
  }

  function balanceTone(balance: number): "danger" | "success" | "default" {
    if (balance > 0) return "danger";
    if (balance < 0) return "success";
    return "default";
  }

  function netTone(
    side: "us" | "them" | "zero" | undefined
  ): "danger" | "success" | "default" {
    if (side === "them") return "success";
    if (side === "us") return "danger";
    return "default";
  }

  async function copyPhone(phone: string) {
    try {
      await navigator.clipboard.writeText(phone);
      toastSuccess(`تم نسخ ${phone}`);
    } catch {
      toastError("تعذر نسخ رقم الهاتف");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
      </div>
    );
  }

  if (!party) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
        <p className="font-bold text-rose-800">{entityLabel} غير موجود</p>
        <Link
          href={listHref}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#1473e6]"
        >
          <ArrowRight className="h-4 w-4" />
          العودة لـ{listLabel}
        </Link>
      </div>
    );
  }

  const Icon = kind === "customer" ? User : Users;
  const typeOptions = isDualLinked
    ? ([
        ["", "كل الأنواع"],
        ["sale", "بيع"],
        ["purchase", "شراء"],
        ["sale_return", "مرتجع بيع"],
        ["purchase_return", "مرتجع شراء"],
        ["collection", "تحصيل"],
        ["disbursement", "سداد"],
        ["settlement", "مقاصة"],
        ["workshop_sale", "فاتورة ورشة"],
        ["workshop_collection", "تحصيل ورشة"],
        ["workshop_adjustment", "تسوية ورشة"],
        ["opening", "رصيد افتتاحي"],
      ] as const)
    : kind === "customer"
      ? ([
          ["", "كل الأنواع"],
          ["sale", "بيع"],
          ["sale_return", "مرتجع بيع"],
          ["collection", "تحصيل"],
          ["settlement", "مقاصة"],
          ["workshop_sale", "فاتورة ورشة"],
          ["workshop_collection", "تحصيل ورشة"],
          ["workshop_adjustment", "تسوية ورشة"],
          ["opening", "رصيد افتتاحي"],
        ] as const)
      : ([
          ["", "كل الأنواع"],
          ["purchase", "شراء"],
          ["purchase_return", "مرتجع شراء"],
          ["disbursement", "سداد"],
          ["settlement", "مقاصة"],
          ["workshop_sale", "فاتورة ورشة"],
          ["workshop_collection", "تحصيل ورشة"],
          ["workshop_adjustment", "تسوية ورشة"],
          ["opening", "رصيد افتتاحي"],
        ] as const);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.push(listHref)}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1473e6] hover:underline"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            {listLabel}
          </button>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eaf4ff] text-[#1473e6]">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-[#172033]">{party.name}</h1>
                {isDualLinked ? (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                    عميل+مورد
                  </span>
                ) : null}
              </div>
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-[#687386]">
                {party.phone ? (
                  <>
                    <span>{party.phone}</span>
                    <button
                      type="button"
                      onClick={() => void copyPhone(party.phone!)}
                      className="inline-flex items-center gap-0.5 rounded-md border border-[#e1e6ee] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#687386] hover:border-[#9ec5f5] hover:bg-[#f8faff] hover:text-[#1473e6]"
                      title="نسخ رقم الهاتف"
                    >
                      <Copy className="h-3 w-3" />
                      نسخ
                    </button>
                  </>
                ) : (
                  "بدون هاتف"
                )}
                {party.address ? ` · ${party.address}` : ""}
              </p>
              {linkedParty && linkedHref ? (
                <Link
                  href={linkedHref}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#1473e6] hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  الحساب المربوط: {linkedParty.name}
                </Link>
              ) : null}
              {kind === "customer" ? (
                <div className="mt-2">
                  <BusinessLineBadges
                    lines={(party as Customer).business_lines}
                    size="md"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => router.push(paymentHref())}
            title={
              kind === "customer"
                ? "تحصيل من العميل — حتى لو مفيش فواتير، الرصيد يفضل على الحساب"
                : "سداد للمورد — حتى لو مفيش فواتير، يتسجّل كمقدم على الحساب"
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1473e6] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0b5fc4]"
          >
            <Wallet className="h-4 w-4" />
            {kind === "customer" ? "تحصيل" : "سداد"}
          </button>
          <button
            type="button"
            onClick={() => setShowDetailedStatement(true)}
            className="rounded-xl border border-[#9ec5f5] bg-[#eaf4ff] px-4 py-2.5 text-sm font-bold text-[#0b5fc4] hover:bg-[#dcecff]"
          >
            كشف حساب
          </button>
          <button
            type="button"
            onClick={() => setShowStatement(true)}
            className="rounded-xl border border-[#d7e0ea] bg-white px-4 py-2.5 text-sm font-bold text-[#526176] hover:bg-[#f7f9fc]"
          >
            كشف مختصر
          </button>
          {canManageLink && !isDualLinked ? (
            <button
              type="button"
              disabled={linkBusy}
              onClick={() => {
                setShowLinkModal(true);
                setLinkSearch("");
                void loadLinkCandidates("");
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
            >
              <Link2 className="h-4 w-4" />
              {kind === "customer" ? "ربط كمورد" : "ربط كعميل"}
            </button>
          ) : null}
          {canManageLink && isDualLinked ? (
            <>
              {nettingOffset > 0 ? (
                <button
                  type="button"
                  disabled={linkBusy}
                  onClick={() => void handleSettleNetting()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  <Scale className="h-4 w-4" />
                  مقاصة {formatCurrency(nettingOffset)}
                </button>
              ) : null}
              <button
                type="button"
                disabled={linkBusy}
                onClick={() => void handleUnlink()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Link2Off className="h-4 w-4" />
                فك الربط
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isDualLinked && netBalance ? (
          <DetailCard
            label="الرصيد الصافي"
            value={netBalance.label}
            tone={netTone(netBalance.side)}
            highlight={netBalance.side !== "zero"}
            badge={
              netBalance.side === "them"
                ? "مستحق لنا"
                : netBalance.side === "us"
                  ? "مستحق علينا"
                  : "متصفّر"
            }
          />
        ) : (
          <DetailCard
            label="الرصيد الحالي"
            value={balanceLabel(party.balance)}
            tone={balanceTone(party.balance)}
            highlight={party.balance !== 0}
            badge={
              party.balance > 0
                ? kind === "customer"
                  ? "غير مسدد"
                  : "مستحق علينا"
                : party.balance < 0
                  ? kind === "customer"
                    ? "رصيد دائن"
                    : "رصيد لنا"
                  : undefined
            }
          />
        )}
        <DetailCard
          label="رصيد افتتاحي"
          value={balanceLabel(party.opening_balance ?? 0)}
          tone={balanceTone(party.opening_balance ?? 0)}
        />
        <DetailCard
          label="فواتير غير مسددة"
          value={String(unpaidInvoicesCount)}
          tone={unpaidInvoicesCount > 0 ? "danger" : "default"}
          highlight={unpaidInvoicesCount > 0}
        />
        <DetailCard
          label="عدد العمليات"
          value={String(filtered.length)}
        />
      </div>

      {isDualLinked && linkedParty ? (
        <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
          <button
            type="button"
            onClick={() => setShowBalanceDetails((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-bold text-violet-900"
          >
            <span>تفاصيل الأرصدة (مبيعات / مشتريات)</span>
            {showBalanceDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {showBalanceDetails ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
              <div className="rounded-lg bg-white/80 px-3 py-2 border border-violet-100">
                <p className="text-xs text-[#687386]">مبيعات (عميل)</p>
                <p className="font-bold text-[#172033]">
                  {balanceLabel(
                    kind === "customer" ? party.balance : linkedParty.balance,
                    "customer"
                  )}
                </p>
              </div>
              <div className="rounded-lg bg-white/80 px-3 py-2 border border-violet-100">
                <p className="text-xs text-[#687386]">مشتريات (مورد)</p>
                <p className="font-bold text-[#172033]">
                  {balanceLabel(
                    kind === "supplier" ? party.balance : linkedParty.balance,
                    "supplier"
                  )}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {kind === "customer" && canWriteCustomers ? (
        <div className="rounded-xl border border-[#e1e6ee] bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#172033]">تصنيف العميل</h2>
              <p className="text-xs text-[#687386]">
                سلك · محل · ورشة — التعديل يقفل التحديث التلقائي
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={linesBusy}
                onClick={() => {
                  void (async () => {
                    setLinesBusy(true);
                    try {
                      const next = await saveCustomerBusinessLinesManual(
                        supabase,
                        partyId,
                        editLines,
                        { locked: true }
                      );
                      setParty((prev) =>
                        prev
                          ? ({
                              ...prev,
                              business_lines: next,
                              business_lines_manual: next,
                              business_lines_locked: true,
                            } as Customer)
                          : prev
                      );
                      toastSuccess("تم حفظ التصنيف");
                    } catch (err) {
                      toastError(
                        err instanceof Error ? err.message : "تعذر حفظ التصنيف"
                      );
                    } finally {
                      setLinesBusy(false);
                    }
                  })();
                }}
                className="rounded-lg bg-[#1473e6] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0b5fc4] disabled:opacity-50"
              >
                حفظ التصنيف
              </button>
              <button
                type="button"
                disabled={linesBusy}
                onClick={() => {
                  void (async () => {
                    setLinesBusy(true);
                    try {
                      const next = await unlockAndRefreshCustomerBusinessLines(
                        supabase,
                        partyId
                      );
                      setEditLines(next);
                      setParty((prev) =>
                        prev
                          ? ({
                              ...prev,
                              business_lines: next,
                              business_lines_locked: false,
                            } as Customer)
                          : prev
                      );
                      toastSuccess("تم إعادة الحساب تلقائياً");
                    } catch (err) {
                      toastError(
                        err instanceof Error
                          ? err.message
                          : "تعذر إعادة الحساب"
                      );
                    } finally {
                      setLinesBusy(false);
                    }
                  })();
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                تلقائي من التعامل
              </button>
            </div>
          </div>
          <div className="mt-3">
            <BusinessLineEditor
              value={editLines}
              onChange={setEditLines}
              disabled={linesBusy}
            />
          </div>
        </div>
      ) : null}

      {kind === "customer" && projectReceivables.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[#e1e6ee] bg-white shadow-sm">
          <div className="border-b border-[#e1e6ee] px-4 py-3">
            <h2 className="font-bold text-[#172033]">مشاريع عليها فلوس</h2>
            <p className="text-xs text-[#687386]">
              المتبقي لكل مشروع/فاتورة عند هذا العميل
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">المصدر</th>
                  <th className="px-3 py-2 text-right font-medium">المشروع</th>
                  <th className="px-3 py-2 text-right font-medium">البيع</th>
                  <th className="px-3 py-2 text-right font-medium">المدفوع</th>
                  <th className="px-3 py-2 text-right font-medium">المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projectReceivables.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      <BusinessLineBadges lines={[row.source]} />
                    </td>
                    <td className="px-3 py-2 font-medium text-[#172033]">
                      {row.projectLabel}
                    </td>
                    <td className="px-3 py-2">{formatCurrency(row.sale)}</td>
                    <td className="px-3 py-2">{formatCurrency(row.paid)}</td>
                    <td className="px-3 py-2 font-bold text-red-600">
                      {formatCurrency(row.remaining)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div
        className={`relative overflow-hidden rounded-xl border border-[#e1e6ee] bg-white shadow-sm ${
          paymentBusy ? "pointer-events-none" : ""
        }`}
      >
        {paymentBusy && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
          </div>
        )}
        <div className="flex flex-col gap-3 border-b border-[#e1e6ee] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-[#172033]">عمليات {entityLabel}</h2>
            <p className="text-xs text-[#687386]">
              اختر فاتورة للطباعة/التعديل، أو تحصيل لفتح صفحة التفاصيل
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrintListButton
              onClick={() => setShowMovementsPrint(true)}
              rowCount={filtered.length}
              label="طباعة الحركة"
            />
            <button
              type="button"
              disabled={visibleInvoiceRows.length === 0}
              onClick={() => {
                void expandAllVisibleInvoiceDetails();
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              title="عرض تفاصيل كل الفواتير الظاهرة"
            >
              عرض التفاصيل للكل
            </button>
            <button
              type="button"
              disabled={visibleInvoiceRows.length === 0 || !allVisibleDetailsExpanded}
              onClick={collapseAllVisibleInvoiceDetails}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="إخفاء تفاصيل كل الفواتير الظاهرة"
            >
              إخفاء الكل
            </button>
            <span className="rounded-lg border border-[#e1e6ee] bg-[#f8fafc] px-2.5 py-1.5 text-[11px] font-bold text-[#526176]">
              التفاصيل المفتوحة: {expandedVisibleCount}/{visibleInvoiceRows.length}
            </span>
            <input
              type="text"
              placeholder="بحث برقم المستند..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="min-w-[180px] rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            >
              {typeOptions.map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="border-b border-[#dbe7f5] bg-[#eef6ff] px-4 py-2.5 text-[11px] leading-relaxed text-[#0b5fc4]">
          كشف موحّد بالتواريخ: مبيعات/مشتريات المحل + تحصيلات/سداد + حركات ورشة
          PVC والبلسية (إن وُجدت). فلتر «بيع ورشة / تحصيل ورشة» من القائمة فوق.
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-[#eef1f6] bg-[#f8fafc] px-4 py-2.5 text-xs sm:grid-cols-3">
          <div>
            <span className="text-[#687386]">عدد العمليات: </span>
            <span className="font-bold text-[#172033]">{filtered.length}</span>
          </div>
          <div>
            <span className="text-[#687386]">إجمالي الفواتير: </span>
            <span className="font-bold text-[#172033]">
              {formatCurrency(totalAmount)}
            </span>
          </div>
          <div>
            <span className="text-[#687386]">المدفوع: </span>
            <span className="font-bold text-emerald-700">
              {formatCurrency(totalPaid)}
            </span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#687386]">
            لا توجد عمليات مسجلة
          </p>
        ) : (
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#f3f6fa] text-[#526176]">
                <tr>
                  <th className="px-3 py-2.5 text-right font-semibold">التاريخ</th>
                  <th className="px-3 py-2.5 text-right font-semibold">المصدر</th>
                  <th className="px-3 py-2.5 text-right font-semibold">المستند</th>
                  <th className="px-3 py-2.5 text-right font-semibold">النوع</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الإجمالي</th>
                  <th className="px-3 py-2.5 text-right font-semibold">المدفوع</th>
                  <th className="px-3 py-2.5 text-right font-semibold">المتبقي</th>
                  <th className="px-3 py-2.5 text-right font-semibold">اختيار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f6]">
                {filtered.map((row) => {
                  const remaining =
                    row.type === "opening" ||
                    row.type === "collection" ||
                    row.type === "disbursement"
                      ? null
                      : Number(row.total) - Number(row.paid_amount);
                  const canShowDetails = canExpandDetails(row);
                  const isWorkshopRow = Boolean(row.isCrossApp);
                  const isWorkshopDetails = hasWorkshopDetails(row);
                  const isExpanded = !!expandedInvoiceIds[row.id];
                  const detailItems = invoiceItemsByInvoiceId[row.id] || [];
                  const workshopLines = workshopDetailLines(row);
                  const detailsLoading = !!itemsLoadingByInvoiceId[row.id];
                  const workshopSourceLabel =
                    row.sourceSystem === "plisse"
                      ? "بلسية"
                      : row.sourceSystem === "aa"
                        ? "PVC"
                        : "ورشة";
                  return (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => openOperation(row)}
                        className="cursor-pointer hover:bg-[#eef6ff]"
                        title={
                          row.isOpening
                            ? "رصيد افتتاحي"
                            : row.isCrossApp
                              ? "عرض تفاصيل حركة الورشة"
                              : row.isPartyPayment
                                ? "فتح تفاصيل التحصيل/السداد"
                                : "اختر العملية"
                        }
                      >
                        <td className="px-3 py-2.5 text-[#526176]">
                          {formatDateShort(row.created_at)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={
                              row.sourceSystem === "aa"
                                ? "rounded-md bg-[#fff1e6] px-1.5 py-0.5 text-[11px] font-bold text-[#9a5b1a]"
                                : row.sourceSystem === "plisse"
                                  ? "rounded-md bg-[#eee8ff] px-1.5 py-0.5 text-[11px] font-bold text-[#5b3d9a]"
                                  : "rounded-md bg-[#eef2f7] px-1.5 py-0.5 text-[11px] font-bold text-[#526176]"
                            }
                          >
                            {row.sourceSystem === "aa"
                              ? "PVC"
                              : row.sourceSystem === "plisse"
                                ? "بلسية"
                                : "محل"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#1473e6]">
                          {row.invoice_number}
                        </td>
                        <td className="px-3 py-2.5">
                          {invoiceTypeLabel(row.type, row.sourceSystem)}
                          {row.notes &&
                          (row.type === "opening" ||
                            row.isPartyPayment ||
                            row.isCrossApp) ? (
                            <span className="mt-0.5 block text-[11px] text-[#687386]">
                              {row.notes}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 font-semibold">
                          {row.type === "collection" ||
                          row.type === "disbursement" ||
                          row.type === "workshop_collection"
                            ? "—"
                            : formatCurrency(row.total)}
                        </td>
                        <td className="px-3 py-2.5 text-emerald-700">
                          {row.type === "opening"
                            ? "—"
                            : formatCurrency(row.paid_amount)}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-rose-700">
                          {remaining === null ? "—" : formatCurrency(remaining)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-lg border border-[#9ec5f5] bg-[#eaf4ff] px-2 py-1 text-[11px] font-bold text-[#0b5fc4]">
                              <ExternalLink className="h-3.5 w-3.5" />
                              {row.isPartyPayment ? "فتح" : "اختيار"}
                            </span>
                            {canShowDetails ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void toggleInvoiceDetails(row);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                                title={isExpanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}
                              >
                                {isExpanded ? (
                                  <ChevronUp className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                )}
                                {isExpanded ? "إخفاء" : "تفاصيل"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {canShowDetails && isExpanded ? (
                        <tr className="bg-[#fbfdff]">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="rounded-xl border border-[#dce8f8] bg-white p-3">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-bold text-[#35506f]">
                                  {isWorkshopRow
                                    ? isWorkshopDetails
                                      ? `تفاصيل الشغل — ${row.invoice_number}`
                                      : `تفاصيل الحركة — ${row.invoice_number}`
                                    : `تفاصيل البنود — ${row.invoice_number}`}
                                </p>
                                {isInvoiceRow(row) ? (
                                  <button
                                    type="button"
                                    disabled={inlinePrintLoadingId === row.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void printInvoiceDetails(row);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                    {inlinePrintLoadingId === row.id
                                      ? "جاري التحضير..."
                                      : "طباعة تفصيلية"}
                                  </button>
                                ) : null}
                              </div>

                              {isWorkshopRow ? (
                                isWorkshopDetails ? (
                                <div className="overflow-auto">
                                  <table className="w-full border-collapse text-xs">
                                    <thead className="bg-[#f7faff] text-[#526176]">
                                      <tr>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          الصنف
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          النظام / المقابض
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          المقاس (سم)
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          المساحة
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          سعر المتر
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          الإجمالي
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#eef1f6]">
                                      {workshopLines.map((line, idx) => (
                                        <tr key={`${row.id}-line-${idx}`}>
                                          <td className="px-2 py-1.5">
                                            <span className="font-semibold text-[#172033]">
                                              {line.product_name || "ضلفة"}
                                            </span>
                                            {line.notes ? (
                                              <span className="mt-0.5 block text-[10px] text-[#7a8699]">
                                                {line.notes}
                                              </span>
                                            ) : null}
                                          </td>
                                          <td className="px-2 py-1.5 text-[#526176]">
                                            {[
                                              line.system_label,
                                              line.handles_label,
                                              line.closure_label,
                                            ]
                                              .filter(Boolean)
                                              .join(" · ") || "—"}
                                          </td>
                                          <td className="px-2 py-1.5 font-mono">
                                            {line.width_cm != null &&
                                            line.height_cm != null
                                              ? `${line.width_cm} × ${line.height_cm}`
                                              : "—"}
                                          </td>
                                          <td className="px-2 py-1.5">
                                            {line.area_m2 != null
                                              ? `${Number(line.area_m2).toFixed(2)} م²`
                                              : "—"}
                                          </td>
                                          <td className="px-2 py-1.5">
                                            {line.unit_price != null
                                              ? formatCurrency(Number(line.unit_price))
                                              : "—"}
                                          </td>
                                          <td className="px-2 py-1.5 font-semibold text-[#172033]">
                                            {line.line_total != null
                                              ? formatCurrency(Number(line.line_total))
                                              : "—"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                ) : (
                                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                                    <div className="rounded-lg border border-[#e8eef7] bg-[#f8fbff] px-3 py-2">
                                      <p className="text-[11px] text-[#687386]">المصدر</p>
                                      <p className="font-bold text-[#172033]">
                                        ورشة {workshopSourceLabel}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-[#e8eef7] bg-[#f8fbff] px-3 py-2">
                                      <p className="text-[11px] text-[#687386]">النوع</p>
                                      <p className="font-bold text-[#172033]">
                                        {invoiceTypeLabel(row.type, row.sourceSystem)}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-[#e8eef7] bg-[#f8fbff] px-3 py-2">
                                      <p className="text-[11px] text-[#687386]">المستند</p>
                                      <p className="font-mono font-bold text-[#1473e6]">
                                        {row.invoice_number || "—"}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-[#e8eef7] bg-[#f8fbff] px-3 py-2">
                                      <p className="text-[11px] text-[#687386]">التاريخ</p>
                                      <p className="font-bold text-[#172033]">
                                        {formatDateShort(row.created_at)}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-[#e8eef7] bg-[#f8fbff] px-3 py-2">
                                      <p className="text-[11px] text-[#687386]">
                                        {row.type === "workshop_collection"
                                          ? "المبلغ المحصّل"
                                          : "الإجمالي"}
                                      </p>
                                      <p className="font-bold text-[#172033]">
                                        {formatCurrency(
                                          row.type === "workshop_collection"
                                            ? Number(row.paid_amount) || Number(row.total)
                                            : Number(row.total)
                                        )}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-[#e8eef7] bg-[#f8fbff] px-3 py-2 sm:col-span-2">
                                      <p className="text-[11px] text-[#687386]">البيان / الملاحظات</p>
                                      <p className="font-semibold text-[#35506f]">
                                        {row.notes?.trim() || "لا توجد ملاحظات إضافية"}
                                      </p>
                                      {!isWorkshopDetails ? (
                                        <p className="mt-1 text-[11px] text-[#8793a6]">
                                          ملخص من برنامج الورشة — لا توجد بنود مقاسات مسجّلة على هذه
                                          الحركة.
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              ) : detailsLoading ? (
                                <p className="text-xs text-[#687386]">
                                  جاري تحميل بنود الفاتورة...
                                </p>
                              ) : detailItems.length === 0 ? (
                                <p className="text-xs text-[#687386]">
                                  لا توجد بنود مسجلة لهذه الفاتورة
                                </p>
                              ) : (
                                <div className="overflow-auto">
                                  <table className="w-full border-collapse text-xs">
                                    <thead className="bg-[#f7faff] text-[#526176]">
                                      <tr>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          الصنف
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          الكمية
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          سعر الوحدة
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          الخصم
                                        </th>
                                        <th className="px-2 py-1.5 text-right font-semibold">
                                          الإجمالي
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#eef1f6]">
                                      {detailItems.map((item) => (
                                        <tr key={item.id}>
                                          <td className="px-2 py-1.5">
                                            <span className="font-semibold text-[#172033]">
                                              {item.product?.name || "صنف"}
                                            </span>
                                            {item.product?.sku ? (
                                              <span
                                                className="mt-0.5 block font-mono text-[10px] text-[#7a8699]"
                                                dir="ltr"
                                              >
                                                {item.product.sku}
                                              </span>
                                            ) : null}
                                          </td>
                                          <td className="px-2 py-1.5">
                                            {Number(item.quantity)}
                                          </td>
                                          <td className="px-2 py-1.5">
                                            {formatCurrency(Number(item.unit_price))}
                                          </td>
                                          <td className="px-2 py-1.5 text-rose-700">
                                            {Number(item.discount) > 0
                                              ? formatCurrency(Number(item.discount))
                                              : "—"}
                                          </td>
                                          <td className="px-2 py-1.5 font-semibold text-[#172033]">
                                            {formatCurrency(Number(item.total))}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#e1e6ee] bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-[#e1e6ee] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-[#172033]">
              سجل {kind === "customer" ? "التحصيلات" : "السدادات"}
            </h2>
            <p className="text-xs text-[#687386]">
              دفعات بمبلغ واحد موزّعة تلقائياً على الفواتير — الحذف يعكس التوزيع
            </p>
          </div>
          <PrintListButton
            onClick={() => setShowPaymentsPrint(true)}
            rowCount={partyPayments.length}
            label={kind === "customer" ? "طباعة التحصيلات" : "طباعة السدادات"}
          />
        </div>
        {partyPayments.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#687386]">
            لا توجد دفعات مجمّعة بعد
          </p>
        ) : (
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#f3f6fa] text-[#526176]">
                <tr>
                  <th className="px-3 py-2.5 text-right font-semibold">التاريخ</th>
                  <th className="px-3 py-2.5 text-right font-semibold">المستند</th>
                  <th className="px-3 py-2.5 text-right font-semibold">المبلغ</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الخزنة</th>
                  <th className="px-3 py-2.5 text-right font-semibold">التوزيع</th>
                  <th className="px-3 py-2.5 text-right font-semibold">ملاحظة</th>
                  <th className="px-3 py-2.5 text-right font-semibold">فتح</th>
                  <th className="px-3 py-2.5 text-right font-semibold">طباعة</th>
                  <th className="px-3 py-2.5 text-right font-semibold">حذف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f6]">
                {partyPayments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="cursor-pointer hover:bg-[#eef6ff]"
                    onClick={() => router.push(paymentHref(payment.id))}
                  >
                    <td className="px-3 py-2.5 text-[#526176]">
                      {formatDateShort(payment.created_at)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#1473e6]">
                      {partyPaymentDocNumber(payment.id, kind)}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-[#172033]">
                      {formatCurrency(payment.amount)}
                    </td>
                    <td className="px-3 py-2.5 text-[#526176]">
                      {payment.safe_name || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#687386]">
                      {(payment.allocations || [])
                        .map(
                          (a) =>
                            `${a.invoice_number || "فاتورة"}: ${formatCurrency(a.amount)}`
                        )
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#687386]">
                      {payment.notes || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 rounded-lg border border-[#9ec5f5] bg-[#eaf4ff] px-2 py-1 text-[11px] font-bold text-[#0b5fc4]">
                        <ExternalLink className="h-3.5 w-3.5" />
                        فتح
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPrintPayment(payment);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
                        title="طباعة الإيصال"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        طباعة
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeletePayment(payment);
                        }}
                        disabled={deletingPaymentId === payment.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                        title="حذف وعكس التوزيع"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingPaymentId === payment.id ? "..." : "حذف"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <InvoiceOperationModal
        selected={selectedOp}
        settings={settings}
        onClose={() => setSelectedOp(null)}
        onPaymentBusyChange={setPaymentBusy}
        onInvoiceUpdated={() => void refreshData()}
      />

      {showMovementsPrint && (
        <PrintReportPreview
          title={`حركة ${isDualLinked ? "الحساب الموحّد" : entityLabel} — ${party.name}`}
          subtitle={
            netBalance
              ? `الرصيد الصافي: ${netBalance.label} · افتتاحي: ${balanceLabel(party.opening_balance ?? 0)}`
              : `الرصيد الحالي: ${balanceLabel(party.balance)} · افتتاحي: ${balanceLabel(party.opening_balance ?? 0)}`
          }
          rows={filtered}
          columns={partyHistoryColumns}
          settings={settings}
          summary={[
            { label: "عدد العمليات", value: String(filtered.length) },
            { label: "إجمالي الفواتير", value: formatCurrency(totalAmount) },
            { label: "المدفوع على الفواتير", value: formatCurrency(totalPaid) },
            {
              label: "تحصيلات/سدادات/مقاصة",
              value: formatCurrency(
                filtered
                  .filter(
                    (r) =>
                      r.type === "collection" ||
                      r.type === "disbursement" ||
                      r.type === "settlement"
                  )
                  .reduce((s, r) => s + Number(r.paid_amount), 0)
              ),
            },
            {
              label: netBalance ? "الرصيد الصافي" : "الرصيد الحالي",
              value: netBalance ? netBalance.label : balanceLabel(party.balance),
            },
          ]}
          onClose={() => setShowMovementsPrint(false)}
        />
      )}

      {showPaymentsPrint && (
        <PrintReportPreview
          title={`${kind === "customer" ? "تحصيلات" : "سدادات"} — ${party.name}`}
          subtitle={`الرصيد الحالي: ${balanceLabel(party.balance)}`}
          rows={partyPayments}
          columns={partyPaymentPrintColumns}
          settings={settings}
          summary={[
            {
              label: "عدد الدفعات",
              value: String(partyPayments.length),
            },
            {
              label: "الإجمالي",
              value: formatCurrency(
                partyPayments.reduce((s, p) => s + Number(p.amount), 0)
              ),
            },
          ]}
          onClose={() => setShowPaymentsPrint(false)}
        />
      )}

      {printPayment && (
        <PartyPaymentPrintPreview
          payment={printPayment}
          partyName={party.name}
          partyPhone={party.phone}
          settings={settings}
          onClose={() => setPrintPayment(null)}
        />
      )}

      {showStatement && (
        <EntityStatementPreview
          kind={kind}
          party={party}
          settings={settings}
          onClose={() => setShowStatement(false)}
          linkedParty={
            linkedParty
              ? {
                  id: linkedParty.id,
                  kind: kind === "customer" ? "supplier" : "customer",
                  name: linkedParty.name,
                  balance: linkedParty.balance,
                }
              : null
          }
          netBalanceLabel={netBalance?.label}
        />
      )}

      {showDetailedStatement && (
        <PartyStatementPreview
          kind={kind}
          partyId={party.id}
          partyName={party.name}
          settings={settings}
          onClose={() => setShowDetailedStatement(false)}
        />
      )}

      <Modal
        open={showLinkModal}
        onClose={() => !linkBusy && setShowLinkModal(false)}
        title={kind === "customer" ? "ربط كمورد" : "ربط كعميل"}
      >
        <div className="space-y-4">
          <p className="text-sm text-[#687386]">
            اربط حساباً موجوداً، أو أنشئ الطرف الآخر بنفس الاسم والهاتف لتجميع
            الرصيد في رقم صافي واحد (ليّا / عليّا).
          </p>
          <button
            type="button"
            disabled={linkBusy}
            onClick={() => void handleEnsureDualRole()}
            className="w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {kind === "customer"
              ? "إنشاء مورد جديد وربطه"
              : "إنشاء عميل جديد وربطه"}
          </button>
          <div className="border-t border-[#e1e6ee] pt-3">
            <label className="mb-1 block text-xs font-semibold text-[#687386]">
              أو اختر من القائمة
            </label>
            <input
              type="search"
              value={linkSearch}
              onChange={(e) => {
                setLinkSearch(e.target.value);
                void loadLinkCandidates(e.target.value);
              }}
              placeholder="بحث بالاسم أو الهاتف..."
              className="w-full rounded-lg border border-[#e1e6ee] px-3 py-2 text-sm"
            />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[#e1e6ee]">
              {linkLoading ? (
                <p className="p-3 text-center text-xs text-[#687386]">جاري التحميل...</p>
              ) : linkCandidates.length === 0 ? (
                <p className="p-3 text-center text-xs text-[#687386]">
                  لا توجد نتائج غير مربوطة
                </p>
              ) : (
                linkCandidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={linkBusy}
                    onClick={() => void handleLinkExisting(c.id)}
                    className="flex w-full items-center justify-between border-b border-[#eef1f6] px-3 py-2 text-right text-sm hover:bg-[#f8faff] disabled:opacity-50 last:border-0"
                  >
                    <span>
                      <span className="font-bold text-[#172033]">{c.name}</span>
                      {c.phone ? (
                        <span className="mr-2 text-xs text-[#687386]">{c.phone}</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-[#687386]">
                      {formatCurrency(c.balance)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>

      {inlinePrintState && (
        <DocumentPrintPreview
          kind={inlinePrintState.kind}
          documentNumber={inlinePrintState.documentNumber}
          items={inlinePrintState.items}
          partyName={inlinePrintState.partyName}
          partyPhone={inlinePrintState.partyPhone}
          subtotal={inlinePrintState.subtotal}
          discount={inlinePrintState.discount}
          taxAmount={inlinePrintState.taxAmount}
          total={inlinePrintState.total}
          paid={inlinePrintState.paid}
          paymentMethod={inlinePrintState.paymentMethod}
          notes={inlinePrintState.notes}
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          issuedAt={inlinePrintState.issuedAt}
          onClose={() => setInlinePrintState(null)}
        />
      )}
    </div>
  );
}

function DetailCard({
  label,
  value,
  tone = "default",
  highlight = false,
  badge,
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "success";
  highlight?: boolean;
  badge?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        highlight
          ? tone === "danger"
            ? "border-amber-300 bg-amber-50 ring-1 ring-amber-200"
            : tone === "success"
              ? "border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200"
              : "border-slate-200 bg-white"
          : "border-[#e1e6ee] bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[#687386]">{label}</p>
        {badge ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              tone === "danger"
                ? "bg-rose-100 text-rose-800"
                : tone === "success"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-700"
            }`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <p
        className={`mt-1 text-lg font-bold ${
          tone === "danger"
            ? "text-rose-700"
            : tone === "success"
              ? "text-emerald-700"
              : "text-[#172033]"
        } ${highlight ? "text-xl" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

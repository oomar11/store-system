"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort, smartSearchMatch } from "@/lib/utils";
import {
  buildPartyOpeningRow,
  fetchCustomerHistory,
  fetchSupplierHistory,
  invoiceTypeLabel,
  partyPaymentToHistoryRow,
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
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { EntityStatementPreview } from "@/components/print/EntityStatementPreview";
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
  Printer,
  Trash2,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";

type PartyKind = "customer" | "supplier";
type TypeFilter =
  | ""
  | "sale"
  | "purchase"
  | "sale_return"
  | "purchase_return"
  | "opening"
  | "collection"
  | "disbursement";

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
  const { profile } = useAuth();
  const { info: toastInfo, success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const listHref = kind === "customer" ? "/customers" : "/suppliers";
  const listLabel = kind === "customer" ? "العملاء" : "الموردون";
  const entityLabel = kind === "customer" ? "العميل" : "المورد";

  const [party, setParty] = useState<(Customer | Supplier) | null>(null);
  const [rows, setRows] = useState<PartyInvoiceRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [selectedOp, setSelectedOp] = useState<InvoiceOpSelection | null>(null);
  const [showMovementsPrint, setShowMovementsPrint] = useState(false);
  const [showStatement, setShowStatement] = useState(false);
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

  function paymentHref(paymentId?: string) {
    const base =
      kind === "customer"
        ? `/customers/${partyId}/payments`
        : `/suppliers/${partyId}/payments`;
    return paymentId ? `${base}/${paymentId}` : `${base}/new`;
  }

  async function refreshData() {
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
        const partyData = {
          id: fromSnap.id,
          name: fromSnap.name,
          phone: fromSnap.phone || undefined,
          balance: fromSnap.balance,
          created_at: "",
        } as Customer | Supplier;
        const openingRow = buildPartyOpeningRow(partyData);
        const recent = (snap?.recentInvoices || [])
          .filter((inv) =>
            kind === "customer"
              ? inv.customer_id === partyId
              : inv.supplier_id === partyId
          )
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
        setParty(partyData);
        setRows(
          [...(openingRow ? [openingRow] : []), ...recent].sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
        );
        if (snap?.settings) setSettings(snap.settings as unknown as Settings);
        setPartyPayments([]);
        setLoading(false);
        return;
      }
      setParty(null);
      setRows([]);
      setLoading(false);
      return;
    }

    try {
      const table = kind === "customer" ? "customers" : "suppliers";
      const [partyRes, history, settingsRes, payments] = await withTimeout(
        Promise.all([
          supabase.from(table).select("*").eq("id", partyId).maybeSingle(),
          kind === "customer"
            ? fetchCustomerHistory(partyId)
            : fetchSupplierHistory(partyId),
          supabase.from("settings").select("*").limit(1).maybeSingle(),
          listPartyPayments(supabase, kind, partyId).catch(
            () => [] as PartyPaymentRow[]
          ),
        ]),
        5000
      );

      if (!partyRes.data) {
        setParty(null);
        setRows([]);
        setPartyPayments([]);
        setLoading(false);
        return;
      }

      const partyData = partyRes.data as Customer | Supplier;
      const openingRow = buildPartyOpeningRow(partyData);
      const paymentRows = payments.map(partyPaymentToHistoryRow);
      const merged = [
        ...(openingRow ? [openingRow] : []),
        ...history,
        ...paymentRows,
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setParty(partyData);
      setRows(merged);
      setPartyPayments(payments);
      if (settingsRes.data) setSettings(settingsRes.data);
      setLoading(false);
    } catch {
      // Fall back to snapshot on timeout / network
      const snap = await getSnapshot();
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
          created_at: "",
        } as Customer | Supplier);
        if (snap?.settings) setSettings(snap.settings as unknown as Settings);
      }
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
    if (!isInvoiceRow(row)) return;
    const isExpanded = !!expandedInvoiceIds[row.id];
    if (isExpanded) {
      setExpandedInvoiceIds((prev) => ({ ...prev, [row.id]: false }));
      return;
    }
    setExpandedInvoiceIds((prev) => ({ ...prev, [row.id]: true }));
    await loadInvoiceItems(row.id);
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
        message:
          kind === "customer"
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
      toastSuccess("تم حذف الدفعة وعكس التوزيع");
      await refreshData();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر حذف الدفعة");
    } finally {
      setDeletingPaymentId(null);
      setPaymentBusy(false);
    }
  }

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      await refreshData();
      if (cancelled) return;
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
        invoiceTypeLabel(row.type),
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
          row.type === "purchase_return"
      ),
    [filtered]
  );
  const allVisibleDetailsExpanded =
    visibleInvoiceRows.length > 0 &&
    visibleInvoiceRows.every((row) => expandedInvoiceIds[row.id]);

  async function expandAllVisibleInvoiceDetails() {
    if (visibleInvoiceRows.length === 0) return;
    setExpandedInvoiceIds((prev) => {
      const next = { ...prev };
      for (const row of visibleInvoiceRows) next[row.id] = true;
      return next;
    });
    await Promise.all(visibleInvoiceRows.map((row) => loadInvoiceItems(row.id)));
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
        r.type !== "disbursement"
    )
    .reduce((s, r) => s + Number(r.total), 0);
  const totalPaid = filtered
    .filter(
      (r) =>
        r.type !== "opening" &&
        r.type !== "collection" &&
        r.type !== "disbursement"
    )
    .reduce((s, r) => s + Number(r.paid_amount), 0);
  const unpaidInvoicesCount = useMemo(() => {
    const invoiceType = kind === "customer" ? "sale" : "purchase";
    return rows.filter(
      (r) =>
        r.type === invoiceType &&
        !r.isOpening &&
        !r.isPartyPayment &&
        Number(r.paid_amount) + 0.001 < Number(r.total)
    ).length;
  }, [rows, kind]);

  function openOperation(row: PartyInvoiceRow) {
    if (row.isOpening || row.type === "opening") {
      toastInfo(
        `هذا رصيد افتتاحي — يمكن تعديله من تعديل ${entityLabel} (حقل الرصيد الافتتاحي).`
      );
      return;
    }
    if (row.isPartyPayment && row.partyPaymentId) {
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

  function balanceLabel(balance: number) {
    if (kind === "customer") {
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
  const typeOptions =
    kind === "customer"
      ? ([
          ["", "كل الأنواع"],
          ["sale", "بيع"],
          ["sale_return", "مرتجع بيع"],
          ["collection", "تحصيل"],
          ["opening", "رصيد افتتاحي"],
        ] as const)
      : ([
          ["", "كل الأنواع"],
          ["purchase", "شراء"],
          ["purchase_return", "مرتجع شراء"],
          ["disbursement", "سداد"],
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
              <h1 className="text-2xl font-bold text-[#172033]">{party.name}</h1>
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
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (unpaidInvoicesCount === 0) {
                toastInfo(
                  kind === "customer"
                    ? "لا توجد فواتير بيع غير مسددة لهذا العميل."
                    : "لا توجد فواتير شراء غير مسددة لهذا المورد."
                );
                return;
              }
              router.push(paymentHref());
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1473e6] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0b5fc4]"
          >
            <Wallet className="h-4 w-4" />
            {kind === "customer" ? "تحصيل" : "سداد"}
          </button>
          <button
            type="button"
            onClick={() => setShowStatement(true)}
            className="rounded-xl border border-[#9ec5f5] bg-[#eaf4ff] px-4 py-2.5 text-sm font-bold text-[#0b5fc4] hover:bg-[#dcecff]"
          >
            كشف حساب
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  const canShowDetails = isInvoiceRow(row);
                  const isExpanded = !!expandedInvoiceIds[row.id];
                  const detailItems = invoiceItemsByInvoiceId[row.id] || [];
                  const detailsLoading = !!itemsLoadingByInvoiceId[row.id];
                  return (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => openOperation(row)}
                        className="cursor-pointer hover:bg-[#eef6ff]"
                        title={
                          row.isPartyPayment
                            ? "فتح تفاصيل التحصيل/السداد"
                            : "اختر العملية"
                        }
                      >
                        <td className="px-3 py-2.5 text-[#526176]">
                          {formatDateShort(row.created_at)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#1473e6]">
                          {row.invoice_number}
                        </td>
                        <td className="px-3 py-2.5">
                          {invoiceTypeLabel(row.type)}
                          {row.notes &&
                          (row.type === "opening" || row.isPartyPayment) ? (
                            <span className="mt-0.5 block text-[11px] text-[#687386]">
                              {row.notes}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 font-semibold">
                          {row.type === "collection" ||
                          row.type === "disbursement"
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
                          <td colSpan={7} className="px-4 py-3">
                            <div className="rounded-xl border border-[#dce8f8] bg-white p-3">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-bold text-[#35506f]">
                                  تفاصيل البنود — {row.invoice_number}
                                </p>
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
                              </div>

                              {detailsLoading ? (
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
          title={`حركة ${entityLabel} — ${party.name}`}
          subtitle={`الرصيد الحالي: ${balanceLabel(party.balance)} · افتتاحي: ${balanceLabel(party.opening_balance ?? 0)}`}
          rows={filtered}
          columns={partyHistoryColumns}
          settings={settings}
          summary={[
            { label: "عدد العمليات", value: String(filtered.length) },
            { label: "إجمالي الفواتير", value: formatCurrency(totalAmount) },
            { label: "المدفوع على الفواتير", value: formatCurrency(totalPaid) },
            {
              label: kind === "customer" ? "تحصيلات مجمّعة" : "سدادات مجمّعة",
              value: formatCurrency(
                filtered
                  .filter(
                    (r) =>
                      r.type === "collection" || r.type === "disbursement"
                  )
                  .reduce((s, r) => s + Number(r.paid_amount), 0)
              ),
            },
            { label: "الرصيد الحالي", value: balanceLabel(party.balance) },
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
        />
      )}

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

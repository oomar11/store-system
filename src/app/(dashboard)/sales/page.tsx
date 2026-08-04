"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  formatCurrency,
  formatDateRelative,
  smartSearchMatch,
} from "@/lib/utils";
import { deleteSaleInvoiceFully } from "@/lib/invoice-delete";
import { useSort } from "@/hooks/useSort";
import { useUrlSearchTerm } from "@/hooks/useUrlSearchTerm";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { ReturnsPanel } from "@/components/returns/ReturnsPanel";
import { TableRowActions, type RowAction } from "@/components/ui/TableRowActions";
import {
  useRowContextMenu,
  toContextMenuItems,
  type ContextMenuItem,
} from "@/components/ui/ContextMenu";
import { copyAsLabel, posCopyUrl } from "@/lib/pos-copy";
import { InvoicePreview } from "@/components/pos/InvoicePreview";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { saleInvoiceColumns } from "@/components/print/report-columns";
import { DateField } from "@/components/ui/DateField";
import { TodayDateChip } from "@/components/ui/TodayDateChip";
import { Modal } from "@/components/ui/Modal";
import {
  getSnapshot,
  isBrowserOnline,
  listOutbox,
  readLocalThenNetwork,
  withTimeout,
  type OutboxInvoicePayload,
} from "@/lib/offline";
import type { Customer, Settings } from "@/types";
import { FileText, ShoppingCart } from "lucide-react";

type SalesSection = "invoices" | "quotes" | "returns";

type SaleInvoice = {
  id: string;
  invoice_number: string;
  customer_id?: string;
  customer?: { name: string };
  total: number;
  paid_amount: number;
  payment_method: string;
  safe_id?: string | null;
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
  notes?: string;
  created_at: string;
  status: string;
};

type PreviewState = {
  invoice: SaleInvoice;
  cart: {
    product: { name: string; sku: string };
    quantity: number;
    unit_price: number;
    discount: number;
    total: number;
    list_unit_price?: number | null;
  }[];
  customer: Customer | null;
  safeName?: string;
};

function salePaymentBadge(inv: SaleInvoice): { label: string; className: string } {
  const total = Number(inv.total);
  const paid = Number(inv.paid_amount);
  const hasRemaining = paid + 0.001 < total;

  if (inv.payment_method === "credit" || hasRemaining) {
    const partial = inv.payment_method === "cash" && paid > 0 && hasRemaining;
    return {
      label: partial ? "آجل جزئي" : "آجل",
      className: partial
        ? "bg-orange-50 text-orange-700"
        : "bg-amber-50 text-amber-800",
    };
  }
  return { label: "نقدي", className: "bg-emerald-50 text-emerald-700" };
}

export default function SalesPage() {
  const supabase = createClient();
  const router = useRouter();
  const { profile, canDeleteInvoices } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [section, setSection] = useState<SalesSection>("invoices");
  const [invoices, setInvoices] = useState<SaleInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useUrlSearchTerm();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [viewDetail, setViewDetail] = useState<PreviewState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showListPrint, setShowListPrint] = useState(false);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "returns" || tab === "quotes" || tab === "invoices") {
      setSection(tab);
    }
    const from = params.get("from");
    const to = params.get("to");
    if (from) setDateFrom(from);
    if (to) setDateTo(to);
  }, []);

  function switchSection(next: SalesSection) {
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "invoices") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url.pathname + url.search);
  }

  async function fetchAll() {
    setLoading(true);
    const offline = !isBrowserOnline();

    await readLocalThenNetwork<{
      invoices: SaleInvoice[];
      settings: Settings | null;
    }>({
      offline,
      timeoutMs: 4000,
      local: async () => {
        const [snap, pending] = await Promise.all([
          getSnapshot(),
          listOutbox({ includeSynced: false }),
        ]);
        const fromSnap: SaleInvoice[] = (snap?.recentInvoices || [])
          .filter((inv) => inv.type === "sale")
          .map((inv) => ({
            id: inv.id,
            invoice_number: inv.invoice_number,
            customer_id: inv.customer_id || undefined,
            customer: inv.customer_name
              ? { name: inv.customer_name }
              : undefined,
            total: inv.total,
            paid_amount: inv.paid_amount,
            payment_method: inv.payment_method || "cash",
            created_at: inv.created_at,
            status: inv.status || "completed",
          }));

        const fromOutbox: SaleInvoice[] = [];
        for (const e of pending) {
          if (e.type !== "invoice") continue;
          const payload = e.payload as OutboxInvoicePayload;
          if (payload.type !== "sale") continue;
          fromOutbox.push({
            id: e.id,
            invoice_number: payload.tempNumber,
            customer_id: payload.customerId || undefined,
            customer: payload.label ? { name: payload.label } : undefined,
            total: payload.total,
            paid_amount: payload.paidAmount,
            payment_method: payload.paymentMethod,
            created_at: e.occurred_at,
            status: "pending_sync",
          });
        }

        const byId = new Map<string, SaleInvoice>();
        for (const inv of [...fromOutbox, ...fromSnap]) {
          byId.set(inv.id, inv);
        }
        let invoices = Array.from(byId.values()).sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        if (dateFrom) {
          const fromTs = new Date(`${dateFrom}T00:00:00`).getTime();
          invoices = invoices.filter(
            (inv) => new Date(inv.created_at).getTime() >= fromTs
          );
        }
        if (dateTo) {
          const toTs = new Date(`${dateTo}T23:59:59`).getTime();
          invoices = invoices.filter(
            (inv) => new Date(inv.created_at).getTime() <= toTs
          );
        }

        if (!invoices.length && !snap?.settings) return null;
        return {
          invoices,
          settings: (snap?.settings as Settings | null) ?? null,
        };
      },
      network: async () => {
        let query = supabase
          .from("invoices")
          .select("*, customer:customers(name)")
          .eq("type", "sale")
          .order("created_at", { ascending: false });

        if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
        if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

        const [invRes, settingsRes] = await withTimeout(
          Promise.all([
            query,
            supabase.from("settings").select("*").limit(1).maybeSingle(),
          ]),
          5000
        );
        if (invRes.error) throw invRes.error;
        return {
          invoices: (invRes.data as SaleInvoice[]) || [],
          settings: (settingsRes.data as Settings | null) ?? null,
        };
      },
      apply: (data) => {
        setInvoices(data.invoices);
        if (data.settings) setSettings(data.settings);
      },
    });

    setLoading(false);
  }

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  const filtered = invoices.filter((inv) =>
    smartSearchMatch(searchTerm, [inv.invoice_number, inv.customer?.name, inv.notes])
  );
  const { items: sorted, sortConfig, requestSort } = useSort(filtered);
  const totalSales = sorted.reduce((sum, inv) => sum + Number(inv.total), 0);

  async function loadInvoiceDetail(inv: SaleInvoice): Promise<PreviewState> {
    const [{ data: lines }, customerRes, safeRes] = await Promise.all([
      supabase
        .from("invoice_items")
        .select("*, product:products(name, sku)")
        .eq("invoice_id", inv.id),
      inv.customer_id
        ? supabase.from("customers").select("*").eq("id", inv.customer_id).single()
        : Promise.resolve({ data: null as Customer | null }),
      inv.safe_id
        ? supabase.from("safes").select("name").eq("id", inv.safe_id).maybeSingle()
        : Promise.resolve({ data: null as { name: string } | null }),
    ]);

    return {
      invoice: inv,
      customer: customerRes.data,
      safeName: safeRes.data?.name,
      cart:
        lines?.map((line) => ({
          product: {
            name: line.product?.name || "صنف",
            sku: line.product?.sku || "",
          },
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
          discount: Number(line.discount) || 0,
          total: Number(line.total),
          list_unit_price:
            (line as { list_unit_price?: number | null }).list_unit_price !=
            null
              ? Number(
                  (line as { list_unit_price?: number | null }).list_unit_price
                )
              : null,
        })) || [],
    };
  }

  async function viewInvoice(inv: SaleInvoice) {
    setPreview(await loadInvoiceDetail(inv));
  }

  async function openViewModal(inv: SaleInvoice) {
    setViewDetail(await loadInvoiceDetail(inv));
  }

  function editInPos(inv: SaleInvoice) {
    router.push(`/pos?edit=${inv.id}`);
  }

  function saleRowActions(inv: SaleInvoice): RowAction[] {
    return [
      {
        label: "طباعة",
        tone: "print",
        icon: "printer",
        onClick: () => void viewInvoice(inv),
      },
      {
        label: "نسخ الرقم",
        tone: "copy",
        icon: "copy",
        onClick: () => void copyInvoiceNumber(inv.invoice_number),
      },
      {
        label: "عرض",
        tone: "view",
        icon: "eye",
        onClick: () => void openViewModal(inv),
      },
      {
        label: "تعديل في POS",
        tone: "edit",
        icon: "pencil",
        onClick: () => editInPos(inv),
      },
      ...(canDeleteInvoices
        ? [
            {
              label: busyDeleteId === inv.id ? "جاري الحذف..." : "حذف",
              tone: "delete" as const,
              icon: "trash" as const,
              disabled: busyDeleteId === inv.id,
              onClick: () => void handleDelete(inv),
            },
          ]
        : []),
    ];
  }

  function saleContextItems(inv: SaleInvoice): ContextMenuItem[] {
    return [
      ...toContextMenuItems(saleRowActions(inv)),
      { kind: "separator" },
      {
        label: copyAsLabel("sale"),
        tone: "copy",
        icon: "copy",
        onClick: () => router.push(posCopyUrl(inv.id, "sale")),
      },
      {
        label: copyAsLabel("purchase"),
        tone: "copy",
        icon: "copy",
        onClick: () => router.push(posCopyUrl(inv.id, "purchase")),
      },
      {
        label: copyAsLabel("quote"),
        tone: "copy",
        icon: "copy",
        onClick: () => router.push(posCopyUrl(inv.id, "quote")),
      },
    ];
  }

  async function copyInvoiceNumber(invoiceNumber: string) {
    try {
      await navigator.clipboard.writeText(invoiceNumber);
      toastSuccess(`تم نسخ ${invoiceNumber}`);
    } catch {
      toastError("تعذر نسخ رقم الفاتورة");
    }
  }

  async function handleDelete(inv: SaleInvoice) {
    if (!canDeleteInvoices) {
      toastError("ليس لديك صلاحية حذف الفواتير");
      return;
    }
    if (
      !(await confirm({
        message: `حذف فاتورة المبيعات ${inv.invoice_number}؟\nسيتم: إرجاع المخزون، وعكس رصيد العميل والخزنة، وإلغاء عرض السعر المرتبط إن وُجد.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }

    try {
      setBusyDeleteId(inv.id);
      const { cancelledDocs } = await deleteSaleInvoiceFully(supabase, inv);
      toastSuccess(
        cancelledDocs > 0
          ? `تم الحذف وإلغاء ${cancelledDocs === 1 ? "عرض السعر المرتبط" : `${cancelledDocs} وثائق مرتبطة`}`
          : "تم حذف الفاتورة وعكس المخزون والحسابات"
      );
      await fetchAll();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر الحذف");
    } finally {
      setBusyDeleteId(null);
    }
  }

  if (loading && section === "invoices") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold text-[#1473e6]">المبيعات</p>
          <h1 className="text-2xl font-bold text-[#172033]">
            {section === "invoices"
              ? "فواتير المبيعات"
              : section === "quotes"
                ? "عروض الأسعار"
                : "المرتجعات"}
          </h1>
        </div>
        {(section === "invoices" || section === "quotes") && (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/pos?mode=quote"
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#9ac7fa] bg-[#eef6ff] px-4 py-2 text-sm font-bold text-[#1473e6] hover:bg-[#dcecff]"
            >
              <FileText className="h-4 w-4" />
              عرض سعر جديد
            </Link>
            {section === "invoices" && (
            <Link
              href="/pos"
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#1473e6] px-4 py-2 text-sm font-bold text-white shadow-[0_7px_18px_rgba(20,115,230,0.18)] hover:bg-[#0b65d1]"
            >
              <ShoppingCart className="h-4 w-4" />
              نقطة البيع
            </Link>
            )}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => switchSection("invoices")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            section === "invoices"
              ? "bg-[#1473e6] text-white"
              : "border border-[#e1e6ee] text-[#687386] hover:bg-[#f7f9fc]"
          }`}
        >
          فواتير المبيعات
        </button>
        <button
          onClick={() => switchSection("quotes")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            section === "quotes"
              ? "bg-[#1473e6] text-white"
              : "border border-[#e1e6ee] text-[#687386] hover:bg-[#f7f9fc]"
          }`}
        >
          عروض الأسعار
        </button>
        <button
          onClick={() => switchSection("returns")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            section === "returns"
              ? "bg-[#1473e6] text-white"
              : "border border-[#e1e6ee] text-[#687386] hover:bg-[#f7f9fc]"
          }`}
        >
          المرتجعات
        </button>
      </div>

      <div className={section === "quotes" ? "block" : "hidden"}>
        <DocumentsPanel
          fixedType="quote"
          embedded
          onConverted={() => {
            switchSection("invoices");
            void fetchAll();
          }}
        />
      </div>

      <div className={section === "returns" ? "block" : "hidden"}>
        <ReturnsPanel embedded />
      </div>

      <div className={section === "invoices" ? "block" : "hidden"}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <input
            type="text"
            placeholder="بحث برقم الفاتورة أو العميل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full max-w-md rounded-lg border border-[#e1e6ee] px-4 py-2 text-sm focus:border-[#9ac7fa] focus:outline-none focus:ring-3 focus:ring-[#1473e6]/10"
          />
          <DateField
            value={dateFrom}
            onChange={setDateFrom}
            className="w-auto min-w-[160px]"
            inputClassName="border-[#e1e6ee]"
          />
          <DateField
            value={dateTo}
            onChange={setDateTo}
            className="w-auto min-w-[160px]"
            inputClassName="border-[#e1e6ee]"
          />
          <TodayDateChip
            dateFrom={dateFrom}
            dateTo={dateTo}
            onApply={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
          />
          <PrintListButton
            onClick={() => setShowListPrint(true)}
            rowCount={sorted.length}
          />
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[#e9edf4] bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-[#687386]">عدد الفواتير</p>
            <p className="mt-1 text-xl font-bold text-[#172033]">{sorted.length}</p>
          </div>
          <div className="rounded-xl border border-[#e9edf4] bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-[#687386]">إجمالي المعروض</p>
            <p className="mt-1 text-xl font-bold text-[#1473e6]">
              {formatCurrency(totalSales)}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#e9edf4] bg-white shadow-sm">
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#f7f9fc] text-[#687386]">
                <tr>
                  <SortableHeader
                    label="رقم الفاتورة"
                    field="invoice_number"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label="العميل"
                    field="customer.name"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label="التاريخ"
                    field="created_at"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label="الإجمالي"
                    field="total"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <SortableHeader
                    label="المدفوع"
                    field="paid_amount"
                    sortField={sortConfig.key}
                    sortDirection={sortConfig.direction}
                    onSort={requestSort}
                  />
                  <th className="px-4 py-3 text-right font-medium">ملاحظة</th>
                  <th className="px-4 py-3 text-right font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f6]">
                {sorted.map((inv) => (
                  <tr
                    key={inv.id}
                    className="hover:bg-[#f7f9fc]"
                    onContextMenu={(e) => openMenu(e, saleContextItems(inv))}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span>{inv.customer?.name || "نقدي"}</span>
                        {(() => {
                          const badge = salePaymentBadge(inv);
                          return (
                            <span
                              className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#687386]">
                      {formatDateRelative(inv.created_at)}
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {formatCurrency(inv.total)}
                    </td>
                    <td className="px-4 py-3 text-emerald-700">
                      {formatCurrency(inv.paid_amount)}
                    </td>
                    <td className="px-4 py-3 text-[#687386]">{inv.notes || "—"}</td>
                    <td className="px-4 py-3">
                      <TableRowActions actions={saleRowActions(inv)} />
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                        <ShoppingCart className="h-9 w-9 text-[#c2c8d0]" />
                        <p className="text-sm font-semibold text-[#687386]">
                          لا توجد فواتير مبيعات
                        </p>
                        <p className="text-xs text-[#98a2b3]">
                          سجّل أول بيع من نقطة البيع وهتظهر الفواتير هنا.
                        </p>
                        <Link
                          href="/pos"
                          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#1473e6] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b65d1]"
                        >
                          افتح نقطة البيع
                        </Link>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {viewDetail && (
        <Modal
          open
          onClose={() => setViewDetail(null)}
          title={`عرض ${viewDetail.invoice.invoice_number}`}
          wide
        >
          <div className="space-y-4" dir="rtl">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[#344054]">
                  العميل
                </label>
                <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                  {viewDetail.customer?.name ||
                    viewDetail.invoice.customer?.name ||
                    "نقدي"}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[#344054]">
                  التاريخ
                </label>
                <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                  {formatDateRelative(viewDetail.invoice.created_at)}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[#344054]">
                  طريقة الدفع
                </label>
                <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                  {viewDetail.invoice.payment_method === "credit"
                    ? "آجل"
                    : viewDetail.invoice.payment_method === "bank_transfer"
                      ? "تحويل بنكي"
                      : "نقدي"}
                </p>
              </div>
            </div>
            {Number(viewDetail.invoice.paid_amount) > 0 && (
              <div>
                <label className="mb-1 block text-sm font-medium text-[#344054]">
                  الخزنة
                </label>
                <p className="rounded-lg border border-[#e1e6ee] bg-slate-50 px-3 py-2 text-sm text-[#172033]">
                  {viewDetail.safeName || "—"}
                </p>
              </div>
            )}
            <div className="rounded-xl border border-[#eef1f6] bg-[#f7f9fc]/60 p-4">
              <h3 className="mb-2 text-sm font-semibold text-[#172033]">البنود</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-[#687386]">
                    <tr>
                      <th className="px-2 py-1.5 text-right">الصنف</th>
                      <th className="px-2 py-1.5 text-right">الكمية</th>
                      <th className="px-2 py-1.5 text-right">السعر</th>
                      <th className="px-2 py-1.5 text-right">الخصم</th>
                      <th className="px-2 py-1.5 text-right">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eef1f6]">
                    {viewDetail.cart.map((line, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1.5">
                          <p className="font-medium">{line.product.name}</p>
                          <p className="font-mono text-[10px] text-gray-400">
                            {line.product.sku}
                          </p>
                        </td>
                        <td className="px-2 py-1.5">{line.quantity}</td>
                        <td className="px-2 py-1.5">
                          {formatCurrency(line.unit_price)}
                          {line.list_unit_price != null &&
                            line.list_unit_price > line.unit_price + 0.001 && (
                              <p className="text-[10px] text-emerald-700">
                                قبل {formatCurrency(line.list_unit_price)}
                              </p>
                            )}
                        </td>
                        <td className="px-2 py-1.5">{formatCurrency(line.discount)}</td>
                        <td className="px-2 py-1.5 font-semibold">
                          {formatCurrency(line.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                الإجمالي:{" "}
                <span className="font-bold">
                  {formatCurrency(viewDetail.invoice.total)}
                </span>
              </p>
              <p>
                المدفوع:{" "}
                <span className="font-bold text-emerald-700">
                  {formatCurrency(viewDetail.invoice.paid_amount)}
                </span>
              </p>
              {viewDetail.invoice.notes ? (
                <p className="sm:col-span-2 text-[#687386]">
                  ملاحظات: {viewDetail.invoice.notes}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPreview(viewDetail);
                  setViewDetail(null);
                }}
                className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700"
              >
                طباعة
              </button>
              <button
                type="button"
                onClick={() => editInPos(viewDetail.invoice)}
                className="rounded-lg bg-[#1473e6] px-4 py-2 text-sm font-semibold text-white"
              >
                تعديل في POS
              </button>
              <button
                type="button"
                onClick={() => setViewDetail(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
              >
                إغلاق
              </button>
            </div>
          </div>
        </Modal>
      )}

      {preview && (
        <InvoicePreview
          variant="view"
          invoiceNumber={preview.invoice.invoice_number}
          cart={preview.cart}
          customer={preview.customer}
          subtotal={
            Number(preview.invoice.subtotal) ||
            preview.cart.reduce((s, i) => s + i.total, 0)
          }
          discount={Number(preview.invoice.discount_amount) || 0}
          taxAmount={Number(preview.invoice.tax_amount) || 0}
          total={Number(preview.invoice.total)}
          paid={Number(preview.invoice.paid_amount)}
          paymentMethod={
            preview.invoice.payment_method === "credit" ? "credit" : "cash"
          }
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          issuedAt={preview.invoice.created_at}
          onClose={() => setPreview(null)}
        />
      )}

      {showListPrint && (
        <PrintReportPreview
          title="تقرير فواتير المبيعات"
          rows={sorted}
          columns={saleInvoiceColumns}
          settings={settings}
          subtitle={
            dateFrom || dateTo
              ? `الفترة: ${dateFrom || "…"} — ${dateTo || "…"}`
              : undefined
          }
          summary={[
            { label: "عدد الفواتير", value: String(sorted.length) },
            { label: "إجمالي المعروض", value: formatCurrency(totalSales) },
          ]}
          onClose={() => setShowListPrint(false)}
        />
      )}
      {contextMenu}
    </div>
  );
}

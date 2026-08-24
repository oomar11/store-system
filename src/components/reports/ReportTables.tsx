"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDateShort, smartSearchMatch } from "@/lib/utils";
import { useSort } from "@/hooks/useSort";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { ReportRowActions } from "@/components/reports/ReportRowActions";
import type { RowAction } from "@/components/ui/TableRowActions";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { createClient } from "@/lib/supabase";
import { deleteSaleInvoiceFully } from "@/lib/invoice-delete";
import { guardCustomerDelete, guardProductDelete } from "@/lib/delete-guards";
import {
  deleteManualSafeMovement,
  deleteSafeTransfer,
  isManualSafeMovement,
} from "@/lib/safe-transactions";
import { deleteExpense } from "@/lib/expenses";
import { logAuditEvent } from "@/lib/audit";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import type {
  CustomerProfitRow,
  ExpenseRaw,
  InvoiceProfitRow,
  ProductProfitRow,
  ReportSection,
  ReportsBundle,
  TreasuryRaw,
} from "@/lib/reports/types";

function AccuracyBadge({ value }: { value: string }) {
  const styles =
    value === "reliable"
      ? "bg-emerald-50 text-emerald-700"
      : value === "estimated"
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-100 text-slate-600";
  const label =
    value === "reliable" ? "موثوق" : value === "estimated" ? "تقديري" : "مختلط";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${styles}`}>
      {label}
    </span>
  );
}

function StockBadge({ status }: { status: string }) {
  if (status === "out")
    return (
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
        نافد
      </span>
    );
  if (status === "low")
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
        منخفض
      </span>
    );
  return (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
      متوفر
    </span>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full max-w-xs rounded-lg border border-[#e7ebf1] bg-white px-3 py-2 text-sm outline-none focus:border-[#1473e6]"
    />
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-10 text-center text-sm text-[#98a2b3]">
        لا توجد بيانات للفترة المحددة
      </td>
    </tr>
  );
}

export function InvoicesReportTable({
  rows,
  onMutated,
}: {
  rows: InvoiceProfitRow[];
  onMutated?: () => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { canDeleteInvoices } = useAuth();
  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        smartSearchMatch(q, [r.invoice_number, r.customer_name, r.type])
      ),
    [rows, q]
  );
  const { items: sorted, sortConfig, requestSort } = useSort(filtered);
  const totals = useMemo(
    () => ({
      revenue: sorted.reduce((s, r) => s + r.revenue, 0),
      cost: sorted.reduce((s, r) => s + r.cost, 0),
      profit: sorted.reduce((s, r) => s + r.profit, 0),
      remaining: sorted.reduce((s, r) => s + r.remaining, 0),
    }),
    [sorted]
  );

  async function handleDeleteInvoice(r: InvoiceProfitRow) {
    if (!canDeleteInvoices) {
      toastError("ليس لديك صلاحية حذف الفواتير");
      return;
    }
    if (
      !(await confirm({
        message: `حذف الفاتورة ${r.invoice_number}؟`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBusyId(r.id);
    try {
      await deleteSaleInvoiceFully(supabase, {
        id: r.id,
        invoice_number: r.invoice_number,
        customer_id: r.customer_id,
        total: r.total,
        paid_amount: r.paid_amount,
      });
      toastSuccess("تم الحذف");
      onMutated?.();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر الحذف");
    } finally {
      setBusyId(null);
    }
  }

  function rowActions(r: InvoiceProfitRow): RowAction[] {
    return [
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () =>
          router.push(
            r.type === "sale_return" ? "/sales?tab=returns" : `/pos?edit=${r.id}`
          ),
      },
      ...(canDeleteInvoices && r.type !== "sale_return"
        ? [
            {
              label: "حذف",
              tone: "delete" as const,
              icon: "trash" as const,
              disabled: busyId === r.id,
              onClick: () => void handleDeleteInvoice(r),
            },
          ]
        : []),
    ];
  }

  return (
    <div>
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder="بحث برقم الفاتورة أو العميل…" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[#f8faff] text-[11px] text-[#687386]">
            <tr>
              <SortableHeader label="الفاتورة" field="invoice_number" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="التاريخ" field="created_at" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="العميل" field="customer_name" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <th className="px-3 py-2.5 text-right font-semibold">النوع</th>
              <SortableHeader label="صافي البيع" field="revenue" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="التكلفة" field="cost" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الربح" field="profit" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الهامش" field="margin" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="المتبقي" field="remaining" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <th className="px-3 py-2.5 text-right font-semibold">الدقة</th>
              <th className="px-3 py-2.5 text-right font-semibold">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyRow cols={11} />
            ) : (
              sorted.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-[#edf0f5] hover:bg-[#f0f6ff]"
                  onClick={() =>
                    router.push(
                      r.type === "sale_return"
                        ? "/sales?tab=returns"
                        : `/pos?edit=${r.id}`
                    )
                  }
                  onContextMenu={(e) => openMenu(e, toContextMenuItems(rowActions(r)))}
                >
                  <td className="px-3 py-2.5 font-semibold text-blue-700">{r.invoice_number}</td>
                  <td className="px-3 py-2.5 text-[#687386]">{formatDateShort(r.created_at)}</td>
                  <td className="px-3 py-2.5">{r.customer_name}</td>
                  <td className="px-3 py-2.5">
                    {r.type === "sale_return" ? (
                      <span className="text-rose-600">مرتجع</span>
                    ) : (
                      <span className="text-emerald-700">بيع</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{formatCurrency(r.revenue)}</td>
                  <td className="px-3 py-2.5">{formatCurrency(r.cost)}</td>
                  <td className={`px-3 py-2.5 font-bold ${r.profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                    {formatCurrency(r.profit)}
                  </td>
                  <td className="px-3 py-2.5">{r.margin.toFixed(1)}%</td>
                  <td className="px-3 py-2.5">{formatCurrency(r.remaining)}</td>
                  <td className="px-3 py-2.5">
                    <AccuracyBadge value={r.accuracy} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ReportRowActions
                      busy={busyId === r.id}
                      onEdit={() =>
                        router.push(
                          r.type === "sale_return"
                            ? "/sales?tab=returns"
                            : `/pos?edit=${r.id}`
                        )
                      }
                      onDelete={
                        canDeleteInvoices && r.type !== "sale_return"
                          ? () => void handleDeleteInvoice(r)
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t-2 border-[#d0d7e2] bg-[#f8faff] font-bold">
              <tr>
                <td className="px-3 py-2.5" colSpan={4}>
                  المجموع ({sorted.length})
                </td>
                <td className="px-3 py-2.5">{formatCurrency(totals.revenue)}</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.cost)}</td>
                <td className={`px-3 py-2.5 ${totals.profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {formatCurrency(totals.profit)}
                </td>
                <td className="px-3 py-2.5">—</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.remaining)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {contextMenu}
    </div>
  );
}

export function CustomersReportTable({
  rows,
  onMutated,
}: {
  rows: CustomerProfitRow[];
  onMutated?: () => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const filtered = useMemo(
    () => rows.filter((r) => smartSearchMatch(q, [r.name, r.phone])),
    [rows, q]
  );
  const { items: sorted, sortConfig, requestSort } = useSort(filtered);
  const totals = useMemo(
    () => ({
      invoices: sorted.reduce((s, r) => s + r.invoice_count, 0),
      revenue: sorted.reduce((s, r) => s + r.revenue, 0),
      profit: sorted.reduce((s, r) => s + r.profit, 0),
      collected: sorted.reduce((s, r) => s + r.collected, 0),
      remaining: sorted.reduce((s, r) => s + r.remaining, 0),
      balance: sorted.reduce((s, r) => s + r.balance, 0),
    }),
    [sorted]
  );

  async function handleDelete(r: CustomerProfitRow) {
    const guard = await guardCustomerDelete(supabase, r.id, r.name);
    if (!guard.ok) {
      toastError(guard.message);
      return;
    }
    if (
      !(await confirm({
        message: `حذف العميل «${r.name}»؟`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBusyId(r.id);
    const { error } = await supabase.from("customers").delete().eq("id", r.id);
    setBusyId(null);
    if (error) {
      toastError(error.message);
      return;
    }
    await logAuditEvent(supabase, {
      action: "customer.delete",
      entityType: "customer",
      entityId: r.id,
      entityLabel: r.name,
      before: { name: r.name, balance: r.balance },
      source: "app",
    });
    toastSuccess("تم الحذف");
    onMutated?.();
  }

  function rowActions(r: CustomerProfitRow): RowAction[] {
    return [
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () => router.push(`/customers/${r.id}`),
      },
      {
        label: "حذف",
        tone: "delete",
        icon: "trash",
        disabled: busyId === r.id,
        onClick: () => void handleDelete(r),
      },
    ];
  }

  return (
    <div>
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder="بحث عن عميل…" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[#f8faff] text-[11px] text-[#687386]">
            <tr>
              <SortableHeader label="العميل" field="name" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <th className="px-3 py-2.5 text-right font-semibold">الهاتف</th>
              <SortableHeader label="الفواتير" field="invoice_count" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="صافي المبيعات" field="revenue" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الربح" field="profit" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الهامش" field="margin" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="المحصل" field="collected" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="المتبقي" field="remaining" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الرصيد" field="balance" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <th className="px-3 py-2.5 text-right font-semibold">الدقة</th>
              <th className="px-3 py-2.5 text-right font-semibold">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyRow cols={11} />
            ) : (
              sorted.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-[#edf0f5] hover:bg-[#f0f6ff]"
                  onClick={() => router.push(`/customers/${r.id}`)}
                  onContextMenu={(e) => openMenu(e, toContextMenuItems(rowActions(r)))}
                >
                  <td className="px-3 py-2.5 font-semibold text-blue-700">{r.name}</td>
                  <td className="px-3 py-2.5 text-[#687386]">{r.phone || "—"}</td>
                  <td className="px-3 py-2.5">{r.invoice_count}</td>
                  <td className="px-3 py-2.5">{formatCurrency(r.revenue)}</td>
                  <td className={`px-3 py-2.5 font-bold ${r.profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                    {formatCurrency(r.profit)}
                  </td>
                  <td className="px-3 py-2.5">{r.margin.toFixed(1)}%</td>
                  <td className="px-3 py-2.5">{formatCurrency(r.collected)}</td>
                  <td className="px-3 py-2.5">{formatCurrency(r.remaining)}</td>
                  <td className={`px-3 py-2.5 font-semibold ${r.balance > 0 ? "text-rose-600" : r.balance < 0 ? "text-emerald-700" : ""}`}>
                    {formatCurrency(r.balance)}
                  </td>
                  <td className="px-3 py-2.5">
                    <AccuracyBadge value={r.accuracy} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ReportRowActions
                      busy={busyId === r.id}
                      onEdit={() => router.push(`/customers/${r.id}`)}
                      onDelete={() => void handleDelete(r)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t-2 border-[#d0d7e2] bg-[#f8faff] font-bold">
              <tr>
                <td className="px-3 py-2.5" colSpan={2}>
                  المجموع ({sorted.length})
                </td>
                <td className="px-3 py-2.5">{totals.invoices}</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.revenue)}</td>
                <td className={`px-3 py-2.5 ${totals.profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {formatCurrency(totals.profit)}
                </td>
                <td className="px-3 py-2.5">—</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.collected)}</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.remaining)}</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.balance)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {contextMenu}
    </div>
  );
}

export function ProductsReportTable({
  rows,
  onMutated,
}: {
  rows: ProductProfitRow[];
  onMutated?: () => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out" | "sold">("all");
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (!smartSearchMatch(q, [r.name, r.sku, r.category])) return false;
      if (stockFilter === "low") return r.stock_status === "low";
      if (stockFilter === "out") return r.stock_status === "out";
      if (stockFilter === "sold") return r.qty_sold > 0;
      return true;
    });
  }, [rows, q, stockFilter]);
  const { items: sorted, sortConfig, requestSort } = useSort(filtered);
  const totals = useMemo(
    () => ({
      qty: sorted.reduce((s, r) => s + r.qty_sold, 0),
      revenue: sorted.reduce((s, r) => s + r.revenue, 0),
      profit: sorted.reduce((s, r) => s + r.profit, 0),
      stock: sorted.reduce((s, r) => s + r.stock_qty, 0),
      stockValue: sorted.reduce((s, r) => s + r.stock_value, 0),
      stockValueSell: sorted.reduce((s, r) => s + r.stock_value_sell, 0),
    }),
    [sorted]
  );

  async function handleDelete(r: ProductProfitRow) {
    const guard = await guardProductDelete(supabase, r.id, r.name);
    if (!guard.ok) {
      toastError(guard.message);
      return;
    }
    if (
      !(await confirm({
        message: `حذف الصنف «${r.name}»؟`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBusyId(r.id);
    const { error } = await supabase.from("products").delete().eq("id", r.id);
    setBusyId(null);
    if (error) {
      toastError(error.message);
      return;
    }
    await logAuditEvent(supabase, {
      action: "product.delete",
      entityType: "product",
      entityId: r.id,
      entityLabel: r.name,
      before: { name: r.name, sku: r.sku },
      source: "app",
    });
    toastSuccess("تم الحذف");
    onMutated?.();
  }

  function rowActions(r: ProductProfitRow): RowAction[] {
    return [
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () => router.push(`/products/${r.id}`),
      },
      {
        label: "حذف",
        tone: "delete",
        icon: "trash",
        disabled: busyId === r.id,
        onClick: () => void handleDelete(r),
      },
    ];
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="بحث عن صنف…" />
        <select
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value as typeof stockFilter)}
          className="rounded-lg border border-[#e7ebf1] bg-white px-3 py-2 text-sm"
        >
          <option value="all">كل الأصناف</option>
          <option value="sold">مباع في الفترة</option>
          <option value="low">مخزون منخفض</option>
          <option value="out">نافد</option>
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-[#f8faff] text-[11px] text-[#687386]">
            <tr>
              <SortableHeader label="الصنف" field="name" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الكود" field="sku" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <th className="px-3 py-2.5 text-right font-semibold">الفئة</th>
              <SortableHeader label="مباع" field="qty_sold" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الإيراد" field="revenue" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الربح" field="profit" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="الهامش" field="margin" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="المخزون" field="stock_qty" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="تكلفة" field="stock_value" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="بيع" field="stock_value_sell" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <th className="px-3 py-2.5 text-right font-semibold">الحالة</th>
              <th className="px-3 py-2.5 text-right font-semibold">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyRow cols={12} />
            ) : (
              sorted.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-[#edf0f5] hover:bg-[#f0f6ff]"
                  onClick={() => router.push(`/products/${r.id}`)}
                  onContextMenu={(e) => openMenu(e, toContextMenuItems(rowActions(r)))}
                >
                  <td className="px-3 py-2.5 font-semibold text-blue-700">{r.name}</td>
                  <td className="px-3 py-2.5 text-[#687386]">{r.sku}</td>
                  <td className="px-3 py-2.5">{r.category}</td>
                  <td className="px-3 py-2.5">{r.qty_sold}</td>
                  <td className="px-3 py-2.5">{formatCurrency(r.revenue)}</td>
                  <td className={`px-3 py-2.5 font-bold ${r.profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                    {formatCurrency(r.profit)}
                  </td>
                  <td className="px-3 py-2.5">{r.margin.toFixed(1)}%</td>
                  <td className="px-3 py-2.5">{r.stock_qty}</td>
                  <td className="px-3 py-2.5">{formatCurrency(r.stock_value)}</td>
                  <td className="px-3 py-2.5">{formatCurrency(r.stock_value_sell)}</td>
                  <td className="px-3 py-2.5">
                    <StockBadge status={r.stock_status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ReportRowActions
                      busy={busyId === r.id}
                      onEdit={() => router.push(`/products/${r.id}`)}
                      onDelete={() => void handleDelete(r)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t-2 border-[#d0d7e2] bg-[#f8faff] font-bold">
              <tr>
                <td className="px-3 py-2.5" colSpan={3}>
                  المجموع ({sorted.length})
                </td>
                <td className="px-3 py-2.5">{totals.qty}</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.revenue)}</td>
                <td className={`px-3 py-2.5 ${totals.profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {formatCurrency(totals.profit)}
                </td>
                <td className="px-3 py-2.5">—</td>
                <td className="px-3 py-2.5">{totals.stock}</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.stockValue)}</td>
                <td className="px-3 py-2.5">{formatCurrency(totals.stockValueSell)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {contextMenu}
    </div>
  );
}

export function TreasuryReportTable({
  rows,
  onMutated,
}: {
  rows: TreasuryRaw[];
  onMutated?: () => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        smartSearchMatch(q, [r.description || "", r.safe?.name || "", r.type])
      ),
    [rows, q]
  );
  const { items: sorted, sortConfig, requestSort } = useSort(filtered);

  const deposits = sorted
    .filter((t) => t.type === "deposit")
    .reduce((s, t) => s + Number(t.amount), 0);
  const withdrawals = sorted
    .filter((t) => t.type === "withdrawal")
    .reduce((s, t) => s + Number(t.amount), 0);

  async function handleDelete(r: TreasuryRaw) {
    if (!isManualSafeMovement(r)) {
      toastError("لا يمكن حذف حركة مرتبطة بفاتورة أو مصروف");
      return;
    }
    if (r.type === "transfer" && r.reference_type === "transfer_in") {
      toastError("احذف صف التحويل (خروج) من الخزينة");
      return;
    }
    if (
      !(await confirm({
        message: "حذف هذه الحركة؟ سيتم عكس أثرها على الرصيد.",
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBusyId(r.id);
    try {
      if (r.type === "transfer") await deleteSafeTransfer(supabase, r.id);
      else await deleteManualSafeMovement(supabase, r.id);
      toastSuccess("تم الحذف");
      onMutated?.();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر الحذف");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="بحث في الحركات…" />
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">
            إيداع: {formatCurrency(deposits)}
          </span>
          <span className="rounded-lg bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">
            سحب: {formatCurrency(withdrawals)}
          </span>
          <span className="rounded-lg bg-blue-50 px-2.5 py-1 font-semibold text-blue-800">
            صافي: {formatCurrency(deposits - withdrawals)}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-[#f8faff] text-[11px] text-[#687386]">
            <tr>
              <SortableHeader label="التاريخ" field="created_at" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <th className="px-3 py-2.5 text-right font-semibold">الخزنة</th>
              <SortableHeader label="النوع" field="type" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <SortableHeader label="المبلغ" field="amount" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
              <th className="px-3 py-2.5 text-right font-semibold">البيان</th>
              <th className="px-3 py-2.5 text-right font-semibold">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyRow cols={6} />
            ) : (
              sorted.map((r) => {
                const canMutate =
                  isManualSafeMovement(r) &&
                  (r.type !== "transfer" || r.reference_type === "transfer_out");
                const actions: RowAction[] = [
                  {
                    label: "تعديل",
                    tone: "edit",
                    icon: "pencil",
                    onClick: () => router.push("/treasury"),
                  },
                  ...(canMutate
                    ? [
                        {
                          label: "حذف",
                          tone: "delete" as const,
                          icon: "trash" as const,
                          disabled: busyId === r.id,
                          onClick: () => void handleDelete(r),
                        },
                      ]
                    : []),
                ];
                return (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-[#edf0f5] hover:bg-[#f0f6ff]"
                  onClick={() => router.push("/treasury")}
                  onContextMenu={(e) => openMenu(e, toContextMenuItems(actions))}
                >
                  <td className="px-3 py-2.5 text-[#687386]">{formatDateShort(r.created_at)}</td>
                  <td className="px-3 py-2.5 text-blue-700">{r.safe?.name || "—"}</td>
                  <td className="px-3 py-2.5">
                    {r.type === "deposit"
                      ? "إيداع"
                      : r.type === "withdrawal"
                        ? "سحب"
                        : "تحويل"}
                  </td>
                  <td
                    className={`px-3 py-2.5 font-bold ${
                      r.type === "deposit"
                        ? "text-emerald-700"
                        : r.type === "withdrawal"
                          ? "text-rose-600"
                          : "text-[#172033]"
                    }`}
                  >
                    {formatCurrency(Number(r.amount))}
                  </td>
                  <td className="px-3 py-2.5 text-[#687386]">{r.description || "—"}</td>
                  <td className="px-3 py-2.5">
                    <ReportRowActions
                      busy={busyId === r.id}
                      onEdit={() => router.push("/treasury")}
                      onDelete={
                        canMutate ? () => void handleDelete(r) : undefined
                      }
                    />
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t-2 border-[#d0d7e2] bg-[#f8faff] font-bold">
              <tr>
                <td className="px-3 py-2.5" colSpan={3}>
                  المجموع ({sorted.length})
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-0.5 text-xs">
                    <span className="text-emerald-700">إيداع: {formatCurrency(deposits)}</span>
                    <span className="text-rose-600">سحب: {formatCurrency(withdrawals)}</span>
                    <span>صافي: {formatCurrency(deposits - withdrawals)}</span>
                  </div>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {contextMenu}
    </div>
  );
}

export function ExpensesReportTable({
  rows,
  onMutated,
}: {
  rows: ExpenseRaw[];
  onMutated?: () => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        smartSearchMatch(q, [
          r.description,
          r.entry_number,
          r.expense_account_name,
          r.safe_name,
        ])
      ),
    [rows, q]
  );
  const { items: sorted, sortConfig, requestSort } = useSort(filtered);
  const total = sorted.reduce((s, r) => s + Number(r.amount), 0);

  async function handleDelete(r: ExpenseRaw) {
    if (
      !(await confirm({
        message: `حذف المصروف ${r.entry_number}؟`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBusyId(r.entry_id);
    const { error } = await deleteExpense(supabase, r.entry_id);
    setBusyId(null);
    if (error) {
      toastError(error);
      return;
    }
    toastSuccess("تم الحذف");
    onMutated?.();
  }

  function rowActions(r: ExpenseRaw): RowAction[] {
    return [
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () => router.push("/expenses"),
      },
      {
        label: "حذف",
        tone: "delete",
        icon: "trash",
        disabled: busyId === r.entry_id,
        onClick: () => void handleDelete(r),
      },
    ];
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="بحث في الحساب أو البيان…"
        />
        <p className="text-xs font-semibold text-rose-700">
          الإجمالي: {formatCurrency(total)}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-[#f8faff] text-[11px] text-[#687386]">
            <tr>
              <SortableHeader
                label="التاريخ"
                field="date"
                sortField={sortConfig.key}
                sortDirection={sortConfig.direction}
                onSort={requestSort}
              />
              <SortableHeader
                label="رقم القيد"
                field="entry_number"
                sortField={sortConfig.key}
                sortDirection={sortConfig.direction}
                onSort={requestSort}
              />
              <SortableHeader
                label="الحساب"
                field="expense_account_name"
                sortField={sortConfig.key}
                sortDirection={sortConfig.direction}
                onSort={requestSort}
              />
              <SortableHeader
                label="الخزنة"
                field="safe_name"
                sortField={sortConfig.key}
                sortDirection={sortConfig.direction}
                onSort={requestSort}
              />
              <SortableHeader
                label="المبلغ"
                field="amount"
                sortField={sortConfig.key}
                sortDirection={sortConfig.direction}
                onSort={requestSort}
              />
              <th className="px-3 py-2.5 text-right font-semibold">البيان</th>
              <th className="px-3 py-2.5 text-right font-semibold">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <EmptyRow cols={7} />
            ) : (
              sorted.map((r) => (
                <tr
                  key={r.entry_id}
                  className="cursor-pointer border-t border-[#edf0f5] hover:bg-[#f0f6ff]"
                  onClick={() => router.push("/expenses")}
                  onContextMenu={(e) => openMenu(e, toContextMenuItems(rowActions(r)))}
                >
                  <td className="px-3 py-2.5 text-[#687386]">
                    {formatDateShort(r.date)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-blue-700">
                    {r.entry_number}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] text-[#98a2b3]">
                      {r.expense_account_code}
                    </span>{" "}
                    {r.expense_account_name}
                  </td>
                  <td className="px-3 py-2.5">{r.safe_name || "—"}</td>
                  <td className="px-3 py-2.5 font-bold text-rose-600">
                    {formatCurrency(Number(r.amount))}
                  </td>
                  <td className="px-3 py-2.5 text-[#687386]">
                    {r.description || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <ReportRowActions
                      busy={busyId === r.entry_id}
                      onEdit={() => router.push("/expenses")}
                      onDelete={() => void handleDelete(r)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t-2 border-[#d0d7e2] bg-[#f8faff] font-bold">
              <tr>
                <td className="px-3 py-2.5" colSpan={4}>
                  المجموع ({sorted.length})
                </td>
                <td className="px-3 py-2.5 text-rose-700">
                  {formatCurrency(total)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {contextMenu}
    </div>
  );
}

export function sectionTableData(section: ReportSection, bundle: ReportsBundle) {
  switch (section) {
    case "invoices":
      return bundle.invoices;
    case "customers":
      return bundle.customers;
    case "products":
      return bundle.products;
    case "treasury":
      return bundle.treasury;
    case "expenses":
      return bundle.expenses;
    case "overview":
      return [
        { label: "صافي المبيعات", value: bundle.overview.net_sales },
        { label: "إجمالي الربح", value: bundle.overview.gross_profit },
        { label: "هامش الربح %", value: bundle.overview.margin },
        { label: "المحصل", value: bundle.overview.collected },
        { label: "المتبقي", value: bundle.overview.remaining },
        { label: "صافي الخزينة", value: bundle.overview.treasury_net },
        { label: "إجمالي المصروفات", value: bundle.overview.expenses_total },
        { label: "المخزون بالتكلفة", value: bundle.overview.inventory_value },
        {
          label: "المخزون بسعر البيع",
          value: bundle.overview.inventory_value_sell,
        },
        { label: "مديونيات العملاء", value: bundle.overview.customer_debt },
      ];
  }
}

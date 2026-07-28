"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { formatDateRelative, smartSearchMatch } from "@/lib/utils";
import {
  AUDIT_ACTION_LABELS,
  buildAuditFieldChanges,
  entityTypeLabel,
  resolveAuditEntityHref,
  sourceLabel,
  type AuditLogRow,
} from "@/lib/audit";
import { DateField } from "@/components/ui/DateField";
import { Modal } from "@/components/ui/Modal";
import type { RowAction } from "@/components/ui/TableRowActions";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { useToast } from "@/components/ui/Toast";
import { RefreshCw, ScrollText, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { isBrowserOnline, withTimeout } from "@/lib/offline";

const ACTION_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "كل العمليات" },
  { value: "invoice.delete", label: AUDIT_ACTION_LABELS["invoice.delete"] },
  {
    value: "product.price_change",
    label: AUDIT_ACTION_LABELS["product.price_change"],
  },
  { value: "product.delete", label: AUDIT_ACTION_LABELS["product.delete"] },
  { value: "customer.delete", label: AUDIT_ACTION_LABELS["customer.delete"] },
  { value: "supplier.delete", label: AUDIT_ACTION_LABELS["supplier.delete"] },
  { value: "safe.movement", label: AUDIT_ACTION_LABELS["safe.movement"] },
  { value: "safe.movement.edit", label: AUDIT_ACTION_LABELS["safe.movement.edit"] },
  { value: "safe.transfer", label: AUDIT_ACTION_LABELS["safe.transfer"] },
  { value: "safe.transfer.edit", label: AUDIT_ACTION_LABELS["safe.transfer.edit"] },
  { value: "expense.update", label: AUDIT_ACTION_LABELS["expense.update"] },
  { value: "expense.delete", label: AUDIT_ACTION_LABELS["expense.delete"] },
  { value: "settings.update", label: AUDIT_ACTION_LABELS["settings.update"] },
  { value: "user.update", label: AUDIT_ACTION_LABELS["user.update"] },
  { value: "user.delete", label: AUDIT_ACTION_LABELS["user.delete"] },
  {
    value: "system.factory_reset",
    label: AUDIT_ACTION_LABELS["system.factory_reset"],
  },
];

function actionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] || action;
}

function roleLabel(role: string | null): string {
  if (role === "owner") return "مالك";
  if (role === "manager") return "مدير";
  if (role === "employee") return "موظف";
  return role || "—";
}

function summarizeChange(row: AuditLogRow): string {
  const meta = row.meta || {};
  if (row.action === "product.price_change") {
    const before = row.before_data || {};
    const after = row.after_data || {};
    const parts: string[] = [];
    if (before.buy_price !== after.buy_price) {
      parts.push(`شراء ${before.buy_price} ← ${after.buy_price}`);
    }
    if (before.sell_price !== after.sell_price) {
      parts.push(`بيع ${before.sell_price} ← ${after.sell_price}`);
    }
    return parts.join(" · ") || "تغيير سعر";
  }
  if (row.action === "safe.movement") {
    const type = meta.type === "deposit" ? "إيداع" : "سحب";
    return `${type} ${meta.amount ?? ""}`.trim();
  }
  if (row.action === "safe.transfer") {
    return `مبلغ ${meta.amount ?? ""}`;
  }
  if (row.action === "invoice.delete") {
    const before = row.before_data || {};
    return `إجمالي ${before.total ?? "—"} · مدفوع ${before.paid_amount ?? "—"}`;
  }
  if (row.action === "user.update" && meta.password_changed) {
    return "شمل تغيير كلمة المرور";
  }
  const changes = buildAuditFieldChanges(
    row.before_data,
    row.after_data,
    row.meta
  );
  if (changes.length > 0) {
    return changes
      .slice(0, 2)
      .map((c) =>
        c.before !== "—" && c.after !== "—"
          ? `${c.label}: ${c.before} ← ${c.after}`
          : `${c.label}: ${c.after !== "—" ? c.after : c.before}`
      )
      .join(" · ");
  }
  return row.entity_label || "—";
}

export default function AuditPage() {
  const supabase = useMemo(() => createClient(), []);
  const { error: toastError } = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<AuditLogRow | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  const load = useCallback(async () => {
    setLoading(true);
    if (!isBrowserOnline()) {
      setRows([]);
      toastError("سجل التدقيق يحتاج اتصال بالإنترنت");
      setLoading(false);
      return;
    }
    try {
      let q = supabase
        .from("audit_logs")
        .select(
          "id, created_at, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, before_data, after_data, meta, source"
        )
        .order("created_at", { ascending: false })
        .limit(300);

      if (actionFilter) q = q.eq("action", actionFilter);
      if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00`);
      if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59.999`);

      const { data, error } = await withTimeout(
        Promise.resolve(q) as Promise<{
          data: AuditLogRow[] | null;
          error: { message?: string } | null;
        }>,
        5000
      );
      if (error) {
        toastError(error.message || "تعذر تحميل سجل التدقيق");
        setRows([]);
      } else {
        setRows((data || []) as AuditLogRow[]);
      }
    } catch {
      toastError("تعذر تحميل سجل التدقيق — تحقق من الاتصال");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, actionFilter, dateFrom, dateTo, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setShowRaw(false);
  }, [selected?.id]);

  const filtered = useMemo(() => {
    return rows.filter((row) =>
      smartSearchMatch(searchTerm, [
        row.actor_name,
        row.entity_label,
        actionLabel(row.action),
        row.action,
        entityTypeLabel(row.entity_type),
        summarizeChange(row),
      ])
    );
  }, [rows, searchTerm]);

  function auditRowActions(row: AuditLogRow): RowAction[] {
    const href = resolveAuditEntityHref(row);
    const actions: RowAction[] = [
      {
        label: "عرض",
        tone: "view",
        icon: "eye",
        onClick: () => setSelected(row),
      },
    ];
    if (href) {
      actions.push({
        label: "الانتقال إلى العملية",
        tone: "history",
        icon: "history",
        onClick: () => router.push(href),
      });
    }
    return actions;
  }

  const selectedChanges = useMemo(() => {
    if (!selected) return [];
    return buildAuditFieldChanges(
      selected.before_data,
      selected.after_data,
      selected.meta
    );
  }, [selected]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">سجل التدقيق</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            تتبع التعديلات الحساسة: الأسعار، حذف الفواتير، الخزنة، المستخدمين،
            والإعدادات.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          تحديث
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="بحث في الفاعل أو العملية أو الكيان…"
            className="w-full rounded-lg border border-gray-200 py-2 pr-9 pl-3 text-sm outline-none focus:border-gray-400"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          {ACTION_FILTERS.map((f) => (
            <option key={f.value || "all"} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <DateField
          value={dateFrom}
          onChange={setDateFrom}
          className="w-[140px]"
        />
        <DateField value={dateTo} onChange={setDateTo} className="w-[140px]" />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">
            جاري التحميل…
          </p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <ScrollText className="h-10 w-10 text-gray-300" strokeWidth={1.5} />
            <p className="text-sm font-semibold text-gray-600">لا توجد أحداث</p>
            <p className="text-xs text-gray-400">
              ستظهر هنا العمليات الحساسة فور حدوثها.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-right text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">الوقت</th>
                  <th className="px-3 py-2.5 font-semibold">الفاعل</th>
                  <th className="px-3 py-2.5 font-semibold">نوع العملية</th>
                  <th className="px-3 py-2.5 font-semibold">رقم / اسم العملية</th>
                  <th className="px-3 py-2.5 font-semibold">ملخص</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((row) => {
                  const href = resolveAuditEntityHref(row);
                  return (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => {
                      if (href) {
                        router.push(href);
                        return;
                      }
                      setSelected(row);
                    }}
                    onContextMenu={(e) =>
                      openMenu(e, toContextMenuItems(auditRowActions(row)))
                    }
                    title={href ? "اضغط للانتقال · زر أيمن للتفاصيل" : "عرض التفاصيل"}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-600">
                      {formatDateRelative(row.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-gray-900">
                        {row.actor_name || "نظام"}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {roleLabel(row.actor_role)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-gray-800">
                        {actionLabel(row.action)}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {entityTypeLabel(row.entity_type)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">
                      <p className={`font-medium ${href ? "text-blue-700 underline-offset-2 hover:underline" : ""}`}>
                        {row.entity_label || "—"}
                      </p>
                      {row.entity_id ? (
                        <p className="font-mono text-[10px] text-gray-400" dir="ltr">
                          {row.entity_id.slice(0, 8)}…
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-gray-500">
                      {summarizeChange(row)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? actionLabel(selected.action) : ""}
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">الفاعل</p>
                <p className="font-semibold">
                  {selected.actor_name || "نظام"} (
                  {roleLabel(selected.actor_role)})
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">الوقت</p>
                <p className="font-semibold">
                  {new Date(selected.created_at).toLocaleString("ar-EG")}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">الكيان</p>
                <p className="font-semibold">
                  {selected.entity_label || "—"}
                  <span className="mr-1 font-normal text-gray-400">
                    ({entityTypeLabel(selected.entity_type)})
                  </span>
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2">
                <p className="text-gray-400">المصدر</p>
                <p className="font-semibold">{sourceLabel(selected.source)}</p>
              </div>
            </div>

            {resolveAuditEntityHref(selected) ? (
              <button
                type="button"
                onClick={() => {
                  const href = resolveAuditEntityHref(selected);
                  if (href) router.push(href);
                }}
                className="w-full rounded-lg bg-blue-700 py-2 text-xs font-bold text-white hover:bg-blue-800"
              >
                فتح العملية: {selected.entity_label || entityTypeLabel(selected.entity_type)}
              </button>
            ) : null}

            {selectedChanges.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-gray-500">
                  التغييرات
                </p>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-2.5 py-2 font-semibold">الحقل</th>
                        <th className="px-2.5 py-2 font-semibold">قبل</th>
                        <th className="px-2.5 py-2 font-semibold">بعد</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selectedChanges.map((change) => (
                        <tr key={change.key}>
                          <td className="px-2.5 py-2 font-semibold text-gray-800">
                            {change.label}
                          </td>
                          <td className="px-2.5 py-2 text-gray-500" dir="auto">
                            {change.before}
                          </td>
                          <td className="px-2.5 py-2 font-medium text-gray-900" dir="auto">
                            {change.after}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                لا توجد تفاصيل حقول إضافية لهذه العملية.
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="text-xs font-semibold text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
            >
              {showRaw ? "إخفاء البيانات الخام" : "عرض البيانات الخام"}
            </button>

            {showRaw && (
              <div className="space-y-2">
                {selected.before_data && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-500">قبل</p>
                    <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] text-green-100" dir="ltr">
                      {JSON.stringify(selected.before_data, null, 2)}
                    </pre>
                  </div>
                )}
                {selected.after_data && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-500">بعد</p>
                    <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] text-green-100" dir="ltr">
                      {JSON.stringify(selected.after_data, null, 2)}
                    </pre>
                  </div>
                )}
                {selected.meta && Object.keys(selected.meta).length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-gray-500">تفاصيل</p>
                    <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] text-green-100" dir="ltr">
                      {JSON.stringify(selected.meta, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      {contextMenu}
    </div>
  );
}

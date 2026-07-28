"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";
import {
  formatCurrency,
  formatDateRelative,
  formatDateShort,
} from "@/lib/utils";
import {
  acknowledgeShiftAbandonedNotification,
  classifyShiftVariance,
  fetchShiftActivity,
  fetchShiftById,
  finalizeAbandonedShiftCount,
  hasUnreadShiftAbandonedNotification,
  isAbandonedCloseReason,
  isAbandonedShiftResolved,
  needsLateCount,
  needsVarianceClassification,
  SHIFT_VARIANCE_CLASS_LABELS,
  type ShiftActivity,
  type ShiftRow,
} from "@/lib/shifts";
import {
  ShiftVarianceClassifyModal,
  suggestedVarianceClass,
  type ClassifyFormState,
} from "@/components/shifts/ShiftVarianceClassifyModal";
import { safesOrderQuery } from "@/lib/safes-order";
import type { Safe } from "@/types";

const INVOICE_TYPE_LABELS: Record<string, string> = {
  sale: "بيع",
  purchase: "شراء",
  sale_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
};

const TXN_TYPE_LABELS: Record<string, string> = {
  deposit: "إيداع",
  withdrawal: "سحب",
  transfer: "نقل",
};

function closeReasonLabel(reason: ShiftRow["close_reason"]) {
  if (reason === "abandoned_logout") return "خروج بدون تسليم";
  if (reason === "abandoned_unload") return "إغلاق بدون تسليم";
  if (reason === "normal") return "تسليم عادي";
  return "—";
}

export default function ShiftDetailPage() {
  const params = useParams();
  const router = useRouter();
  const shiftId = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { profile, isEmployee, can } = useAuth();
  const { success, error: toastError } = useToast();

  const canViewClosed = !isEmployee && (can("treasury") || can("reports"));
  const canClassify = !isEmployee && can("treasury");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [activity, setActivity] = useState<ShiftActivity | null>(null);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [needsAck, setNeedsAck] = useState(false);
  const [lateCount, setLateCount] = useState("");
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyForm, setClassifyForm] = useState<ClassifyFormState>({
    class: "",
    reason: "",
    relatedSafeId: "",
  });
  const [tab, setTab] = useState<"invoices" | "cash">("invoices");

  const load = useCallback(async () => {
    if (!shiftId) return;
    setLoading(true);
    try {
      const row = await fetchShiftById(supabase, shiftId);
      if (!row) {
        toastError("الوردية مش موجودة");
        router.replace("/shifts");
        return;
      }

      if (row.status === "closed" && isEmployee && !canViewClosed) {
        toastError("مفيش صلاحية لعرض الورديات المقفلة");
        router.replace("/shifts");
        return;
      }

      setShift(row);

      const act = await fetchShiftActivity(supabase, {
        safeId: row.safe_id,
        openedAt: row.opened_at,
        openingCash: Number(row.opening_cash) || 0,
        closedAt: row.status === "closed" ? row.closed_at : null,
      });
      setActivity(act);

      if (canClassify) {
        const { data: safesData } = await safesOrderQuery(
          supabase.from("safes").select("*").eq("is_active", true)
        );
        setSafes((safesData as Safe[]) || []);
      }

      if (isAbandonedCloseReason(row.close_reason)) {
        // Finishing count/classify should clear the bell without a second click
        if (isAbandonedShiftResolved(row)) {
          await acknowledgeShiftAbandonedNotification(supabase, row.id);
          setNeedsAck(false);
        } else {
          const unread = await hasUnreadShiftAbandonedNotification(
            supabase,
            row.id
          );
          setNeedsAck(unread);
        }
      } else {
        setNeedsAck(false);
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر تحميل الوردية");
    } finally {
      setLoading(false);
    }
  }, [
    shiftId,
    supabase,
    toastError,
    router,
    isEmployee,
    canViewClosed,
    canClassify,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAck() {
    if (!shift) return;
    setBusy(true);
    try {
      await acknowledgeShiftAbandonedNotification(supabase, shift.id);
      setNeedsAck(false);
      success("تم إخفاء تنبيه الوردية");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر إخفاء التنبيه");
    } finally {
      setBusy(false);
    }
  }

  async function handleLateCount(e: React.FormEvent) {
    e.preventDefault();
    if (!shift || !canClassify) return;
    const counted = Number(lateCount);
    if (Number.isNaN(counted)) {
      toastError("أدخل النقدية المعدودة");
      return;
    }
    setBusy(true);
    try {
      const updated = await finalizeAbandonedShiftCount(supabase, {
        shift,
        countedCash: counted,
      });
      setShift(updated);
      setLateCount("");
      const v = Number(updated.variance) || 0;
      success(
        v === 0
          ? "تم العدّ بدون فرق"
          : `تم العدّ — الفرق ${formatCurrency(v)}`
      );
      if (v === 0) {
        await acknowledgeShiftAbandonedNotification(supabase, updated.id);
        setNeedsAck(false);
      } else {
        setClassifyForm({
          class: suggestedVarianceClass(v),
          reason: "",
          relatedSafeId: "",
        });
        setClassifyOpen(true);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر حفظ العدّ");
    } finally {
      setBusy(false);
    }
  }

  async function handleClassify(e: React.FormEvent) {
    e.preventDefault();
    if (!shift || !classifyForm.class) {
      toastError("اختَر نوع الفرق");
      return;
    }
    setBusy(true);
    try {
      await classifyShiftVariance(supabase, {
        shift,
        class: classifyForm.class,
        reason: classifyForm.reason,
        relatedSafeId: classifyForm.relatedSafeId || null,
        classifiedBy: profile?.id || null,
      });
      if (isAbandonedCloseReason(shift.close_reason)) {
        await acknowledgeShiftAbandonedNotification(supabase, shift.id);
        setNeedsAck(false);
      }
      success("تم تسجيل سبب فرق الدرج في الخزنة");
      setClassifyOpen(false);
      setClassifyForm({ class: "", reason: "", relatedSafeId: "" });
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر تصنيف الفرق");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#1473e6]" />
      </div>
    );
  }

  if (!shift) return null;

  const variance =
    shift.variance != null ? Number(shift.variance) : null;
  const showLateCount = canClassify && needsLateCount(shift);
  const showClassifyBtn =
    canClassify && needsVarianceClassification(shift);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-16 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/shifts"
            className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-[#1473e6] hover:underline"
          >
            <ArrowRight className="h-4 w-4" />
            الرجوع للورديات
          </Link>
          <h1 className="text-2xl font-bold text-[#172033]">تفاصيل الوردية</h1>
          <p className="mt-1 text-sm text-[#687386]">
            {shift.safe?.name || "الدرج"} ·{" "}
            {shift.status === "open" ? "مفتوحة" : "مقفلة"}
          </p>
        </div>
        {isAbandonedCloseReason(shift.close_reason) && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800 ring-1 ring-red-200">
            {closeReasonLabel(shift.close_reason)}
          </span>
        )}
      </div>

      {needsAck && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-amber-950">
              تنبيه خروج بدون تسليم
            </p>
            <p className="text-xs text-amber-800">
              راجع التفاصيل وعدّ الدرج إن لزم، ثم أكّد الاطلاع لإخفاء الإشعار من
              الجرس.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleAck()}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-800 px-3.5 py-2 text-sm font-bold text-white hover:bg-amber-900 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            تم الاطلاع / إخفاء التنبيه
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="فتحها" value={shift.opener?.full_name || "—"} />
        <InfoCard
          label="وقت الفتح"
          value={
            shift.opened_at
              ? `${formatDateRelative(shift.opened_at)} · ${formatDateShort(shift.opened_at)}`
              : "—"
          }
        />
        <InfoCard label="أقفلها" value={shift.closer?.full_name || "—"} />
        <InfoCard
          label="وقت الإقفال"
          value={
            shift.closed_at
              ? `${formatDateRelative(shift.closed_at)} · ${formatDateShort(shift.closed_at)}`
              : "—"
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard
          label="افتتاح الدرج"
          value={formatCurrency(Number(shift.opening_cash) || 0)}
        />
        <InfoCard
          label="المتوقع"
          value={formatCurrency(
            shift.expected_cash != null
              ? Number(shift.expected_cash)
              : activity?.totals.expectedCash || 0
          )}
        />
        <InfoCard
          label="المعدود"
          value={
            shift.counted_cash == null
              ? "بدون عدّ"
              : formatCurrency(Number(shift.counted_cash) || 0)
          }
          accent={
            shift.counted_cash == null
              ? "danger"
              : variance === 0
                ? "ok"
                : "warn"
          }
        />
        <InfoCard
          label="الفرق"
          value={
            variance == null ? "—" : formatCurrency(variance)
          }
          accent={
            variance == null
              ? undefined
              : variance === 0
                ? "ok"
                : "warn"
          }
        />
        <InfoCard
          label="المبيعات"
          value={formatCurrency(
            shift.sales_total != null
              ? Number(shift.sales_total)
              : activity?.totals.salesTotal || 0
          )}
        />
        <InfoCard
          label="التصنيف"
          value={
            shift.variance_class
              ? SHIFT_VARIANCE_CLASS_LABELS[shift.variance_class]
              : variance && variance !== 0
                ? "بانتظار التصنيف"
                : "—"
          }
        />
      </div>

      {shift.notes && (
        <div className="rounded-xl border border-[#e5eaf1] bg-white p-4 text-sm text-[#526176]">
          <p className="mb-1 text-xs font-bold text-[#98a2b3]">ملاحظات</p>
          <p className="whitespace-pre-wrap">{shift.notes}</p>
          {shift.variance_reason && (
            <p className="mt-2 text-xs text-[#687386]">
              سبب الفرق: {shift.variance_reason}
            </p>
          )}
        </div>
      )}

      {showLateCount && (
        <form
          onSubmit={handleLateCount}
          className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4"
        >
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-red-700" />
            <h2 className="font-bold text-red-950">عدّ الدرج الآن</h2>
          </div>
          <p className="text-sm text-red-800">
            الوردية اتقفلت بدون تسليم — ادخل النقدية المعدودة عشان يتسجل الفرق
            ويتصنّف.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <label className="mb-1 block text-xs font-semibold text-red-900">
                النقدية المعدودة
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={lateCount}
                onChange={(e) => setLateCount(e.target.value)}
                className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-red-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-900 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "حفظ العدّ"
              )}
            </button>
          </div>
        </form>
      )}

      {showClassifyBtn && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="mb-2 text-sm text-amber-900">
            فيه فرق درج لسه محتاج تصنيف عشان يتسجل في الخزنة.
          </p>
          <button
            type="button"
            onClick={() => {
              setClassifyForm({
                class: suggestedVarianceClass(Number(shift.variance) || 0),
                reason: "",
                relatedSafeId: "",
              });
              setClassifyOpen(true);
            }}
            className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-200"
          >
            صنّف الفرق
          </button>
        </div>
      )}

      <div className="rounded-xl border border-[#e5eaf1] bg-white">
        <div className="flex border-b border-[#eef1f6]">
          <button
            type="button"
            onClick={() => setTab("invoices")}
            className={`px-4 py-3 text-sm font-bold ${
              tab === "invoices"
                ? "border-b-2 border-[#1473e6] text-[#1473e6]"
                : "text-[#687386]"
            }`}
          >
            الفواتير ({activity?.invoices.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setTab("cash")}
            className={`px-4 py-3 text-sm font-bold ${
              tab === "cash"
                ? "border-b-2 border-[#1473e6] text-[#1473e6]"
                : "text-[#687386]"
            }`}
          >
            حركات الدرج ({activity?.safeTransactions.length || 0})
          </button>
        </div>

        <div className="overflow-x-auto p-3">
          {tab === "invoices" ? (
            !activity?.invoices.length ? (
              <p className="px-2 py-6 text-center text-sm text-[#98a2b3]">
                مفيش فواتير في فترة الوردية
              </p>
            ) : (
              <table className="w-full min-w-[560px] text-right text-sm">
                <thead>
                  <tr className="border-b border-[#eef1f6] text-[11px] text-[#98a2b3]">
                    <th className="px-2 py-2">الرقم</th>
                    <th className="px-2 py-2">النوع</th>
                    <th className="px-2 py-2">الإجمالي</th>
                    <th className="px-2 py-2">المدفوع</th>
                    <th className="px-2 py-2">الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-[#f3f5f8]">
                      <td className="px-2 py-2 font-semibold text-[#172033]">
                        {inv.invoice_number}
                      </td>
                      <td className="px-2 py-2">
                        {INVOICE_TYPE_LABELS[inv.type] || inv.type}
                      </td>
                      <td className="px-2 py-2">
                        {formatCurrency(Number(inv.total) || 0)}
                      </td>
                      <td className="px-2 py-2">
                        {formatCurrency(Number(inv.paid_amount) || 0)}
                      </td>
                      <td className="px-2 py-2 text-[#687386]">
                        {formatDateShort(inv.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : !activity?.safeTransactions.length ? (
            <p className="px-2 py-6 text-center text-sm text-[#98a2b3]">
              مفيش حركات على الدرج في فترة الوردية
            </p>
          ) : (
            <table className="w-full min-w-[560px] text-right text-sm">
              <thead>
                <tr className="border-b border-[#eef1f6] text-[11px] text-[#98a2b3]">
                  <th className="px-2 py-2">النوع</th>
                  <th className="px-2 py-2">المبلغ</th>
                  <th className="px-2 py-2">الوصف</th>
                  <th className="px-2 py-2">الوقت</th>
                </tr>
              </thead>
              <tbody>
                {activity.safeTransactions.map((t) => (
                  <tr key={t.id} className="border-b border-[#f3f5f8]">
                    <td className="px-2 py-2">
                      {TXN_TYPE_LABELS[t.type] || t.type}
                      {t.reference_type ? (
                        <span className="mr-1 text-[10px] text-[#98a2b3]">
                          ({t.reference_type})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 font-semibold">
                      {formatCurrency(Number(t.amount) || 0)}
                    </td>
                    <td className="px-2 py-2 text-[#687386]">
                      {t.description || "—"}
                    </td>
                    <td className="px-2 py-2 text-[#687386]">
                      {formatDateShort(t.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {classifyOpen && shift && canClassify && (
        <ShiftVarianceClassifyModal
          shift={shift}
          safes={safes}
          form={classifyForm}
          busy={busy}
          onChange={setClassifyForm}
          onCancel={() => setClassifyOpen(false)}
          onSubmit={handleClassify}
        />
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "ok" | "warn" | "danger";
}) {
  const valueClass =
    accent === "ok"
      ? "text-emerald-700"
      : accent === "warn"
        ? "text-amber-700"
        : accent === "danger"
          ? "text-red-700"
          : "text-[#172033]";

  return (
    <div className="rounded-xl border border-[#e5eaf1] bg-white p-3.5">
      <p className="text-[11px] font-semibold text-[#98a2b3]">{label}</p>
      <p className={`mt-1 text-sm font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}

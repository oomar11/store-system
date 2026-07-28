"use client";

import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { ShiftRow, ShiftVarianceClass } from "@/lib/shifts";
import type { Safe } from "@/types";

export type ClassifyFormState = {
  class: ShiftVarianceClass | "";
  reason: string;
  relatedSafeId: string;
};

type Props = {
  shift: ShiftRow;
  safes: Safe[];
  form: ClassifyFormState;
  busy?: boolean;
  onChange: (form: ClassifyFormState) => void;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
};

export function ShiftVarianceClassifyModal({
  shift,
  safes,
  form,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: Props) {
  const variance = Number(shift.variance) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl"
      >
        <div>
          <h3 className="text-lg font-bold text-[#172033]">تصنيف فرق الدرج</h3>
          <p className="mt-1 text-sm text-[#687386]">
            الفرق:{" "}
            <span className="font-bold text-amber-800">
              {formatCurrency(variance)}
            </span>
            {" — "}
            {variance > 0
              ? "المعدود أكبر من المتوقع (زيادة)"
              : "المعدود أقل من المتوقع (نقص)"}
          </p>
          <p className="mt-1 text-xs text-[#98a2b3]">
            اختَر إيه اللي حصل عشان النظام يسجّل الحركة في الخزنة صح.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-[#526176]">
            نوع الحركة
          </label>
          <select
            required
            value={form.class}
            onChange={(e) =>
              onChange({
                ...form,
                class: e.target.value as ShiftVarianceClass | "",
              })
            }
            className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
          >
            <option value="">اختَر</option>
            {variance < 0 && (
              <>
                <option value="transfer">
                  اتنقلت لخزنة تانية (نقص من الدرج)
                </option>
                <option value="withdrawal">اتسحبت نقدي من الدرج</option>
                <option value="shortage">عجز / مش متوضح السبب</option>
                <option value="other">
                  سبب آخر (هيتعمل سحب لتعديل الرصيد)
                </option>
              </>
            )}
            {variance > 0 && (
              <>
                <option value="transfer">
                  جت من خزنة تانية (زيادة في الدرج)
                </option>
                <option value="deposit">اتضافت نقدية للدرج</option>
                <option value="surplus">زيادة / فلوس اتلاقت</option>
                <option value="other">
                  سبب آخر (هيتعمل إيداع لتعديل الرصيد)
                </option>
              </>
            )}
          </select>
        </div>

        {form.class === "transfer" && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#526176]">
              الخزنة التانية
            </label>
            <select
              required
              value={form.relatedSafeId}
              onChange={(e) =>
                onChange({ ...form, relatedSafeId: e.target.value })
              }
              className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
            >
              <option value="">اختَر الخزنة</option>
              {safes
                .filter((s) => s.id !== shift.safe_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {formatCurrency(s.balance)}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-[#526176]">
            ملاحظة / تفاصيل
          </label>
          <textarea
            value={form.reason}
            onChange={(e) => onChange({ ...form, reason: e.target.value })}
            rows={2}
            className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
            placeholder="مثال: اتنقلت لخزنة المحل / سحب صاحب المحل…"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[#e5eaf1] py-2.5 text-sm font-semibold text-[#526176]"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={busy || !form.class}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#1473e6] py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            تأكيد التسجيل
          </button>
        </div>
      </form>
    </div>
  );
}

export function suggestedVarianceClass(
  variance: number
): ShiftVarianceClass | "" {
  if (variance < 0) return "withdrawal";
  if (variance > 0) return "deposit";
  return "";
}

"use client";

import { ArrowDown, ArrowUp, Percent, Wallet } from "lucide-react";
import type { Safe } from "@/types";
import type { SettingsFormState } from "./settings-form";
import { SettingsCard, SettingsField } from "./SettingsCard";

type FinanceSettingsSectionProps = {
  form: SettingsFormState;
  setForm: React.Dispatch<React.SetStateAction<SettingsFormState>>;
  safes: Safe[];
  reordering: boolean;
  moveSafe: (index: number, direction: -1 | 1) => void;
};

export function FinanceSettingsSection({
  form,
  setForm,
  safes,
  reordering,
  moveSafe,
}: FinanceSettingsSectionProps) {
  return (
    <div className="space-y-5">
      <SettingsCard
        title="إعدادات الضريبة"
        description="إضافة ضريبة القيمة المضافة تلقائياً على الفواتير."
        icon={Percent}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--surface-subtle)] px-4 py-3">
            <div>
              <p className="text-sm font-bold text-[var(--foreground)]">
                تفعيل الضريبة
              </p>
              <p className="text-xs text-[var(--muted)]">
                تُحسب النسبة تلقائياً عند إنشاء الفاتورة
              </p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={form.tax_enabled}
                onChange={(e) =>
                  setForm({ ...form, tax_enabled: e.target.checked })
                }
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[var(--surface-muted)] after:absolute after:right-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[var(--border)] after:bg-white after:transition-all after:content-[''] peer-checked:bg-[var(--primary)] peer-checked:after:translate-x-full peer-checked:after:border-white rtl:peer-checked:after:-translate-x-full" />
            </label>
          </div>

          <SettingsField label="نسبة الضريبة (%)">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.tax_rate}
                onChange={(e) =>
                  setForm({ ...form, tax_rate: +e.target.value || 0 })
                }
                disabled={!form.tax_enabled}
                className="settings-input w-32 max-w-full"
                dir="ltr"
              />
              <span className="text-sm text-[var(--muted)]">
                {form.tax_rate}% ضريبة القيمة المضافة
              </span>
            </div>
          </SettingsField>
        </div>
      </SettingsCard>

      <SettingsCard
        title="درج الكاشير (الوردية)"
        description="الخزنة اللي الموظف بيستلمها ويسلّمها عند فتح/إقفال الوردية."
        icon={Wallet}
      >
        <SettingsField label="خزنة الدرج">
          <select
            value={form.drawer_safe_id}
            onChange={(e) =>
              setForm({ ...form, drawer_safe_id: e.target.value })
            }
            className="settings-select max-w-md"
          >
            <option value="">— اختر خزنة الدرج —</option>
            {safes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {safes.length === 0 ? (
            <p className="mt-2 text-xs text-amber-700">
              مفيش خزائن نشطة — أنشئ خزنة من صفحة الخزينة أولاً.
            </p>
          ) : !form.drawer_safe_id ? (
            <div className="mt-3 rounded-xl border border-amber-300/80 bg-amber-50 px-3 py-2.5 dark:bg-amber-950/30">
              <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                لم يُحدَّد درج الكاشير
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">
                عندك {safes.length} خزنة نشطة — لازم تختار واحدة كـ
                <strong> درج الكاشير</strong> عشان الورديات تشتغل صح.
              </p>
            </div>
          ) : null}
        </SettingsField>
      </SettingsCard>

      <SettingsCard
        title="ترتيب الخزن"
        description="الترتيب يظهر في نقطة البيع واختيار الخزنة في الفواتير."
        icon={Wallet}
      >
        {safes.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">لا توجد خزائن لترتيبها</p>
        ) : (
          <ul className="space-y-2">
            {safes.map((s, index) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--border)_75%,transparent)] bg-[var(--surface-subtle)] px-3 py-2.5"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface)] text-xs font-bold text-[var(--muted)] ring-1 ring-[var(--border)]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                    {s.name}
                  </p>
                  {form.drawer_safe_id === s.id && (
                    <p className="text-[11px] font-semibold text-[var(--primary)]">
                      درج الكاشير
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={reordering || index === 0}
                    onClick={() => void moveSafe(index, -1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface))] disabled:opacity-40"
                    title="أعلى"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={reordering || index === safes.length - 1}
                    onClick={() => void moveSafe(index, 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface))] disabled:opacity-40"
                    title="أسفل"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}

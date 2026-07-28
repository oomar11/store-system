import Link from "next/link";
import { ArrowLeft, Check, Clock3, Store } from "lucide-react";
import type { SetupStep } from "./types";

export function SetupGuide({ steps }: { steps: SetupStep[] }) {
  const completed = steps.filter((step) => step.done).length;

  return (
    <section className="dashboard-card overflow-hidden p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]">
            <Store className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--primary)]">
              البداية السريعة
            </p>
            <h2 className="mt-1 text-base font-black text-[var(--foreground)]">
              جهّز متجرك في ثلاث خطوات
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
              أكمل الأساسيات لتبدأ البيع وتتبع النقدية والمخزون بثقة.
            </p>
          </div>
        </div>
        <div className="min-w-[160px]">
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold text-[var(--muted)]">
            <span>نسبة الإكمال</span>
            <span>{completed} / {steps.length}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
            <div
              className="h-full rounded-full bg-gradient-to-l from-[var(--primary)] to-[#38bdf8] transition-[width] duration-500"
              style={{ width: `${(completed / steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <ol className="mt-6 grid gap-3 lg:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Link
              href={step.href}
              className={`group flex h-full items-center gap-3 rounded-2xl border p-4 ${
                step.done
                  ? "border-[color-mix(in_srgb,var(--success)_40%,var(--border))] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))]"
                  : "border-[var(--border)] bg-[var(--surface-subtle)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] hover:bg-[var(--surface)]"
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-black ${
                  step.done
                    ? "bg-[var(--success)] text-white"
                    : "bg-[var(--surface)] text-[var(--primary)] shadow-[0_5px_16px_rgba(20,115,230,0.1)]"
                }`}
              >
                {step.done ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-black text-[var(--foreground)]">
                  {step.title}
                </span>
                <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">
                  {step.subtitle}
                </span>
              </span>
              <ArrowLeft className="h-4 w-4 shrink-0 text-[var(--muted-soft)] transition-transform group-hover:-translate-x-0.5 group-hover:text-[var(--primary)]" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function OpenShiftBanner() {
  return (
    <Link
      href="/shifts"
      className="group flex items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--warning)_40%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_12%,var(--surface))] px-4 py-3.5 shadow-[0_8px_28px_rgba(245,165,36,0.08)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--warning)_55%,var(--border))]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface)] text-[var(--warning)] shadow-sm">
        <Clock3 className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-black text-[var(--foreground)]">هناك وردية مفتوحة الآن</span>
        <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
          تابع حركة الوردية أو أغلقها عند انتهاء العمل
        </span>
      </span>
      <span className="hidden rounded-lg bg-[var(--surface)] px-3 py-1.5 text-[10px] font-bold text-[var(--warning)] sm:block">
        إدارة الوردية
      </span>
      <ArrowLeft className="h-4 w-4 shrink-0 text-[var(--warning)] transition-transform group-hover:-translate-x-0.5" />
    </Link>
  );
}

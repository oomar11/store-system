import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Plus,
  Sparkles,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { DashboardStats } from "./types";

interface DashboardHeroProps {
  stats: DashboardStats;
  userName?: string;
  needsSetup: boolean;
}

export function DashboardHero({
  stats,
  userName,
  needsSetup,
}: DashboardHeroProps) {
  const firstName = userName?.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const primaryHref = needsSetup
    ? stats.totalSafes === 0
      ? "/treasury"
      : "/products"
    : "/pos";
  const primaryLabel = needsSetup
    ? stats.totalSafes === 0
      ? "ابدأ بإضافة خزنة"
      : "أضف أصنافك"
    : "عملية بيع جديدة";

  return (
    <section className="dashboard-hero relative isolate overflow-hidden rounded-[28px] px-5 py-6 text-white sm:px-7 sm:py-8 lg:px-9">
      <div className="dashboard-orb dashboard-orb-one" aria-hidden="true" />
      <div className="dashboard-orb dashboard-orb-two" aria-hidden="true" />
      <div className="relative z-10 grid items-end gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold backdrop-blur-md">
              <CalendarDays className="h-3.5 w-3.5" />
              {today}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.12)]" />
              البيانات محدّثة الآن
            </span>
          </div>

          <div className="mb-3 flex items-center gap-2 text-sky-100">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-bold">مساحة عمل ويندور</span>
          </div>
          <h1 className="max-w-2xl text-2xl font-black leading-[1.35] tracking-tight sm:text-3xl lg:text-[36px]">
            {firstName ? `أهلاً ${firstName}،` : "أهلاً بك،"} متجرك تحت السيطرة.
          </h1>
          <p className="mt-3 max-w-xl text-xs leading-6 text-blue-100/80 sm:text-sm">
            راقب حركة البيع والمخزون، واتخذ قراراتك اليومية من مكان واحد واضح وسريع.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href={primaryHref}
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-xs font-black text-[#0b4ba4] shadow-[0_14px_35px_rgba(0,0,0,0.2)] hover:-translate-y-0.5 hover:bg-blue-50"
            >
              <Plus className="h-4 w-4" />
              {primaryLabel}
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            </Link>
            {!needsSetup && (
              <Link
                href="/sales"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 px-5 text-xs font-bold text-white backdrop-blur-md hover:-translate-y-0.5 hover:bg-white/15"
              >
                عرض المبيعات
              </Link>
            )}
          </div>
        </div>

        <div className="dashboard-hero-metric rounded-2xl border border-white/15 bg-white/[0.09] p-5 backdrop-blur-xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold text-blue-100/75">إيراد اليوم</p>
              <p className="mt-2 text-2xl font-black tracking-tight sm:text-[28px]">
                {formatCurrency(stats.totalRevenue)}
              </p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-300/15 text-emerald-200">
              <CheckCircle2 className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-5 h-px bg-white/10" />
          <div className="mt-4 flex items-center justify-between text-[11px]">
            <span className="text-blue-100/70">الفواتير المكتملة</span>
            <span className="font-black text-white">
              {stats.totalSalesToday.toLocaleString("ar-EG")} فاتورة
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

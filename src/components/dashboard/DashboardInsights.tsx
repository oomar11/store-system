"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Boxes, ChartNoAxesCombined, PackageOpen } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { DashboardStats } from "./types";

export function DashboardInsights({ stats }: { stats: DashboardStats }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const hasWeeklySales = stats.weeklySales.some((day) => day.value > 0);
  const weeklyTotal = stats.weeklySales.reduce((sum, day) => sum + day.value, 0);
  const stockHealth = stats.totalProducts
    ? Math.max(
        0,
        Math.round(
          ((stats.totalProducts - stats.lowStockCount) / stats.totalProducts) * 100
        )
      )
    : 0;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <section
      className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.65fr)]"
      aria-label="تحليلات المبيعات والمخزون"
    >
      <article className="dashboard-card min-h-[370px] overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]">
              <ChartNoAxesCombined className="h-5 w-5" />
            </span>
            <div>
              <p className="dashboard-eyebrow">اتجاه الأداء</p>
              <h2 className="mt-1 text-sm font-black text-[var(--foreground)]">حركة المبيعات</h2>
              <p className="mt-1 text-[10px] text-[var(--muted)]">آخر سبعة أيام مكتملة حتى اليوم</p>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2.5 text-left">
            <p className="text-[9px] font-bold text-[var(--muted)]">إجمالي الفترة</p>
            <p className="mt-0.5 text-sm font-black text-[var(--foreground)]">
              {formatCurrency(weeklyTotal)}
            </p>
          </div>
        </div>

        <div className="mt-7 h-[245px] w-full" dir="ltr">
          {hasWeeklySales ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={stats.weeklySales}
                margin={{ top: 10, right: 4, left: -18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="dashboardSalesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1473e6" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#1473e6" stopOpacity={0.015} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#e3eaf3"
                  strokeDasharray="4 6"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#7b899c", fontSize: 10 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#9aa7b8", fontSize: 9 }}
                  tickFormatter={(value) =>
                    Number(value) >= 1000
                      ? `${Math.round(Number(value) / 1000)}k`
                      : String(value)
                  }
                />
                <Tooltip
                  formatter={(value) => [
                    formatCurrency(Number(value) || 0),
                    "المبيعات",
                  ]}
                  contentStyle={{
                    direction: "rtl",
                    border: "1px solid #dfe7f1",
                    borderRadius: 12,
                    boxShadow: "0 12px 30px rgba(20,32,51,.12)",
                    fontSize: 11,
                  }}
                  cursor={{ stroke: "#8fc2ff", strokeDasharray: "4 4" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="المبيعات"
                  stroke="#1473e6"
                  strokeWidth={3}
                  fill="url(#dashboardSalesFill)"
                  activeDot={{ r: 5, fill: "#1473e6", stroke: "#fff", strokeWidth: 3 }}
                  dot={{ r: 3, fill: "#fff", stroke: "#1473e6", strokeWidth: 2 }}
                  isAnimationActive={!reduceMotion}
                  animationDuration={700}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center" dir="rtl">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]">
                <ChartNoAxesCombined className="h-6 w-6" />
              </span>
              <p className="mt-4 text-sm font-black text-[var(--foreground)]">الرسم ينتظر أول عملية بيع</p>
              <p className="mt-1 max-w-xs text-[11px] leading-5 text-[var(--muted)]">
                ستظهر حركة الأيام هنا فور اكتمال أول فاتورة مبيعات.
              </p>
              <Link href="/pos" className="mt-3 text-xs font-black text-[var(--primary)] hover:underline">
                ابدأ بيع جديد
              </Link>
            </div>
          )}
        </div>
      </article>

      <article className="dashboard-card flex min-h-[370px] flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="dashboard-eyebrow">صحة المخزون</p>
            <h2 className="mt-1 text-sm font-black text-[var(--foreground)]">جاهزية الأصناف</h2>
            <p className="mt-1 text-[10px] text-[var(--muted)]">نسبة الأصناف فوق حد التنبيه</p>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,#8b5cf6_14%,var(--surface))] text-[#a78bfa]">
            <Boxes className="h-5 w-5" />
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center py-7">
          <div
            className="dashboard-stock-ring relative flex h-44 w-44 items-center justify-center rounded-full"
            style={{ "--stock-progress": `${stockHealth * 3.6}deg` } as CSSProperties}
            role="img"
            aria-label={`توفر المخزون ${stockHealth}%`}
          >
            <div className="flex h-[132px] w-[132px] flex-col items-center justify-center rounded-full bg-[var(--surface)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border)_80%,transparent)]">
              <span className="text-[32px] font-black tracking-tight text-[var(--foreground)]">
                {stockHealth}%
              </span>
              <span className="mt-0.5 text-[10px] font-bold text-[var(--muted)]">متوفر</span>
            </div>
          </div>
        </div>

        <Link
          href="/products?stock=low"
          className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5 hover:border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] hover:bg-[color-mix(in_srgb,var(--warning)_10%,var(--surface))]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--warning)_14%,var(--surface))] text-[var(--warning)]">
            <PackageOpen className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold text-[var(--muted)]">مخزون منخفض</span>
            <span className="mt-0.5 block text-xs font-black text-[var(--foreground)]">
              {stats.lowStockCount.toLocaleString("ar-EG")} صنف
            </span>
          </span>
          <ArrowLeft className="h-4 w-4 text-[var(--muted-soft)] transition-transform group-hover:-translate-x-0.5 group-hover:text-[var(--warning)]" />
        </Link>
      </article>
    </section>
  );
}

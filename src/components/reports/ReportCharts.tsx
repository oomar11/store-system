"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import type {
  CustomerProfitRow,
  DailyTrendPoint,
  PaymentSlice,
  ProductProfitRow,
} from "@/lib/reports/types";

const COLORS = ["#1473e6", "#20a879", "#6d5ce7", "#ed8b2f", "#e11d48", "#16a085"];

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="surface-card min-h-[280px] p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-[#172033]">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-[10px] text-[#98a2b3]">{subtitle}</p>
        )}
      </div>
      <div className="h-[220px] w-full" dir="ltr">
        {children}
      </div>
    </article>
  );
}

function moneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg" dir="rtl">
      <p className="mb-1 font-bold text-slate-700">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {formatCurrency(Number(p.value) || 0)}
        </p>
      ))}
    </div>
  );
}

export function ReportCharts({
  dailyTrend,
  paymentMix,
  topCustomers,
  topProducts,
}: {
  dailyTrend: DailyTrendPoint[];
  paymentMix: PaymentSlice[];
  topCustomers: CustomerProfitRow[];
  topProducts: ProductProfitRow[];
}) {
  const preferReduced = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const customerBars = topCustomers.map((c) => ({
    name: c.name.length > 12 ? c.name.slice(0, 12) + "…" : c.name,
    fullName: c.name,
    profit: c.profit,
    revenue: c.revenue,
  }));

  const productBars = topProducts.map((p) => ({
    name: p.name.length > 12 ? p.name.slice(0, 12) + "…" : p.name,
    fullName: p.name,
    profit: p.profit,
    qty: p.qty_sold,
  }));

  const emptyTrend = dailyTrend.every((d) => !d.net_sales && !d.profit);

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="المبيعات والربح عبر الفترة" subtitle="صافي يومي">
        {emptyTrend ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={56} />
              <Tooltip content={moneyTooltip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="net_sales"
                name="صافي المبيعات"
                stroke="#1473e6"
                strokeWidth={2}
                dot={!preferReduced}
                isAnimationActive={!preferReduced}
              />
              <Line
                type="monotone"
                dataKey="profit"
                name="الربح"
                stroke="#20a879"
                strokeWidth={2}
                dot={!preferReduced}
                isAnimationActive={!preferReduced}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="توزيع طرق الدفع" subtitle="حسب إجمالي فواتير البيع">
        {paymentMix.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={paymentMix}
                dataKey="amount"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={80}
                paddingAngle={2}
                isAnimationActive={!preferReduced}
              >
                {paymentMix.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatCurrency(Number(value) || 0)}
                contentStyle={{ direction: "rtl", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="أفضل العملاء ربحًا" subtitle="أعلى 8">
        {customerBars.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={customerBars} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
              <Tooltip content={moneyTooltip} />
              <Bar
                dataKey="profit"
                name="الربح"
                fill="#6d5ce7"
                radius={[0, 6, 6, 0]}
                isAnimationActive={!preferReduced}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="أفضل الأصناف ربحًا" subtitle="أعلى 8">
        {productBars.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={productBars} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
              <Tooltip content={moneyTooltip} />
              <Bar
                dataKey="profit"
                name="الربح"
                fill="#ed8b2f"
                radius={[0, 6, 6, 0]}
                isAnimationActive={!preferReduced}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </section>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-[#98a2b3]" dir="rtl">
      لا توجد بيانات كافية للرسم في هذه الفترة
    </div>
  );
}

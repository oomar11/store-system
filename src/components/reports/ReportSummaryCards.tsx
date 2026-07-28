"use client";

import { formatCurrency } from "@/lib/utils";
import type { OverviewSummary } from "@/lib/reports/types";
import {
  Banknote,
  CircleAlert,
  Package,
  PiggyBank,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";

const cards: Array<{
  key: keyof OverviewSummary | "margin_display";
  title: string;
  icon: typeof TrendingUp;
  tone: "blue" | "green" | "violet" | "orange" | "cyan" | "rose";
  getValue: (o: OverviewSummary) => string;
  getSub: (o: OverviewSummary) => string;
}> = [
  {
    key: "net_sales",
    title: "صافي المبيعات",
    icon: TrendingUp,
    tone: "blue",
    getValue: (o) => formatCurrency(o.net_sales),
    getSub: (o) => `${o.invoice_count} فاتورة · ${o.return_count} مرتجع`,
  },
  {
    key: "gross_profit",
    title: "إجمالي الربح",
    icon: PiggyBank,
    tone: "green",
    getValue: (o) => formatCurrency(o.gross_profit),
    getSub: (o) => `هامش ${o.margin.toFixed(1)}%`,
  },
  {
    key: "collected",
    title: "المحصل",
    icon: Banknote,
    tone: "cyan",
    getValue: (o) => formatCurrency(o.collected),
    getSub: (o) => `متبقي ${formatCurrency(o.remaining)}`,
  },
  {
    key: "treasury_net",
    title: "صافي الخزينة",
    icon: Wallet,
    tone: "violet",
    getValue: (o) => formatCurrency(o.treasury_net),
    getSub: (o) =>
      `إيداع ${formatCurrency(o.treasury_deposits)} · سحب ${formatCurrency(o.treasury_withdrawals)}`,
  },
  {
    key: "expenses_total",
    title: "المصروفات",
    icon: Receipt,
    tone: "rose",
    getValue: (o) => formatCurrency(o.expenses_total),
    getSub: (o) => `${o.expenses_count} قيد مصروف`,
  },
  {
    key: "inventory_value",
    title: "قيمة المخزون",
    icon: Package,
    tone: "orange",
    getValue: (o) => formatCurrency(o.inventory_value),
    getSub: (o) => `${o.low_stock_count} أصناف منخفضة`,
  },
  {
    key: "customer_debt",
    title: "مديونيات العملاء",
    icon: Users,
    tone: "rose",
    getValue: (o) => formatCurrency(o.customer_debt),
    getSub: () => "أرصدة مدينة حالية",
  },
];

const tones = {
  blue: "bg-[#eaf4ff] text-[#1473e6]",
  green: "bg-[#eefbf4] text-[#1a9a5c]",
  violet: "bg-[#f1efff] text-[#6d5ce7]",
  orange: "bg-[#fff4e7] text-[#ed8b2f]",
  cyan: "bg-[#e9f9f7] text-[#16a085]",
  rose: "bg-[#fff1f3] text-[#e11d48]",
};

export function ReportSummaryCards({ overview }: { overview: OverviewSummary }) {
  return (
    <div className="space-y-3">
      {overview.has_estimated_costs && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            بعض فواتير الفترة تعتمد على سعر الشراء الحالي (تكلفة تقديرية) لأنها
            سُجّلت قبل تفعيل حفظ التكلفة. الفواتير الجديدة تظهر كـ «موثوق».
          </p>
        </div>
      )}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article
              key={card.key}
              className="surface-card p-4 hover:-translate-y-0.5 hover:border-[#d8e3f2] hover:shadow-[0_10px_28px_rgba(16,24,40,0.06)]"
            >
              <div className="mb-3 flex items-start justify-between">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${tones[card.tone]}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </div>
              </div>
              <p className="text-[11px] font-semibold text-[#7d8797]">{card.title}</p>
              <p className="mt-1 text-lg font-bold tracking-tight text-[#172033]">
                {card.getValue(overview)}
              </p>
              <p className="mt-1 text-[10px] text-[#a0a8b5]">{card.getSub(overview)}</p>
            </article>
          );
        })}
      </section>
    </div>
  );
}

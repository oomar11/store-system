import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  CircleAlert,
  PackageCheck,
  ReceiptText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { DashboardStats } from "./types";

interface StatCard {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "blue" | "violet" | "teal" | "orange";
  href?: string;
}

const toneClasses = {
  blue: "bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]",
  violet: "bg-[color-mix(in_srgb,#8b5cf6_14%,var(--surface))] text-[#a78bfa]",
  teal: "bg-[color-mix(in_srgb,var(--success)_14%,var(--surface))] text-[var(--success)]",
  orange: "bg-[color-mix(in_srgb,var(--warning)_14%,var(--surface))] text-[var(--warning)]",
};

export function DashboardStatCards({
  stats,
  todaySalesHref,
}: {
  stats: DashboardStats;
  todaySalesHref: string;
}) {
  const cards: StatCard[] = [
    {
      label: "مبيعات اليوم",
      value: formatCurrency(stats.totalRevenue),
      detail: `${stats.totalSalesToday.toLocaleString("ar-EG")} فاتورة مكتملة`,
      icon: ReceiptText,
      tone: "blue",
      href: todaySalesHref,
    },
    {
      label: "إجمالي الأصناف",
      value: stats.totalProducts.toLocaleString("ar-EG"),
      detail: "صنف مسجل في المخزون",
      icon: PackageCheck,
      tone: "violet",
      href: "/products",
    },
    {
      label: "قاعدة العملاء",
      value: stats.totalCustomers.toLocaleString("ar-EG"),
      detail: "عميل مسجل بالنظام",
      icon: Users,
      tone: "teal",
      href: "/customers",
    },
    {
      label: "تنبيهات المخزون",
      value: stats.lowStockCount.toLocaleString("ar-EG"),
      detail: stats.lowStockCount ? "تحتاج إلى مراجعتك" : "المخزون بحالة جيدة",
      icon: CircleAlert,
      tone: "orange",
      href: "/products?stock=low",
    },
  ];

  return (
    <section aria-labelledby="dashboard-stats-heading">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="dashboard-eyebrow">لقطة سريعة</p>
          <h2 id="dashboard-stats-heading" className="mt-1 text-base font-black text-[var(--foreground)]">
            أهم أرقام متجرك
          </h2>
        </div>
        <p className="hidden text-[10px] text-[var(--muted)] sm:block">تُحدّث عند فتح الصفحة</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href ?? "#"}
              className="dashboard-card dashboard-stagger group relative overflow-hidden p-5 hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] hover:shadow-[0_18px_45px_rgba(20,32,51,0.09)]"
              style={{ "--stagger": index } as CSSProperties}
            >
              <span className="absolute -left-8 -top-8 h-24 w-24 rounded-full bg-[var(--primary)]/[0.035] transition-transform duration-500 group-hover:scale-150" />
              <div className="relative flex items-start justify-between">
                <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneClasses[card.tone]}`}>
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <ArrowLeft className="h-4 w-4 text-[var(--muted-soft)] transition-transform group-hover:-translate-x-1 group-hover:text-[var(--primary)]" />
              </div>
              <div className="relative mt-5">
                <p className="text-[11px] font-bold text-[var(--muted)]">{card.label}</p>
                <p className="mt-1.5 text-[22px] font-black tracking-tight text-[var(--foreground)]">
                  {card.value}
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted-soft)]">{card.detail}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

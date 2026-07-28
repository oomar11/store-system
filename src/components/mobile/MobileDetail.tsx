"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

export function MobileBackLink({
  href,
  label = "رجوع",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Link href={href} className="mobile-back-link">
      <ArrowRight className="h-4 w-4" />
      {label}
    </Link>
  );
}

export function MobileBackButton({ label = "رجوع" }: { label?: string }) {
  const router = useRouter();
  return (
    <button type="button" className="mobile-back-link" onClick={() => router.back()}>
      <ArrowRight className="h-4 w-4" />
      {label}
    </button>
  );
}

export function MobileDetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5">
      <span className="text-xs font-bold text-[var(--muted)]">{label}</span>
      <span className="text-sm font-extrabold text-end">{value}</span>
    </div>
  );
}

export function MobileLineItem({
  title,
  subtitle,
  amount,
}: {
  title: string;
  subtitle?: string;
  amount: string;
}) {
  return (
    <div className="mobile-list-row">
      <div className="min-w-0 flex-1 text-start">
        <p className="truncate font-semibold">{title}</p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{subtitle}</p>
        ) : null}
      </div>
      <span className="mobile-list-row__amount mobile-list-row__amount--muted">
        {amount}
      </span>
    </div>
  );
}

export function invoiceTypeLabelAr(type: string): string {
  if (type === "sale") return "بيع";
  if (type === "purchase") return "شراء";
  if (type === "sale_return") return "مرتجع بيع";
  if (type === "purchase_return") return "مرتجع شراء";
  return type;
}

export function documentTypeLabelAr(type: string): string {
  if (type === "quote") return "عرض سعر";
  if (type === "purchase_order") return "طلبية شراء";
  return type;
}

export function documentStageLabelAr(stage: string): string {
  const map: Record<string, string> = {
    draft: "مسودة",
    sent: "مُرسل",
    approved: "معتمد",
    rejected: "مرفوض",
    converted: "محوّل",
    cancelled: "ملغي",
  };
  return map[stage] || stage;
}

export function paymentMethodLabelAr(method: string): string {
  if (method === "cash") return "نقدي";
  if (method === "credit") return "آجل";
  if (method === "bank_transfer") return "تحويل";
  return method || "—";
}

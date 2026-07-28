import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  ReceiptText,
  Sparkles,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { DashboardAction, RecentInvoice } from "./types";

export function DashboardActivity({
  invoices,
  actions,
}: {
  invoices: RecentInvoice[];
  actions: DashboardAction[];
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
      <article className="dashboard-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <div>
            <p className="dashboard-eyebrow">مباشر من المتجر</p>
            <h2 className="mt-1 text-sm font-black text-[var(--foreground)]">أحدث المبيعات</h2>
          </div>
          <Link
            href="/sales"
            className="group inline-flex items-center gap-1.5 text-[11px] font-black text-[var(--primary)]"
          >
            عرض الكل
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          </Link>
        </div>

        {invoices.length === 0 ? (
          <div className="flex min-h-[285px] flex-col items-center justify-center px-5 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-subtle)] text-[var(--muted-soft)]">
              <ReceiptText className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-black text-[var(--foreground)]">لا توجد فواتير مكتملة بعد</p>
            <p className="mt-1 max-w-sm text-[11px] leading-5 text-[var(--muted)]">
              ستظهر أحدث عمليات البيع هنا بمجرد إتمام أول فاتورة من نقطة البيع.
            </p>
            <Link
              href="/pos"
              className="mt-4 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-[11px] font-black text-white shadow-[0_8px_20px_rgba(20,115,230,0.2)] hover:-translate-y-0.5 hover:bg-[var(--primary-dark)]"
            >
              إنشاء أول فاتورة
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)] px-5 sm:px-6">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href="/sales"
                  className="group flex items-center gap-3 py-4 hover:translate-x-[-2px]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--success)_14%,var(--surface))] text-[var(--success)]">
                    <Banknote className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-black text-[var(--foreground)]">
                      {invoice.customer?.name || "عميل نقدي"}
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                      {invoice.invoice_number} ·{" "}
                      {new Intl.DateTimeFormat("ar-EG", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(invoice.created_at))}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-black text-[var(--foreground)]">
                    {formatCurrency(invoice.total)}
                  </span>
                  <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-[var(--muted-soft)] group-hover:text-[var(--primary)]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="dashboard-card p-5 sm:p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="dashboard-eyebrow">اختصارات</p>
            <h2 className="mt-1 text-sm font-black text-[var(--foreground)]">إجراءات سريعة</h2>
            <p className="mt-1 text-[10px] text-[var(--muted)]">وصل لما تحتاجه بخطوة واحدة</p>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={`${action.title}-${action.href}`}
                href={action.href}
                className="group flex min-h-[78px] items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] hover:bg-[var(--surface)] hover:shadow-[0_10px_26px_rgba(20,32,51,0.06)]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface)] text-[var(--primary)] shadow-[0_5px_14px_rgba(20,32,51,0.07)]">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-black text-[var(--foreground)]">
                    {action.title}
                  </span>
                  <span className="mt-1 block truncate text-[9px] text-[var(--muted)]">
                    {action.subtitle}
                  </span>
                </span>
                <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-[var(--muted-soft)] transition-transform group-hover:-translate-x-0.5 group-hover:text-[var(--primary)]" />
              </Link>
            );
          })}
        </div>
      </article>
    </section>
  );
}

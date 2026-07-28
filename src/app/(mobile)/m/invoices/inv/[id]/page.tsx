"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import {
  MobileBackLink,
  MobileLineItem,
  invoiceTypeLabelAr,
  paymentMethodLabelAr,
} from "@/components/mobile/MobileDetail";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { MobileEmpty, MobileSkeleton } from "@/components/mobile/MobileUI";
import {
  ShareExportButton,
  type SharePayload,
} from "@/components/mobile/ShareExportButton";

type InvoiceDetail = {
  id: string;
  invoice_number: string;
  type: string;
  discount_amount: number;
  total: number;
  paid_amount: number;
  payment_method: string;
  notes?: string | null;
  created_at: string;
  customer_id?: string | null;
  supplier_id?: string | null;
  customer?: { id?: string; name?: string } | null;
  supplier?: { id?: string; name?: string } | null;
};

type LineItem = {
  id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  product?: { name?: string; sku?: string } | null;
};

export default function MobileInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [{ data: inv, error: invErr }, { data: lines, error: linesErr }] =
        await Promise.all([
          supabase
            .from("invoices")
            .select(
              "id, invoice_number, type, discount_amount, total, paid_amount, payment_method, notes, created_at, customer_id, supplier_id, customer:customers(id, name), supplier:suppliers(id, name)"
            )
            .eq("id", id)
            .maybeSingle(),
          supabase
            .from("invoice_items")
            .select(
              "id, quantity, unit_price, discount, total, product:products(name, sku)"
            )
            .eq("invoice_id", id),
        ]);

      if (invErr) throw new Error(invErr.message);
      if (!inv) throw new Error("الفاتورة غير موجودة");
      if (linesErr) throw new Error(linesErr.message);

      setInvoice(inv as unknown as InvoiceDetail);
      setItems((lines || []) as unknown as LineItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الفاتورة");
      setInvoice(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const remaining = invoice
    ? Math.max(0, Number(invoice.total) - Number(invoice.paid_amount))
    : 0;

  const partyHref = invoice?.customer_id
    ? `/m/parties/customer/${invoice.customer_id}`
    : invoice?.supplier_id
      ? `/m/parties/supplier/${invoice.supplier_id}`
      : null;
  const partyName =
    invoice?.customer?.name || invoice?.supplier?.name || null;
  const partyLabel = invoice?.customer_id ? "حساب العميل" : "حساب المورد";

  const subtitle = invoice
    ? [partyName, formatDateShort(invoice.created_at)].filter(Boolean).join(" · ")
    : "جاري التحميل";

  const invoiceKindLabel = (type: string) => {
    if (type === "sale") return "فاتورة بيع";
    if (type === "purchase") return "فاتورة شراء";
    if (type === "sale_return") return "مرتجع بيع";
    if (type === "purchase_return") return "مرتجع شراء";
    return invoiceTypeLabelAr(type);
  };

  const sharePayload: SharePayload | null = invoice
    ? {
        title: `${invoiceKindLabel(invoice.type)} · ${invoice.invoice_number}`,
        subtitle: subtitle,
        total: formatCurrency(Number(invoice.total)),
        metaLines: [
          `مدفوع ${formatCurrency(Number(invoice.paid_amount))} · متبقي ${formatCurrency(remaining)}`,
          ...(Number(invoice.discount_amount) > 0
            ? [`خصم ${formatCurrency(Number(invoice.discount_amount))}`]
            : []),
          ...(invoice.payment_method && invoice.payment_method !== "cash"
            ? [paymentMethodLabelAr(invoice.payment_method)]
            : []),
        ],
        lines: items.map((line) => ({
          title: line.product?.name || "صنف",
          subtitle: `${Number(line.quantity)} × ${formatCurrency(Number(line.unit_price))}`,
          amount: formatCurrency(Number(line.total)),
        })),
        notes: invoice.notes,
        fileBaseName: invoice.invoice_number,
      }
    : null;

  return (
    <>
      <MobileHeader
        title={invoice?.invoice_number || "الفاتورة"}
        subtitle={subtitle}
        onRefresh={load}
        refreshing={loading}
        trailing={<ShareExportButton payload={sharePayload} disabled={loading} />}
      />
      <div className="mobile-page">
        <MobileBackLink href="/m/invoices" label="رجوع" />

        {error ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
        ) : null}

        {loading || !invoice ? (
          <MobileSkeleton rows={5} />
        ) : (
          <>
            <div className="mobile-money-hero">
              <p className="mobile-money-hero__label">الإجمالي</p>
              <p className="mobile-money-hero__amount">
                {formatCurrency(Number(invoice.total))}
              </p>
              <p className="mobile-money-hero__meta">
                مدفوع {formatCurrency(Number(invoice.paid_amount))}
                {" · "}
                متبقي {formatCurrency(remaining)}
              </p>
              {Number(invoice.discount_amount) > 0 ? (
                <p className="mobile-money-hero__note">
                  خصم {formatCurrency(Number(invoice.discount_amount))}
                </p>
              ) : null}
              {invoice.payment_method &&
              invoice.payment_method !== "cash" ? (
                <p className="mobile-money-hero__note">
                  {paymentMethodLabelAr(invoice.payment_method)}
                </p>
              ) : null}
            </div>

            {partyHref ? (
              <Link href={partyHref} className="mobile-text-link">
                {partyLabel}
                {partyName ? ` — ${partyName}` : ""}
              </Link>
            ) : null}

            <div className="mobile-panel mt-3">
              {items.length === 0 ? (
                <MobileEmpty message="لا توجد بنود" />
              ) : (
                items.map((line) => (
                  <MobileLineItem
                    key={line.id}
                    title={line.product?.name || "صنف"}
                    subtitle={`${Number(line.quantity)} × ${formatCurrency(Number(line.unit_price))}${
                      Number(line.discount) > 0
                        ? ` · خصم ${formatCurrency(Number(line.discount))}`
                        : ""
                    }`}
                    amount={formatCurrency(Number(line.total))}
                  />
                ))
              )}
            </div>

            {invoice.notes ? (
              <p className="mt-3 text-sm font-semibold leading-6 text-[var(--muted)]">
                {invoice.notes}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

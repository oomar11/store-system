"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import {
  MobileBackLink,
  MobileLineItem,
  documentStageLabelAr,
  documentTypeLabelAr,
} from "@/components/mobile/MobileDetail";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { MobileEmpty, MobileSkeleton } from "@/components/mobile/MobileUI";
import {
  ShareExportButton,
  type SharePayload,
} from "@/components/mobile/ShareExportButton";

type DocDetail = {
  id: string;
  document_number: string;
  type: string;
  stage: string;
  discount_amount: number;
  total: number;
  notes?: string | null;
  created_at: string;
  customer_id?: string | null;
  supplier_id?: string | null;
  customer?: { id?: string; name?: string } | null;
  supplier?: { id?: string; name?: string } | null;
  converted_invoice_id?: string | null;
};

type LineItem = {
  id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  product?: { name?: string; sku?: string } | null;
};

export default function MobileDocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [{ data: row, error: docErr }, { data: lines, error: linesErr }] =
        await Promise.all([
          supabase
            .from("documents")
            .select(
              "id, document_number, type, stage, discount_amount, total, notes, created_at, customer_id, supplier_id, converted_invoice_id, customer:customers(id, name), supplier:suppliers(id, name)"
            )
            .eq("id", id)
            .maybeSingle(),
          supabase
            .from("document_items")
            .select(
              "id, quantity, unit_price, discount, total, product:products(name, sku)"
            )
            .eq("document_id", id),
        ]);

      if (docErr) throw new Error(docErr.message);
      if (!row) throw new Error("المستند غير موجود");
      if (linesErr) throw new Error(linesErr.message);

      setDoc(row as unknown as DocDetail);
      setItems((lines || []) as unknown as LineItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل المستند");
      setDoc(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const partyHref = doc?.customer_id
    ? `/m/parties/customer/${doc.customer_id}`
    : doc?.supplier_id
      ? `/m/parties/supplier/${doc.supplier_id}`
      : null;
  const partyName = doc?.customer?.name || doc?.supplier?.name || null;
  const partyLabel = doc?.customer_id ? "حساب العميل" : "حساب المورد";

  const subtitle = doc
    ? [partyName, formatDateShort(doc.created_at)].filter(Boolean).join(" · ")
    : "جاري التحميل";

  const sharePayload: SharePayload | null = doc
    ? {
        title: `${documentTypeLabelAr(doc.type)} · ${doc.document_number}`,
        subtitle,
        total: formatCurrency(Number(doc.total)),
        metaLines: [
          documentStageLabelAr(doc.stage),
          ...(Number(doc.discount_amount) > 0
            ? [`خصم ${formatCurrency(Number(doc.discount_amount))}`]
            : []),
        ],
        lines: items.map((line) => ({
          title: line.product?.name || "صنف",
          subtitle: `${Number(line.quantity)} × ${formatCurrency(Number(line.unit_price))}`,
          amount: formatCurrency(Number(line.total)),
        })),
        notes: doc.notes,
        fileBaseName: doc.document_number,
      }
    : null;

  return (
    <>
      <MobileHeader
        title={doc?.document_number || "المستند"}
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

        {loading || !doc ? (
          <MobileSkeleton rows={5} />
        ) : (
          <>
            <div className="mobile-money-hero">
              <p className="mobile-money-hero__label">الإجمالي</p>
              <p className="mobile-money-hero__amount">
                {formatCurrency(Number(doc.total))}
              </p>
              <p className="mobile-money-hero__meta">
                {documentStageLabelAr(doc.stage)}
              </p>
              {Number(doc.discount_amount) > 0 ? (
                <p className="mobile-money-hero__note">
                  خصم {formatCurrency(Number(doc.discount_amount))}
                </p>
              ) : null}
            </div>

            {partyHref ? (
              <Link href={partyHref} className="mobile-text-link">
                {partyLabel}
                {partyName ? ` — ${partyName}` : ""}
              </Link>
            ) : null}

            {doc.converted_invoice_id ? (
              <Link
                href={`/m/invoices/inv/${doc.converted_invoice_id}`}
                className="mobile-text-link"
              >
                الفاتورة المحوّلة
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

            {doc.notes ? (
              <p className="mt-3 text-sm font-semibold leading-6 text-[var(--muted)]">
                {doc.notes}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

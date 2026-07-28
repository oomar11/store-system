"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  assembleProductMovements,
  fetchProductMovements,
  invoiceTypeLabel,
  movementSign,
  type MovementRow,
} from "@/lib/history";
import { formatDateRelative } from "@/lib/utils";
import { MobileBackLink } from "@/components/mobile/MobileDetail";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileEmpty,
  MobileListRow,
  MobileSkeleton,
} from "@/components/mobile/MobileUI";

type ProductInfo = {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  buy_price: number;
  opening_quantity?: number;
  created_at: string;
};

export default function MobileProductMovementPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [rows, setRows] = useState<MovementRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: prodErr } = await supabase
        .from("products")
        .select("id, name, sku, quantity, buy_price, opening_quantity, created_at")
        .eq("id", id)
        .maybeSingle();
      if (prodErr) throw new Error(prodErr.message);
      if (!data) throw new Error("الصنف غير موجود");

      const productInfo = data as ProductInfo;
      setProduct(productInfo);

      const movements = await fetchProductMovements(id);
      setRows(assembleProductMovements(productInfo, movements).reverse());
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الحركة");
      setProduct(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <MobileHeader
        title={product?.name || "حركة الصنف"}
        subtitle={
          product
            ? `${product.sku || "—"} · رصيد ${Number(product.quantity)}`
            : "جاري التحميل"
        }
        onRefresh={load}
        refreshing={loading}
      />
      <div className="mobile-page">
        <MobileBackLink href="/m/more/stock" label="المخزن" />

        {error ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
        ) : null}

        {loading || !product ? (
          <MobileSkeleton rows={8} />
        ) : (
          <>
            <div className="mobile-money-hero mb-3">
              <p className="mobile-money-hero__label">الرصيد الحالي</p>
              <p className="mobile-money-hero__amount">
                {Number(product.quantity)}
              </p>
            </div>

            <div className="mobile-panel">
              {rows.length === 0 ? (
                <MobileEmpty message="لا توجد حركات لهذا الصنف" />
              ) : (
                rows.map((row) => {
                  const type = row.invoice?.type || "opening";
                  const sign = movementSign(type);
                  const qty = Number(row.quantity);
                  const signed =
                    sign >= 0 ? `+${qty}` : `-${Math.abs(qty)}`;
                  return (
                    <MobileListRow
                      key={row.id}
                      title={
                        row.invoice?.invoice_number ||
                        (row.isOpening ? "افتتاحي" : "حركة")
                      }
                      subtitle={`${invoiceTypeLabel(type)} · ${
                        row.invoice?.created_at
                          ? formatDateRelative(row.invoice.created_at)
                          : "—"
                      }${
                        row.running_balance != null
                          ? ` · رصيد ${row.running_balance}`
                          : ""
                      }`}
                      amount={signed}
                      amountTone={sign >= 0 ? "positive" : "negative"}
                    />
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

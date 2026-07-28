"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { isLowStock } from "@/lib/low-stock";
import { formatCurrency, smartSearchMatch } from "@/lib/utils";
import {
  getSnapshot,
  readLocalThenNetwork,
  withTimeout,
} from "@/lib/offline";
import { useOffline } from "@/components/offline/OfflineProvider";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileChip,
  MobileEmpty,
  MobileListRow,
  MobileSkeleton,
} from "@/components/mobile/MobileUI";

type StockFilter = "all" | "low" | "out";

type StockProduct = {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  min_quantity: number;
  sell_price: number;
  buy_price: number;
  category?: { name?: string } | null;
};

export default function MobileStockPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { online } = useOffline();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const offline = !online || !navigator.onLine;

    await readLocalThenNetwork<StockProduct[]>({
      offline,
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.products?.length) return null;
        return (snap.products || [])
          .filter((p) => p.is_active !== false)
          .map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku || "",
            quantity: Number(p.quantity),
            min_quantity: Number(p.min_quantity ?? 0),
            sell_price: Number(p.sell_price),
            buy_price: Number(p.buy_price),
            category: null,
          }));
      },
      network: async () => {
        const { data, error } = await withTimeout(
          (async () =>
            supabase
              .from("products")
              .select(
                "id, name, sku, quantity, min_quantity, sell_price, buy_price, category:categories(name)"
              )
              .eq("is_active", true)
              .order("name")
              .limit(500))(),
          5000
        );
        if (error) throw error;
        return (data || []) as unknown as StockProduct[];
      },
      apply: (data) => setProducts(data),
    });

    setLoading(false);
  }, [online, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const list = useMemo(() => {
    return products.filter((p) => {
      if (q && !smartSearchMatch(q, [p.name, p.sku, p.category?.name])) {
        return false;
      }
      const qty = Number(p.quantity);
      if (filter === "out") return qty <= 0;
      if (filter === "low") return isLowStock(qty, Number(p.min_quantity));
      return true;
    });
  }, [filter, products, q]);

  return (
    <>
      <MobileHeader
        title="المخزن"
        subtitle="اضغط للصنف لعرض الحركة"
        onRefresh={load}
      />
      <div className="mobile-page">
        <div className="mobile-field">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم أو الكود..."
          />
        </div>
        <div className="mobile-chip-row">
          {(
            [
              ["all", "الكل"],
              ["low", "نواقص"],
              ["out", "نفد"],
            ] as const
          ).map(([id, label]) => (
            <MobileChip
              key={id}
              active={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </MobileChip>
          ))}
        </div>

        {loading ? (
          <MobileSkeleton rows={10} />
        ) : (
          <div className="mobile-panel">
            {list.length === 0 ? (
              <MobileEmpty message="لا توجد أصناف مطابقة" />
            ) : (
              list.map((p) => {
                const qty = Number(p.quantity);
                const low = isLowStock(qty, Number(p.min_quantity));
                return (
                  <MobileListRow
                    key={p.id}
                    title={p.name}
                    subtitle={`${p.sku || "—"} · رصيد ${qty}${low ? " · ناقص" : ""}`}
                    amount={formatCurrency(Number(p.sell_price))}
                    amountTone={qty <= 0 ? "negative" : "muted"}
                    onClick={() => router.push(`/m/more/stock/${p.id}`)}
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    </>
  );
}

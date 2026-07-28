import type { SupabaseClient } from "@supabase/supabase-js";

export type StockLine = {
  product_id: string;
  quantity: number;
};

export const LOW_STOCK_REFRESH_EVENT = "windor:low-stock-refresh";

export function notifyLowStockChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOW_STOCK_REFRESH_EVENT));
}

function toRpcLines(lines: StockLine[]) {
  return lines
    .filter((line) => line.product_id && Number(line.quantity) > 0)
    .map((line) => ({
      product_id: line.product_id,
      quantity: Number(line.quantity),
    }));
}

/** Adjust product stock atomically. direction +1 adds qty, -1 subtracts qty. */
export async function adjustProductStock(
  supabase: SupabaseClient,
  lines: StockLine[],
  direction: 1 | -1,
  options?: { silent?: boolean; allowNegative?: boolean }
) {
  const payload = toRpcLines(lines);
  if (payload.length === 0) return;

  const { error } = await supabase.rpc("adjust_product_stock", {
    p_lines: payload,
    p_direction: direction,
    p_allow_negative: options?.allowNegative ?? false,
  });

  if (error) {
    throw new Error(error.message || "تعذر تحديث المخزون");
  }

  if (!options?.silent) notifyLowStockChanged();
}

/** Set absolute stock quantities (used by inventory count reconciliation). */
export async function setProductStock(
  supabase: SupabaseClient,
  lines: StockLine[]
) {
  const payload = lines
    .filter((line) => line.product_id)
    .map((line) => ({
      product_id: line.product_id,
      quantity: Number(line.quantity) || 0,
    }));

  if (payload.length === 0) return;

  const { error } = await supabase.rpc("set_product_stock", {
    p_lines: payload,
  });

  if (error) {
    throw new Error(error.message || "تعذر تثبيت كميات الجرد");
  }

  notifyLowStockChanged();
}

export type BuyPriceLine = {
  product_id: string;
  unit_cost: number;
};

/**
 * Update catalog buy_price to the latest net purchase unit cost.
 * Best-effort per product; failures are ignored so the purchase itself stands.
 */
export async function updateProductsBuyPrice(
  supabase: SupabaseClient,
  lines: BuyPriceLine[]
): Promise<void> {
  const byProduct = new Map<string, number>();
  for (const line of lines) {
    if (!line.product_id) continue;
    const cost = Number(line.unit_cost);
    if (!Number.isFinite(cost) || cost < 0) continue;
    byProduct.set(line.product_id, cost);
  }
  if (byProduct.size === 0) return;

  await Promise.all(
    Array.from(byProduct.entries()).map(async ([productId, cost]) => {
      try {
        await supabase
          .from("products")
          .update({ buy_price: cost })
          .eq("id", productId);
      } catch {
        /* best-effort: offline or transient failure must not fail the purchase */
      }
    })
  );

  notifyLowStockChanged();
}

/** Replace stock impact: reverse old lines, apply new lines with given direction for "apply". */
export async function replaceStockImpact(
  supabase: SupabaseClient,
  oldLines: StockLine[],
  newLines: StockLine[],
  applyDirection: 1 | -1
) {
  await adjustProductStock(
    supabase,
    oldLines,
    (applyDirection === 1 ? -1 : 1) as 1 | -1,
    { silent: true, allowNegative: true }
  );
  await adjustProductStock(supabase, newLines, applyDirection, {
    silent: true,
    allowNegative: applyDirection === 1,
  });
  if (oldLines.length > 0 || newLines.length > 0) notifyLowStockChanged();
}

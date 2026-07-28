import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceTier, Product } from "@/types";

export type TierPriceKey = string; // `${productId}:${tierId}`
export type TierPriceMap = Map<TierPriceKey, number>;

/** `${tierId}:${categoryId}` → discount % */
export type TierCategoryDiscountMap = Map<string, number>;
/** `${tierId}:${productId}` → discount % */
export type TierProductDiscountMap = Map<string, number>;

export type TierPricingContext = {
  tierPrices?: TierPriceMap | null;
  categoryDiscounts?: TierCategoryDiscountMap | null;
  productDiscounts?: TierProductDiscountMap | null;
  /** Default / retail tier ids — fixed prices on these are just retail mirrors */
  defaultTierIds?: Set<string> | null;
};

export function tierPriceKey(productId: string, tierId: string): TierPriceKey {
  return `${productId}:${tierId}`;
}

export function tierCategoryDiscountKey(
  tierId: string,
  categoryId: string
): string {
  return `${tierId}:${categoryId}`;
}

export function tierProductDiscountKey(
  tierId: string,
  productId: string
): string {
  return `${tierId}:${productId}`;
}

export function buildTierPriceMap(
  rows: { product_id: string; tier_id: string; sell_price: number }[]
): Map<TierPriceKey, number> {
  const map = new Map<TierPriceKey, number>();
  for (const row of rows) {
    map.set(tierPriceKey(row.product_id, row.tier_id), Number(row.sell_price) || 0);
  }
  return map;
}

export function buildTierCategoryDiscountMap(
  rows: { tier_id: string; category_id: string; discount_percent: number }[]
): TierCategoryDiscountMap {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(
      tierCategoryDiscountKey(row.tier_id, row.category_id),
      Number(row.discount_percent) || 0
    );
  }
  return map;
}

export function buildTierProductDiscountMap(
  rows: { tier_id: string; product_id: string; discount_percent: number }[]
): TierProductDiscountMap {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(
      tierProductDiscountKey(row.tier_id, row.product_id),
      Number(row.discount_percent) || 0
    );
  }
  return map;
}

function applyPercentOffRetail(retail: number, percent: number): number {
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const price = retail * (1 - pct / 100);
  return Math.round(price * 100) / 100;
}

/**
 * Resolve sell price for a product given an optional customer tier.
 * Priority: fixed tier price (non-default) → product % → category % → retail.
 */
export function resolveSellPrice(
  product: Pick<Product, "id" | "sell_price" | "category_id">,
  tierId: string | null | undefined,
  tierPricesOrContext?: TierPriceMap | TierPricingContext | null
): number {
  const retail = Number(product.sell_price) || 0;
  if (!tierId) return retail;

  const ctx: TierPricingContext =
    tierPricesOrContext instanceof Map
      ? { tierPrices: tierPricesOrContext }
      : tierPricesOrContext || {};

  const isDefault = ctx.defaultTierIds?.has(tierId) === true;
  if (!isDefault && ctx.tierPrices) {
    const fixed = ctx.tierPrices.get(tierPriceKey(product.id, tierId));
    if (fixed != null && Number.isFinite(fixed)) return fixed;
  }

  if (ctx.productDiscounts) {
    const prodPct = ctx.productDiscounts.get(
      tierProductDiscountKey(tierId, product.id)
    );
    if (prodPct != null && Number.isFinite(prodPct)) {
      return applyPercentOffRetail(retail, prodPct);
    }
  }

  if (ctx.categoryDiscounts && product.category_id) {
    const catPct = ctx.categoryDiscounts.get(
      tierCategoryDiscountKey(tierId, product.category_id)
    );
    if (catPct != null && Number.isFinite(catPct)) {
      return applyPercentOffRetail(retail, catPct);
    }
  }

  return retail;
}

export async function listPriceTiers(
  supabase: SupabaseClient
): Promise<PriceTier[]> {
  const { data, error } = await supabase
    .from("price_tiers")
    .select("id, name, is_default, sort_order, created_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as PriceTier[];
}

export async function loadTierPriceMap(
  supabase: SupabaseClient,
  productIds?: string[]
): Promise<Map<TierPriceKey, number>> {
  let q = supabase
    .from("product_tier_prices")
    .select("product_id, tier_id, sell_price");
  if (productIds && productIds.length > 0) {
    q = q.in("product_id", productIds);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return buildTierPriceMap(
    (data || []).map((r) => ({
      product_id: r.product_id as string,
      tier_id: r.tier_id as string,
      sell_price: Number(r.sell_price) || 0,
    }))
  );
}

export async function loadTierCategoryDiscountMap(
  supabase: SupabaseClient
): Promise<TierCategoryDiscountMap> {
  const { data, error } = await supabase
    .from("tier_category_discounts")
    .select("tier_id, category_id, discount_percent");
  if (error) throw new Error(error.message);
  return buildTierCategoryDiscountMap(
    (data || []).map((r) => ({
      tier_id: r.tier_id as string,
      category_id: r.category_id as string,
      discount_percent: Number(r.discount_percent) || 0,
    }))
  );
}

export async function loadTierProductDiscountMap(
  supabase: SupabaseClient
): Promise<TierProductDiscountMap> {
  const { data, error } = await supabase
    .from("tier_product_discounts")
    .select("tier_id, product_id, discount_percent");
  if (error) throw new Error(error.message);
  return buildTierProductDiscountMap(
    (data || []).map((r) => ({
      tier_id: r.tier_id as string,
      product_id: r.product_id as string,
      discount_percent: Number(r.discount_percent) || 0,
    }))
  );
}

export async function loadTierPricingContext(
  supabase: SupabaseClient,
  productIds?: string[]
): Promise<TierPricingContext> {
  const [tiers, tierPrices, categoryDiscounts, productDiscounts] =
    await Promise.all([
      listPriceTiers(supabase),
      loadTierPriceMap(supabase, productIds),
      loadTierCategoryDiscountMap(supabase),
      loadTierProductDiscountMap(supabase),
    ]);
  return {
    tierPrices,
    categoryDiscounts,
    productDiscounts,
    defaultTierIds: new Set(tiers.filter((t) => t.is_default).map((t) => t.id)),
  };
}

export async function upsertProductTierPrices(
  supabase: SupabaseClient,
  productId: string,
  prices: { tierId: string; sellPrice: number }[]
): Promise<void> {
  if (prices.length === 0) return;
  const rows = prices.map((p) => ({
    product_id: productId,
    tier_id: p.tierId,
    sell_price: Math.max(0, Number(p.sellPrice) || 0),
  }));
  const { error } = await supabase
    .from("product_tier_prices")
    .upsert(rows, { onConflict: "product_id,tier_id" });
  if (error) throw new Error(error.message);
}

/** Delete fixed-price overrides for the given tiers (empty field in product form). */
export async function deleteProductTierPrices(
  supabase: SupabaseClient,
  productId: string,
  tierIds: string[]
): Promise<void> {
  if (tierIds.length === 0) return;
  const { error } = await supabase
    .from("product_tier_prices")
    .delete()
    .eq("product_id", productId)
    .in("tier_id", tierIds);
  if (error) throw new Error(error.message);
}

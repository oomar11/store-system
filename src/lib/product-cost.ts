/**
 * Estimated purchase/cost price when there is no fixed buy price.
 * Always derived from products.sell_price (catalog), never from invoice unit prices.
 * - قطاعات سيتي (and other قطاعات except كورين): sell − 20%
 * - كورين + everything else: sell − 10%
 */
export const DEFAULT_BUY_DISCOUNT_FROM_SELL_PERCENT = 10;
/** قطاعات سيتي profiles: deeper trade discount off catalog sell */
export const SECTORS_BUY_DISCOUNT_FROM_SELL_PERCENT = 20;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Category name → buy discount % from catalog sell (كورين/default 10%, قطاعات 20%). */
export function buyDiscountPercentForCategory(
  categoryName: string | null | undefined
): number {
  const name = (categoryName || "").trim();
  // كورين stays at the default 10% trade discount
  if (/كورين/.test(name)) return DEFAULT_BUY_DISCOUNT_FROM_SELL_PERCENT;
  if (/قطاع/.test(name)) return SECTORS_BUY_DISCOUNT_FROM_SELL_PERCENT;
  return DEFAULT_BUY_DISCOUNT_FROM_SELL_PERCENT;
}

/** Cost = catalog sell × (1 − discount%). Returns 0 when sell ≤ 0. */
export function estimatedBuyPriceFromSell(
  sellPrice: number,
  discountPercent: number = DEFAULT_BUY_DISCOUNT_FROM_SELL_PERCENT
): number {
  const sell = Number(sellPrice) || 0;
  if (sell <= 0) return 0;
  const pct = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return round2(sell * (1 - pct / 100));
}

/**
 * Catalog unit cost from the product row: products.sell_price ± category rule.
 * Do not pass invoice line prices here.
 */
export function catalogUnitCostFromProduct(product: {
  sell_price?: number | null;
  category?: { name?: string | null } | null;
  category_name?: string | null;
}): number {
  const sell = Number(product.sell_price) || 0;
  const categoryName = product.category?.name ?? product.category_name ?? null;
  return estimatedBuyPriceFromSell(
    sell,
    buyDiscountPercentForCategory(categoryName)
  );
}

/**
 * Prefer an explicit buy price; if missing/zero and sell is set, use the
 * catalog discount-from-sell estimate.
 */
export function resolveBuyPrice(
  buyPrice: number | null | undefined,
  sellPrice: number | null | undefined,
  discountPercent: number = DEFAULT_BUY_DISCOUNT_FROM_SELL_PERCENT
): number {
  const buy = Number(buyPrice);
  if (Number.isFinite(buy) && buy > 0) return round2(buy);
  return estimatedBuyPriceFromSell(Number(sellPrice) || 0, discountPercent);
}

/** True when buy looks like the auto estimate for the given sell price. */
export function isEstimatedBuyFromSell(
  buyPrice: number,
  sellPrice: number,
  discountPercent: number = DEFAULT_BUY_DISCOUNT_FROM_SELL_PERCENT
): boolean {
  const sell = Number(sellPrice) || 0;
  const buy = Number(buyPrice) || 0;
  if (sell <= 0) return buy <= 0;
  return Math.abs(buy - estimatedBuyPriceFromSell(sell, discountPercent)) < 0.005;
}

/**
 * True when buy matches any known catalog estimate (10% default or 20% sectors)
 * for this sell price — used so changing category/sell can re-sync cost.
 */
export function isAnyCatalogBuyEstimate(
  buyPrice: number,
  sellPrice: number
): boolean {
  return (
    isEstimatedBuyFromSell(
      buyPrice,
      sellPrice,
      DEFAULT_BUY_DISCOUNT_FROM_SELL_PERCENT
    ) ||
    isEstimatedBuyFromSell(
      buyPrice,
      sellPrice,
      SECTORS_BUY_DISCOUNT_FROM_SELL_PERCENT
    )
  );
}

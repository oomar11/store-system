import type { Product } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSaleLineUnitCost } from "@/lib/product-cost";

/** Resolve unit cost for a line: prefer saved snapshot, else current buy price. */
export function resolveUnitCost(
  unitCost: number | null | undefined,
  fallbackBuyPrice: number | null | undefined
): { cost: number; isEstimated: boolean } {
  if (unitCost != null && !Number.isNaN(Number(unitCost))) {
    return { cost: Number(unitCost), isEstimated: false };
  }
  return { cost: Number(fallbackBuyPrice) || 0, isEstimated: true };
}

export function lineCostTotal(
  quantity: number,
  unitCost: number | null | undefined,
  fallbackBuyPrice: number | null | undefined
): { cost: number; isEstimated: boolean } {
  const resolved = resolveUnitCost(unitCost, fallbackBuyPrice);
  return {
    cost: quantity * resolved.cost,
    isEstimated: resolved.isEstimated,
  };
}

type CostCartItem = {
  product: Pick<Product, "id" | "buy_price" | "sell_price"> & {
    category?: { name?: string | null } | null;
  };
  quantity: number;
  unit_price: number;
  discount?: number;
  total: number;
  /** Preserved snapshot when editing an existing line */
  unit_cost?: number | null;
  /** Retail unit price before tier markdown (sale lines) */
  list_unit_price?: number | null;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Distribute an invoice-level discount across cart lines, proportional to each
 * line total. The discount is added to each line's `discount` and the line
 * `total` is recomputed as `qty * unit_price - discount`. Rounding remainder is
 * placed on the largest line so the sum matches the invoice discount exactly.
 */
export function allocateInvoiceDiscount<T extends CostCartItem>(
  cart: T[],
  invoiceDiscountAmount: number
): T[] {
  const discount = Math.max(0, Number(invoiceDiscountAmount) || 0);
  if (discount <= 0 || cart.length === 0) return cart;

  const subtotal = cart.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  if (subtotal <= 0) return cart;

  let allocated = 0;
  const shares = cart.map((item) => {
    const share = round2(((Number(item.total) || 0) / subtotal) * discount);
    allocated += share;
    return share;
  });

  const remainder = round2(discount - allocated);
  if (remainder !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < cart.length; i += 1) {
      if ((Number(cart[i].total) || 0) > (Number(cart[maxIdx].total) || 0)) {
        maxIdx = i;
      }
    }
    shares[maxIdx] = round2(shares[maxIdx] + remainder);
  }

  return cart.map((item, i) => {
    const gross = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
    const newDiscount = round2((Number(item.discount) || 0) + shares[i]);
    const newTotal = Math.max(0, round2(gross - newDiscount));
    return { ...item, discount: newDiscount, total: newTotal };
  });
}

export type InvoiceItemInsert = {
  invoice_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  discount: number;
  total: number;
  list_unit_price?: number | null;
};

/**
 * Map cart lines to invoice_items rows with unit_cost.
 * - Purchase lines use the NET unit cost (line total / qty), so any line or
 *   distributed invoice discount is reflected in the stored cost.
 * - Existing sale lines keep their unit_cost snapshot when set.
 * - New sale lines use products.buy_price (last purchase / manual). Catalog
 *   sell−10%/20% is only a fallback when buy_price is missing.
 */
export function mapCartToInvoiceItems(
  invoiceId: string,
  cart: CostCartItem[],
  options?: {
    kind?: "sale" | "purchase" | "sale_return" | "purchase_return";
    /** Invoice-level discount distributed across purchase lines for net cost. */
    invoiceDiscountAmount?: number;
  }
): InvoiceItemInsert[] {
  const kind = options?.kind ?? "sale";
  const isPurchase = kind === "purchase" || kind === "purchase_return";
  const invoiceDiscount = Math.max(0, Number(options?.invoiceDiscountAmount) || 0);

  // Net line totals (after distributing the invoice discount) drive purchase
  // unit_cost only; the stored line total/discount stay gross so invoice display
  // and header subtotal/discount_amount remain consistent.
  const netLines =
    isPurchase && invoiceDiscount > 0
      ? allocateInvoiceDiscount(cart, invoiceDiscount)
      : cart;

  return cart.map((item, i) => {
    let unitCost: number;
    if (isPurchase) {
      const qty = Number(item.quantity) || 0;
      const net = Number(netLines[i]?.total) || 0;
      unitCost = qty > 0 ? round2(net / qty) : Number(item.unit_price) || 0;
    } else {
      unitCost = resolveSaleLineUnitCost(item.unit_cost, item.product);
    }

    return {
      invoice_id: invoiceId,
      product_id: item.product.id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit_cost: unitCost,
      discount: item.discount ?? 0,
      total: item.total,
      list_unit_price:
        item.list_unit_price != null &&
        Number(item.list_unit_price) > Number(item.unit_price) + 0.001
          ? Number(item.list_unit_price)
          : null,
    };
  });
}

/** Net purchase unit cost per product after distributing an invoice discount. */
export function purchaseNetUnitCosts(
  cart: CostCartItem[],
  invoiceDiscountAmount: number
): Array<{ product_id: string; unit_cost: number }> {
  const rows = mapCartToInvoiceItems("pending", cart, {
    kind: "purchase",
    invoiceDiscountAmount,
  });
  return rows.map((r) => ({ product_id: r.product_id, unit_cost: r.unit_cost }));
}

/** Insert invoice lines; falls back without unit_cost if column not migrated yet. */
export async function insertInvoiceItems(
  supabase: SupabaseClient,
  rows: InvoiceItemInsert[]
): Promise<{ error: { message: string } | null }> {
  if (rows.length === 0) return { error: null };

  const { error } = await supabase.from("invoice_items").insert(rows);
  if (!error) return { error: null };

  const msg = error.message || "";
  if (/list_unit_price/i.test(msg)) {
    const withoutList = rows.map(({ list_unit_price: _l, ...rest }) => rest);
    const retryList = await supabase.from("invoice_items").insert(withoutList);
    if (!retryList.error) return { error: null };
  }
  if (/unit_cost/i.test(msg) || /schema cache/i.test(msg) || /could not find/i.test(msg)) {
    const withoutCost = rows.map(
      ({ unit_cost: _c, list_unit_price: _l, ...rest }) => rest
    );
    const retry = await supabase.from("invoice_items").insert(withoutCost);
    return { error: retry.error ? { message: retry.error.message } : null };
  }

  return { error: { message: msg } };
}

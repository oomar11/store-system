import type { SupabaseClient } from "@supabase/supabase-js";

export interface LowStockProduct {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  min_quantity: number;
  unit: string;
}

/** أصناف نشطة تحت الحد الأدنى ولم يُكتم تنبيهها */
export async function fetchLowStockAlerts(
  supabase: SupabaseClient
): Promise<LowStockProduct[]> {
  // Prefer filtering notify_low_stock in SQL; fall back if column missing
  let query = supabase
    .from("products")
    .select("id, name, sku, quantity, min_quantity, unit, notify_low_stock")
    .eq("is_active", true)
    .order("quantity", { ascending: true });

  const { data, error } = await query;

  if (error) {
    const fallback = await supabase
      .from("products")
      .select("id, name, sku, quantity, min_quantity, unit")
      .eq("is_active", true)
      .order("quantity", { ascending: true });
    if (fallback.error || !fallback.data) return [];
    return fallback.data.filter(
      (p) => Number(p.quantity) <= Number(p.min_quantity)
    ) as LowStockProduct[];
  }

  if (!data) return [];

  return data.filter((p) =>
    isLowStockAlert(
      Number(p.quantity),
      Number(p.min_quantity),
      (p as { notify_low_stock?: boolean | null }).notify_low_stock
    )
  ) as LowStockProduct[];
}

export async function setProductLowStockNotify(
  supabase: SupabaseClient,
  productId: string,
  notify: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("products")
    .update({ notify_low_stock: notify })
    .eq("id", productId);

  return { error: error?.message ?? null };
}

export function isLowStock(quantity: number, minQuantity: number): boolean {
  return Number(quantity) <= Number(minQuantity);
}

/** مخزون منخفض ويُحسب في التنبيهات/لوحة التحكم (لم يُكتم تنبيهه) */
export function isLowStockAlert(
  quantity: number,
  minQuantity: number,
  notifyLowStock?: boolean | null
): boolean {
  return notifyLowStock !== false && isLowStock(quantity, minQuantity);
}

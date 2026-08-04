import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Product } from "@/types";
import { PRODUCT_COLUMNS, getEntityLabel } from "./schemas";
import { downloadTemplate, exportRows } from "./download";
import { cellToString, parseBoolean, parseNumber } from "./parse";
import { buyDiscountPercentForCategory, estimatedBuyPriceFromSell } from "@/lib/product-cost";

export type RowAction = "create" | "update" | "skip" | "error";

export type ProductPreviewRow = {
  rowIndex: number;
  action: RowAction;
  sku: string;
  name: string;
  categoryName: string;
  errors: string[];
  warnings: string[];
  payload: ProductImportPayload | null;
  existingId?: string;
};

export type ProductImportPayload = {
  sku: string;
  name: string;
  category_name: string;
  unit: string;
  buy_price: number;
  sell_price: number;
  quantity: number;
  opening_quantity: number;
  min_quantity: number;
  notify_low_stock: boolean;
  description?: string | null;
  is_active: boolean;
};

export type ProductImportOptions = {
  updateQuantities: boolean;
};

const BATCH = 50;

export function productExampleRow(): Record<string, unknown> {
  return {
    الكود: "SKU-001",
    الاسم: "صنف تجريبي",
    القسم: "عام",
    الوحدة: "قطعة",
    "سعر الشراء": estimatedBuyPriceFromSell(15),
    "سعر البيع": 15,
    الكمية: 100,
    "الرصيد الافتتاحي": 100,
    "الحد الأدنى": 5,
    "تنبيه النواقص": "نعم",
    الوصف: "",
    نشط: "نعم",
  };
}

export function downloadProductTemplate(): void {
  downloadTemplate(
    PRODUCT_COLUMNS.map((c) => c.header),
    productExampleRow(),
    getEntityLabel("products"),
    "أصناف"
  );
}

export function exportProducts(products: Product[]): void {
  const rows = products.map((p) => ({
    الكود: p.sku,
    الاسم: p.name,
    القسم: p.category?.name ?? "",
    الوحدة: p.unit,
    "سعر الشراء": p.buy_price,
    "سعر البيع": p.sell_price,
    الكمية: p.quantity,
    "الرصيد الافتتاحي": p.opening_quantity ?? "",
    "الحد الأدنى": p.min_quantity,
    "تنبيه النواقص": p.notify_low_stock === false ? "لا" : "نعم",
    الوصف: p.description ?? "",
    نشط: p.is_active ? "نعم" : "لا",
  }));
  exportRows(rows, getEntityLabel("products"), "أصناف");
}

export function buildProductPreview(
  rows: Record<string, unknown>[],
  existing: Product[],
  options: ProductImportOptions
): ProductPreviewRow[] {
  const bySku = new Map(
    existing.map((p) => [p.sku.trim().toLowerCase(), p])
  );
  const seenInFile = new Set<string>();

  return rows.map((row, i) => {
    const rowIndex = i + 2; // 1-based + header
    const errors: string[] = [];
    const warnings: string[] = [];

    const sku = cellToString(row.sku);
    const name = cellToString(row.name);
    const categoryName = cellToString(row.category) || "عام";

    if (!sku) errors.push("الكود مطلوب");
    if (!name) errors.push("الاسم مطلوب");

    const skuKey = sku.toLowerCase();
    if (sku && seenInFile.has(skuKey)) {
      errors.push("الكود مكرر في الملف");
    } else if (sku) {
      seenInFile.add(skuKey);
    }

    const buy = parseNumber(row.buy_price);
    const sell = parseNumber(row.sell_price);
    const qty = parseNumber(row.quantity);
    const opening = parseNumber(row.opening_quantity);
    const minQty = parseNumber(row.min_quantity);

    if (row.buy_price !== "" && row.buy_price != null && buy === null) {
      errors.push("سعر الشراء غير صالح");
    }
    if (row.sell_price !== "" && row.sell_price != null && sell === null) {
      errors.push("سعر البيع غير صالح");
    }
    if (buy != null && buy < 0) errors.push("سعر الشراء لا يمكن أن يكون سالباً");
    if (sell != null && sell < 0) errors.push("سعر البيع لا يمكن أن يكون سالباً");
    if (qty != null && qty < 0) errors.push("الكمية لا يمكن أن تكون سالبة");
    if (minQty != null && minQty < 0) errors.push("الحد الأدنى غير صالح");

    const existingProduct = sku ? bySku.get(skuKey) : undefined;
    const action: RowAction = errors.length
      ? "error"
      : existingProduct
        ? "update"
        : "create";

    if (action === "update" && !options.updateQuantities && qty != null) {
      warnings.push("الكمية في الملف لن تُحدَّث (فعّل تحديث الكميات)");
    }

    const resolvedSell = sell ?? existingProduct?.sell_price ?? 0;
    let resolvedBuy = buy ?? existingProduct?.buy_price ?? 0;
    const buyDiscount = buyDiscountPercentForCategory(categoryName);

    if (buy != null && buy > 0 && Math.abs(buy - resolvedSell) >= 0.005) {
      resolvedBuy = buy;
    } else if (
      buy != null &&
      resolvedSell > 0 &&
      (buy <= 0 || Math.abs(buy - resolvedSell) < 0.005)
    ) {
      resolvedBuy = estimatedBuyPriceFromSell(resolvedSell, buyDiscount);
      warnings.push(
        buy <= 0
          ? `سعر الشراء فارغ — تُسعَّر التكلفة بخصم ${buyDiscount}٪ من البيع (${resolvedBuy})`
          : `سعر الشراء = البيع — تُسعَّر التكلفة بخصم ${buyDiscount}٪ من البيع (${resolvedBuy})`
      );
    } else if (buy == null && !existingProduct && resolvedSell > 0) {
      resolvedBuy = estimatedBuyPriceFromSell(resolvedSell, buyDiscount);
      warnings.push(
        `سعر الشراء فارغ — تُسعَّر التكلفة بخصم ${buyDiscount}٪ من البيع (${resolvedBuy})`
      );
    } else if (buy == null && existingProduct) {
      const existingBuy = Number(existingProduct.buy_price) || 0;
      const existingSell = Number(existingProduct.sell_price) || 0;
      if (
        resolvedSell > 0 &&
        (existingBuy <= 0 || Math.abs(existingBuy - existingSell) < 0.005)
      ) {
        resolvedBuy = estimatedBuyPriceFromSell(resolvedSell, buyDiscount);
        warnings.push(
          `تكلفة تقديرية بخصم ${buyDiscount}٪ من البيع (${resolvedBuy}) — كان الشراء = البيع أو صفر`
        );
      } else {
        resolvedBuy = existingBuy;
      }
    }

    const payload: ProductImportPayload | null =
      errors.length === 0
        ? {
            sku,
            name,
            category_name: categoryName,
            unit: cellToString(row.unit) || "قطعة",
            buy_price: resolvedBuy,
            sell_price: resolvedSell,
            quantity: qty ?? existingProduct?.quantity ?? 0,
            opening_quantity:
              opening ?? existingProduct?.opening_quantity ?? qty ?? 0,
            min_quantity: minQty ?? existingProduct?.min_quantity ?? 0,
            notify_low_stock: parseBoolean(row.notify_low_stock, true),
            description: cellToString(row.description) || null,
            is_active: parseBoolean(row.is_active, true),
          }
        : null;

    return {
      rowIndex,
      action,
      sku,
      name,
      categoryName,
      errors,
      warnings,
      payload,
      existingId: existingProduct?.id,
    };
  });
}

async function ensureCategories(
  supabase: SupabaseClient,
  names: string[],
  existing: Category[]
): Promise<Map<string, string>> {
  const map = new Map(
    existing.map((c) => [c.name.trim().toLowerCase(), c.id])
  );
  const missing = [
    ...new Set(
      names
        .map((n) => n.trim())
        .filter((n) => n && !map.has(n.toLowerCase()))
    ),
  ];

  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("categories")
      .insert(chunk.map((name) => ({ name, description: null })))
      .select("id, name");
    if (error) throw new Error(`فشل إنشاء الأقسام: ${error.message}`);
    for (const c of data ?? []) {
      map.set(c.name.trim().toLowerCase(), c.id);
    }
  }
  return map;
}

export async function applyProductImport(
  supabase: SupabaseClient,
  preview: ProductPreviewRow[],
  categories: Category[],
  options: ProductImportOptions,
  onProgress?: (done: number, total: number) => void
): Promise<{ created: number; updated: number; failed: number }> {
  const valid = preview.filter(
    (r) => r.payload && (r.action === "create" || r.action === "update")
  );
  const total = valid.length;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let done = 0;

  const categoryMap = await ensureCategories(
    supabase,
    valid.map((r) => r.payload!.category_name),
    categories
  );

  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    for (const row of chunk) {
      const p = row.payload!;
      const category_id =
        categoryMap.get(p.category_name.trim().toLowerCase()) ??
        categoryMap.get("عام");
      if (!category_id) {
        failed++;
        done++;
        onProgress?.(done, total);
        continue;
      }

      const base = {
        sku: p.sku,
        name: p.name,
        category_id,
        unit: p.unit,
        buy_price: p.buy_price,
        sell_price: p.sell_price,
        opening_quantity: p.opening_quantity,
        min_quantity: p.min_quantity,
        notify_low_stock: p.notify_low_stock,
        description: p.description,
        is_active: p.is_active,
      };

      if (row.action === "create") {
        const { error } = await supabase.from("products").insert({
          ...base,
          quantity: p.quantity,
        });
        if (error) failed++;
        else created++;
      } else if (row.existingId) {
        const updatePayload: Record<string, unknown> = { ...base };
        if (options.updateQuantities) {
          updatePayload.quantity = p.quantity;
        }
        const { error } = await supabase
          .from("products")
          .update(updatePayload)
          .eq("id", row.existingId);
        if (error) failed++;
        else updated++;
      }
      done++;
      onProgress?.(done, total);
    }
  }

  return { created, updated, failed };
}

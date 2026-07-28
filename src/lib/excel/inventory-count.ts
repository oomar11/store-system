import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product } from "@/types";
import { downloadTemplate, exportRows } from "./download";
import { cellToString, parseNumber } from "./parse";
import type { ColumnDef } from "./schemas";

export const INVENTORY_COUNT_COLUMNS: ColumnDef[] = [
  {
    key: "sku",
    header: "الكود",
    aliases: ["sku", "code", "barcode", "باركود"],
    required: true,
  },
  {
    key: "name",
    header: "الاسم",
    aliases: ["name", "product", "الصنف"],
  },
  {
    key: "system_quantity",
    header: "كمية النظام",
    aliases: ["system_quantity", "system", "stock"],
  },
  {
    key: "counted_quantity",
    header: "الكمية الفعلية",
    aliases: ["counted_quantity", "counted", "qty", "quantity", "الكمية"],
    required: true,
  },
  {
    key: "notes",
    header: "ملاحظات",
    aliases: ["notes", "note", "comment"],
  },
];

export type InventoryCountExportRow = {
  sku: string;
  name: string;
  system_quantity: number;
  counted_quantity: number | null;
  notes?: string | null;
};

export function downloadInventoryCountTemplate(): void {
  downloadTemplate(
    INVENTORY_COUNT_COLUMNS.map((c) => c.header),
    {
      الكود: "SKU-001",
      الاسم: "صنف تجريبي",
      "كمية النظام": 10,
      "الكمية الفعلية": 9,
      ملاحظات: "",
    },
    "جرد",
    "جرد"
  );
}

export function exportInventoryCount(
  rows: InventoryCountExportRow[],
  countNumber?: string
): void {
  const data = rows.map((r) => ({
    الكود: r.sku,
    الاسم: r.name,
    "كمية النظام": r.system_quantity,
    "الكمية الفعلية": r.counted_quantity ?? "",
    ملاحظات: r.notes ?? "",
  }));
  exportRows(data, countNumber ? `جرد-${countNumber}` : "جرد", "جرد");
}

export type InventoryImportPreviewRow = {
  rowIndex: number;
  action: "update" | "add" | "error";
  sku: string;
  name: string;
  counted_quantity: number | null;
  notes: string;
  errors: string[];
  warnings: string[];
  product_id?: string;
  existing_item_id?: string;
  system_quantity: number;
};

export function buildInventoryCountPreview(
  rows: Record<string, unknown>[],
  catalog: Product[],
  existingItems: { id: string; product_id: string; product?: Product | null }[]
): InventoryImportPreviewRow[] {
  const bySku = new Map(
    catalog.map((p) => [p.sku.trim().toLowerCase(), p])
  );
  const itemByProductId = new Map(
    existingItems.map((i) => [i.product_id, i])
  );
  const seen = new Set<string>();

  return rows.map((row, i) => {
    const rowIndex = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const sku = cellToString(row.sku);
    const name = cellToString(row.name);
    const notes = cellToString(row.notes);
    const countedRaw = row.counted_quantity;
    const counted = parseNumber(countedRaw);

    if (!sku) errors.push("الكود مطلوب");
    if (sku) {
      const key = sku.toLowerCase();
      if (seen.has(key)) errors.push("الكود مكرر في الملف");
      else seen.add(key);
    }
    if (countedRaw === "" || countedRaw == null) {
      errors.push("الكمية الفعلية مطلوبة");
    } else if (counted === null) {
      errors.push("الكمية الفعلية غير صالحة");
    } else if (counted < 0) {
      errors.push("الكمية لا يمكن أن تكون سالبة");
    }

    const product = sku ? bySku.get(sku.toLowerCase()) : undefined;
    if (sku && !product) errors.push("الصنف غير موجود في النظام");

    const existing = product ? itemByProductId.get(product.id) : undefined;
    let action: InventoryImportPreviewRow["action"] = errors.length
      ? "error"
      : existing
        ? "update"
        : "add";

    if (action === "add") {
      warnings.push("سيُضاف الصنف لجلسة الجرد");
    }

    return {
      rowIndex,
      action,
      sku,
      name: name || product?.name || "",
      counted_quantity: counted,
      notes,
      errors,
      warnings,
      product_id: product?.id,
      existing_item_id: existing?.id,
      system_quantity: product ? Number(product.quantity) || 0 : 0,
    };
  });
}

export async function applyInventoryCountImport(
  supabase: SupabaseClient,
  countId: string,
  preview: InventoryImportPreviewRow[],
  onProgress?: (done: number, total: number) => void
): Promise<{ updated: number; added: number; failed: number }> {
  const valid = preview.filter(
    (r) =>
      r.product_id &&
      r.counted_quantity != null &&
      (r.action === "update" || r.action === "add")
  );
  let updated = 0;
  let added = 0;
  let failed = 0;
  let done = 0;
  const total = valid.length;

  for (const row of valid) {
    if (row.action === "update" && row.existing_item_id) {
      const { error } = await supabase
        .from("inventory_count_items")
        .update({
          counted_quantity: row.counted_quantity,
          notes: row.notes || null,
        })
        .eq("id", row.existing_item_id);
      if (error) failed++;
      else updated++;
    } else if (row.action === "add" && row.product_id) {
      const { error } = await supabase.from("inventory_count_items").insert({
        count_id: countId,
        product_id: row.product_id,
        system_quantity: row.system_quantity,
        counted_quantity: row.counted_quantity,
        notes: row.notes || null,
      });
      if (error) failed++;
      else added++;
    }
    done++;
    onProgress?.(done, total);
  }

  return { updated, added, failed };
}

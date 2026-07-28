import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category } from "@/types";
import { CATEGORY_COLUMNS, getEntityLabel } from "./schemas";
import { downloadTemplate, exportRows } from "./download";
import { cellToString } from "./parse";

export type RowAction = "create" | "update" | "skip" | "error";

export type CategoryPreviewRow = {
  rowIndex: number;
  action: RowAction;
  name: string;
  errors: string[];
  warnings: string[];
  payload: { name: string; description?: string | null } | null;
  existingId?: string;
};

export function categoryExampleRow(): Record<string, unknown> {
  return {
    الاسم: "عام",
    الوصف: "قسم افتراضي",
  };
}

export function downloadCategoryTemplate(): void {
  downloadTemplate(
    CATEGORY_COLUMNS.map((c) => c.header),
    categoryExampleRow(),
    getEntityLabel("categories"),
    "أقسام"
  );
}

export function exportCategories(categories: Category[]): void {
  const rows = categories.map((c) => ({
    الاسم: c.name,
    الوصف: c.description ?? "",
  }));
  exportRows(rows, getEntityLabel("categories"), "أقسام");
}

export function buildCategoryPreview(
  rows: Record<string, unknown>[],
  existing: Category[]
): CategoryPreviewRow[] {
  const byName = new Map(
    existing.map((c) => [c.name.trim().toLowerCase(), c])
  );
  const seen = new Set<string>();

  return rows.map((row, i) => {
    const rowIndex = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = cellToString(row.name);
    const description = cellToString(row.description) || null;

    if (!name) errors.push("الاسم مطلوب");
    const key = name.toLowerCase();
    if (name && seen.has(key)) errors.push("الاسم مكرر في الملف");
    else if (name) seen.add(key);

    const match = name ? byName.get(key) : undefined;
    const action: RowAction = errors.length
      ? "error"
      : match
        ? "update"
        : "create";

    return {
      rowIndex,
      action,
      name,
      errors,
      warnings,
      payload: errors.length ? null : { name, description },
      existingId: match?.id,
    };
  });
}

export async function applyCategoryImport(
  supabase: SupabaseClient,
  preview: CategoryPreviewRow[],
  onProgress?: (done: number, total: number) => void
): Promise<{ created: number; updated: number; failed: number }> {
  const valid = preview.filter(
    (r) => r.payload && (r.action === "create" || r.action === "update")
  );
  let created = 0;
  let updated = 0;
  let failed = 0;
  let done = 0;
  const total = valid.length;

  for (const row of valid) {
    const p = row.payload!;
    if (row.action === "create") {
      const { error } = await supabase.from("categories").insert({
        name: p.name,
        description: p.description,
      });
      if (error) failed++;
      else created++;
    } else if (row.existingId) {
      const { error } = await supabase
        .from("categories")
        .update({ name: p.name, description: p.description })
        .eq("id", row.existingId);
      if (error) failed++;
      else updated++;
    }
    done++;
    onProgress?.(done, total);
  }

  return { created, updated, failed };
}

import type { InventorySheetConfig } from "@/types";

export const DEFAULT_INVENTORY_SHEET_CONFIG: InventorySheetConfig = {
  show_sku: true,
  show_category: true,
  show_unit: true,
  show_system_qty: true,
  show_counted_blank: true,
  show_variance_blank: false,
  show_notes_blank: true,
  group_by_category: true,
  title: "ورقة جرد مخزون",
  header_notes: "",
  extra_blank_rows: 3,
};

export function normalizeInventorySheetConfig(
  raw: unknown
): InventorySheetConfig {
  const base = { ...DEFAULT_INVENTORY_SHEET_CONFIG };
  if (!raw || typeof raw !== "object") return base;

  const cfg = raw as Partial<InventorySheetConfig>;
  return {
    show_sku: cfg.show_sku ?? base.show_sku,
    show_category: cfg.show_category ?? base.show_category,
    show_unit: cfg.show_unit ?? base.show_unit,
    show_system_qty: cfg.show_system_qty ?? base.show_system_qty,
    show_counted_blank: cfg.show_counted_blank ?? base.show_counted_blank,
    show_variance_blank: cfg.show_variance_blank ?? base.show_variance_blank,
    show_notes_blank: cfg.show_notes_blank ?? base.show_notes_blank,
    group_by_category: cfg.group_by_category ?? base.group_by_category,
    title: typeof cfg.title === "string" && cfg.title.trim()
      ? cfg.title.trim()
      : base.title,
    header_notes:
      typeof cfg.header_notes === "string" ? cfg.header_notes : base.header_notes,
    extra_blank_rows: Math.max(
      0,
      Math.min(20, Number(cfg.extra_blank_rows ?? base.extra_blank_rows) || 0)
    ),
  };
}

/** Column definitions with Arabic headers + English aliases for flexible import. */

export type ExcelEntity = "products" | "customers" | "suppliers" | "categories";

export type ColumnDef = {
  key: string;
  header: string;
  aliases: string[];
  required?: boolean;
};

export const PRODUCT_COLUMNS: ColumnDef[] = [
  { key: "sku", header: "الكود", aliases: ["sku", "code", "barcode", "باركود"], required: true },
  { key: "name", header: "الاسم", aliases: ["name", "product", "الصنف"], required: true },
  { key: "category", header: "القسم", aliases: ["category", "category_name", "التصنيف"] },
  { key: "unit", header: "الوحدة", aliases: ["unit", "وحدة"] },
  { key: "buy_price", header: "سعر الشراء", aliases: ["buy_price", "cost", "purchase_price"] },
  { key: "sell_price", header: "سعر البيع", aliases: ["sell_price", "price", "sale_price"] },
  { key: "quantity", header: "الكمية", aliases: ["quantity", "qty", "stock"] },
  { key: "opening_quantity", header: "الرصيد الافتتاحي", aliases: ["opening_quantity", "opening"] },
  { key: "min_quantity", header: "الحد الأدنى", aliases: ["min_quantity", "min", "reorder"] },
  { key: "notify_low_stock", header: "تنبيه النواقص", aliases: ["notify_low_stock", "notify", "alert"] },
  { key: "description", header: "الوصف", aliases: ["description", "notes", "desc"] },
  { key: "is_active", header: "نشط", aliases: ["is_active", "active", "enabled"] },
];

export const PARTY_COLUMNS: ColumnDef[] = [
  { key: "name", header: "الاسم", aliases: ["name", "customer", "supplier"], required: true },
  { key: "phone", header: "الهاتف", aliases: ["phone", "mobile", "tel", "موبايل"] },
  { key: "email", header: "البريد", aliases: ["email", "mail", "ايميل"] },
  { key: "address", header: "العنوان", aliases: ["address", "addr"] },
  { key: "opening_balance", header: "الرصيد الافتتاحي", aliases: ["opening_balance", "opening", "balance"] },
  { key: "notes", header: "ملاحظات", aliases: ["notes", "note", "comment"] },
];

export const CATEGORY_COLUMNS: ColumnDef[] = [
  { key: "name", header: "الاسم", aliases: ["name", "category"], required: true },
  { key: "description", header: "الوصف", aliases: ["description", "desc", "notes"] },
];

export function getColumns(entity: ExcelEntity): ColumnDef[] {
  switch (entity) {
    case "products":
      return PRODUCT_COLUMNS;
    case "customers":
    case "suppliers":
      return PARTY_COLUMNS;
    case "categories":
      return CATEGORY_COLUMNS;
  }
}

export function getEntityLabel(entity: ExcelEntity): string {
  switch (entity) {
    case "products":
      return "أصناف";
    case "customers":
      return "عملاء";
    case "suppliers":
      return "موردون";
    case "categories":
      return "أقسام";
  }
}

/** Normalize header cell for alias matching. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function mapHeadersToKeys(
  headers: string[],
  columns: ColumnDef[]
): Record<number, string> {
  const mapping: Record<number, string> = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;
    const col = columns.find(
      (c) =>
        normalizeHeader(c.header) === normalized ||
        c.aliases.some((a) => normalizeHeader(a) === normalized) ||
        c.key.toLowerCase() === normalized
    );
    if (col) mapping[index] = col.key;
  });
  return mapping;
}

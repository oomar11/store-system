/** Print layout preference per document kind */
export type PrintLayout = "receipt_80" | "a4";
export type BarcodeLabelSize = "small" | "medium" | "large";
export type ReceiptWidth = "58" | "80";
export type PrintFontSize = "small" | "normal" | "large";

export type PrintDocumentKind =
  | "sale"
  | "purchase"
  | "sale_return"
  | "purchase_return"
  | "quote"
  | "purchase_order"
  | "barcode_label";

export type PrintFormatsConfig = {
  sale: PrintLayout;
  purchase: PrintLayout;
  sale_return: PrintLayout;
  purchase_return: PrintLayout;
  quote: PrintLayout;
  purchase_order: PrintLayout;
  barcode_label: PrintLayout;
  barcode_label_size: BarcodeLabelSize;
  /** عرض ورق الطابعة الحرارية بالملم */
  receipt_width: ReceiptWidth;
  /** حجم خط الفاتورة الحرارية */
  font_size: PrintFontSize;
  show_sku: boolean;
  show_cashier: boolean;
  show_logo: boolean;
  show_address: boolean;
  show_tax_info: boolean;
  show_item_discount: boolean;
  /** طباعة تلقائية بعد حفظ فاتورة البيع */
  auto_print_sale: boolean;
  /** عدد نسخ الطباعة (1–3) */
  print_copies: number;
  /** منطقة توقيع/ختم في ورق A4 */
  a4_show_signature: boolean;
  barcode_show_price: boolean;
  barcode_show_name: boolean;
};

export const DEFAULT_PRINT_FORMATS: PrintFormatsConfig = {
  sale: "receipt_80",
  purchase: "receipt_80",
  sale_return: "receipt_80",
  purchase_return: "receipt_80",
  quote: "receipt_80",
  purchase_order: "a4",
  barcode_label: "a4",
  barcode_label_size: "small",
  receipt_width: "80",
  font_size: "normal",
  show_sku: false,
  show_cashier: true,
  show_logo: true,
  show_address: true,
  show_tax_info: true,
  show_item_discount: true,
  auto_print_sale: false,
  print_copies: 1,
  a4_show_signature: true,
  barcode_show_price: true,
  barcode_show_name: true,
};

export const PRINT_KIND_LABELS: Record<
  Exclude<PrintDocumentKind, "barcode_label">,
  string
> = {
  sale: "فاتورة بيع",
  purchase: "فاتورة شراء",
  sale_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
  quote: "عرض سعر / طلب مبيعات",
  purchase_order: "طلب مشتريات",
};

export const PRINT_DOC_KEYS = [
  "sale",
  "purchase",
  "sale_return",
  "purchase_return",
  "quote",
  "purchase_order",
] as const;

export type PrintDocKey = (typeof PRINT_DOC_KEYS)[number];

export const LABEL_SIZE_OPTS: Record<
  BarcodeLabelSize,
  {
    height: number;
    moduleWidth: number;
    minHeight: number;
    nameClass: string;
    priceClass: string;
  }
> = {
  small: {
    height: 28,
    moduleWidth: 0.9,
    minHeight: 72,
    nameClass: "text-[9px]",
    priceClass: "text-[10px]",
  },
  medium: {
    height: 36,
    moduleWidth: 1.1,
    minHeight: 90,
    nameClass: "text-[10px]",
    priceClass: "text-[11px]",
  },
  large: {
    height: 44,
    moduleWidth: 1.3,
    minHeight: 110,
    nameClass: "text-[11px]",
    priceClass: "text-xs",
  },
};

export const RECEIPT_FONT_CLASSES: Record<
  PrintFontSize,
  { body: string; title: string; meta: string; table: string; total: string }
> = {
  small: {
    body: "text-[9px]",
    title: "text-base",
    meta: "text-[8px]",
    table: "text-[9px]",
    total: "text-[11px]",
  },
  normal: {
    body: "text-[10px]",
    title: "text-xl",
    meta: "text-[9px]",
    table: "text-[10px]",
    total: "text-xs",
  },
  large: {
    body: "text-[11px]",
    title: "text-2xl",
    meta: "text-[10px]",
    table: "text-[11px]",
    total: "text-sm",
  },
};

function isLayout(v: unknown): v is PrintLayout {
  return v === "receipt_80" || v === "a4";
}

function isLabelSize(v: unknown): v is BarcodeLabelSize {
  return v === "small" || v === "medium" || v === "large";
}

function isReceiptWidth(v: unknown): v is ReceiptWidth {
  return v === "58" || v === "80";
}

function isFontSize(v: unknown): v is PrintFontSize {
  return v === "small" || v === "normal" || v === "large";
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asCopies(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_PRINT_FORMATS.print_copies;
  return Math.min(3, Math.max(1, Math.round(n)));
}

export function resolvePrintFormats(raw: unknown): PrintFormatsConfig {
  const src =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PRINT_FORMATS };

  for (const key of PRINT_DOC_KEYS) {
    if (isLayout(src[key])) out[key] = src[key];
  }
  if (isLayout(src.barcode_label)) out.barcode_label = src.barcode_label;
  if (isLabelSize(src.barcode_label_size)) {
    out.barcode_label_size = src.barcode_label_size;
  }
  if (isReceiptWidth(src.receipt_width)) out.receipt_width = src.receipt_width;
  if (isFontSize(src.font_size)) out.font_size = src.font_size;

  out.show_sku = asBool(src.show_sku, out.show_sku);
  out.show_cashier = asBool(src.show_cashier, out.show_cashier);
  out.show_logo = asBool(src.show_logo, out.show_logo);
  out.show_address = asBool(src.show_address, out.show_address);
  out.show_tax_info = asBool(src.show_tax_info, out.show_tax_info);
  out.show_item_discount = asBool(src.show_item_discount, out.show_item_discount);
  out.auto_print_sale = asBool(src.auto_print_sale, out.auto_print_sale);
  out.print_copies = asCopies(src.print_copies);
  out.a4_show_signature = asBool(src.a4_show_signature, out.a4_show_signature);
  out.barcode_show_price = asBool(src.barcode_show_price, out.barcode_show_price);
  out.barcode_show_name = asBool(src.barcode_show_name, out.barcode_show_name);

  return out;
}

export function getPrintLayout(
  formats: PrintFormatsConfig | unknown,
  kind: Exclude<PrintDocumentKind, "barcode_label">
): PrintLayout {
  const cfg = resolvePrintFormats(formats);
  return cfg[kind];
}

export function isReceiptLayout(
  formats: PrintFormatsConfig | unknown,
  kind: Exclude<PrintDocumentKind, "barcode_label">
): boolean {
  return getPrintLayout(formats, kind) === "receipt_80";
}

export function getReceiptWidthMm(
  formats: PrintFormatsConfig | unknown
): 58 | 80 {
  return resolvePrintFormats(formats).receipt_width === "58" ? 58 : 80;
}

/** Apply receipt width class on <html> for @media print. */
export function applyReceiptPrintWidth(widthMm: 58 | 80) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("print-receipt-58", widthMm === 58);
  root.classList.toggle("print-receipt-80", widthMm === 80);
  root.style.setProperty("--print-receipt-width", `${widthMm}mm`);
}

export function clearReceiptPrintWidth() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("print-receipt-58", "print-receipt-80");
  root.style.removeProperty("--print-receipt-width");
}

/** Presets for quick setup */
export const PRINT_PRESETS = {
  thermal_fast: {
    label: "كاشير سريع",
    description: "80مم · خط عادي · بدون SKU",
    patch: {
      sale: "receipt_80" as PrintLayout,
      sale_return: "receipt_80" as PrintLayout,
      quote: "receipt_80" as PrintLayout,
      receipt_width: "80" as ReceiptWidth,
      font_size: "normal" as PrintFontSize,
      show_sku: false,
      show_cashier: true,
      show_logo: true,
      show_address: true,
      show_tax_info: true,
      auto_print_sale: true,
      print_copies: 1,
    },
  },
  thermal_compact: {
    label: "طابعة 58مم",
    description: "عرض ضيق · خط صغير · مختصر",
    patch: {
      sale: "receipt_80" as PrintLayout,
      sale_return: "receipt_80" as PrintLayout,
      receipt_width: "58" as ReceiptWidth,
      font_size: "small" as PrintFontSize,
      show_sku: false,
      show_address: false,
      show_tax_info: true,
      show_logo: true,
      print_copies: 1,
    },
  },
  a4_pro: {
    label: "A4 احترافي",
    description: "بيع وشراء على ورق A4 مع توقيع",
    patch: {
      sale: "a4" as PrintLayout,
      purchase: "a4" as PrintLayout,
      sale_return: "a4" as PrintLayout,
      purchase_return: "a4" as PrintLayout,
      quote: "a4" as PrintLayout,
      purchase_order: "a4" as PrintLayout,
      a4_show_signature: true,
      show_sku: true,
      show_logo: true,
      show_tax_info: true,
      auto_print_sale: false,
    },
  },
} as const;

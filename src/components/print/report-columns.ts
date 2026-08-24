import { formatCurrency, formatDateShort, DOCUMENT_STAGE_LABELS } from "@/lib/utils";

export type ReportColumn<T = Record<string, unknown>> = {
  key: string;
  label: string;
  getValue: (row: T) => string | number;
  align?: "right" | "center" | "left";
};

function paymentLabel(method: string | undefined): string {
  if (method === "cash") return "نقدي";
  if (method === "credit") return "آجل";
  if (method === "bank_transfer") return "تحويل بنكي";
  return method || "—";
}

function statusLabel(status: string | undefined): string {
  if (status === "completed") return "مكتملة";
  if (status === "draft") return "مسودة";
  if (status === "cancelled") return "ملغاة";
  return status || "—";
}

function txTypeLabel(type: string | undefined): string {
  if (type === "deposit") return "إيداع";
  if (type === "withdrawal") return "سحب";
  if (type === "transfer") return "تحويل";
  return type || "—";
}

export const customerListColumns: ReportColumn[] = [
  { key: "name", label: "الاسم", getValue: (r) => String(r.name ?? "") },
  { key: "phone", label: "الهاتف", getValue: (r) => String(r.phone || "—") },
  { key: "address", label: "العنوان", getValue: (r) => String(r.address || "—") },
  {
    key: "balance",
    label: "الرصيد",
    getValue: (r) => formatCurrency(Number(r.balance ?? 0)),
  },
  {
    key: "last_activity_at",
    label: "آخر تعامل",
    getValue: (r) =>
      r.last_activity_at
        ? formatDateShort(String(r.last_activity_at))
        : "—",
  },
  { key: "notes", label: "ملاحظات", getValue: (r) => String(r.notes || "—") },
];

export const supplierListColumns: ReportColumn[] = [
  { key: "name", label: "الاسم", getValue: (r) => String(r.name ?? "") },
  { key: "phone", label: "الهاتف", getValue: (r) => String(r.phone || "—") },
  { key: "address", label: "العنوان", getValue: (r) => String(r.address || "—") },
  {
    key: "balance",
    label: "الرصيد",
    getValue: (r) => formatCurrency(Number(r.balance ?? 0)),
  },
  {
    key: "last_activity_at",
    label: "آخر تعامل",
    getValue: (r) =>
      r.last_activity_at
        ? formatDateShort(String(r.last_activity_at))
        : "—",
  },
  { key: "notes", label: "ملاحظات", getValue: (r) => String(r.notes || "—") },
];

export const productListColumns: ReportColumn[] = [
  { key: "name", label: "الصنف", getValue: (r) => String(r.name ?? "") },
  { key: "sku", label: "الكود", getValue: (r) => String(r.sku ?? "") },
  {
    key: "category",
    label: "الفئة",
    getValue: (r) => {
      const cat = r.category as { name?: string } | undefined;
      return cat?.name || "—";
    },
  },
  { key: "quantity", label: "الكمية", getValue: (r) => Number(r.quantity ?? 0) },
  {
    key: "buy_price",
    label: "سعر الشراء",
    getValue: (r) => formatCurrency(Number(r.buy_price ?? 0)),
  },
  {
    key: "sell_price",
    label: "سعر البيع",
    getValue: (r) => formatCurrency(Number(r.sell_price ?? 0)),
  },
  {
    key: "value",
    label: "قيمة المخزون",
    getValue: (r) =>
      formatCurrency(Number(r.quantity ?? 0) * Number(r.buy_price ?? 0)),
  },
];

export const saleInvoiceColumns: ReportColumn[] = [
  {
    key: "invoice_number",
    label: "رقم الفاتورة",
    getValue: (r) => String(r.invoice_number ?? ""),
  },
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "customer",
    label: "العميل",
    getValue: (r) => {
      const c = r.customer as { name?: string } | undefined;
      return c?.name || "نقدي";
    },
  },
  {
    key: "payment_method",
    label: "الدفع",
    getValue: (r) => paymentLabel(String(r.payment_method ?? "")),
  },
  {
    key: "total",
    label: "الإجمالي",
    getValue: (r) => formatCurrency(Number(r.total ?? 0)),
  },
  {
    key: "paid_amount",
    label: "المدفوع",
    getValue: (r) => formatCurrency(Number(r.paid_amount ?? 0)),
  },
  {
    key: "remaining",
    label: "المتبقي",
    getValue: (r) =>
      formatCurrency(Number(r.total ?? 0) - Number(r.paid_amount ?? 0)),
  },
  {
    key: "status",
    label: "الحالة",
    getValue: (r) => statusLabel(String(r.status ?? "")),
  },
];

export const purchaseInvoiceColumns: ReportColumn[] = [
  {
    key: "invoice_number",
    label: "رقم الفاتورة",
    getValue: (r) => String(r.invoice_number ?? ""),
  },
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "supplier",
    label: "المورد",
    getValue: (r) => {
      const s = r.supplier as { name?: string } | undefined;
      return s?.name || "—";
    },
  },
  {
    key: "payment_method",
    label: "الدفع",
    getValue: (r) => paymentLabel(String(r.payment_method ?? "")),
  },
  {
    key: "total",
    label: "الإجمالي",
    getValue: (r) => formatCurrency(Number(r.total ?? 0)),
  },
  {
    key: "paid_amount",
    label: "المدفوع",
    getValue: (r) => formatCurrency(Number(r.paid_amount ?? 0)),
  },
  {
    key: "remaining",
    label: "المتبقي",
    getValue: (r) =>
      formatCurrency(Number(r.total ?? 0) - Number(r.paid_amount ?? 0)),
  },
  {
    key: "status",
    label: "الحالة",
    getValue: (r) => statusLabel(String(r.status ?? "")),
  },
];

export const treasuryColumns: ReportColumn[] = [
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "safe",
    label: "الخزنة",
    getValue: (r) => {
      const s = r.safe as { name?: string } | undefined;
      return s?.name || "—";
    },
  },
  {
    key: "type",
    label: "النوع",
    getValue: (r) => txTypeLabel(String(r.type ?? "")),
  },
  {
    key: "amount",
    label: "المبلغ",
    getValue: (r) => formatCurrency(Number(r.amount ?? 0)),
  },
  {
    key: "description",
    label: "البيان",
    getValue: (r) => String(r.description || "—"),
  },
  {
    key: "notes",
    label: "ملاحظة",
    getValue: (r) => String(r.notes || "—"),
  },
];

export const expenseColumns: ReportColumn[] = [
  {
    key: "date",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.date ?? new Date())),
  },
  {
    key: "entry_number",
    label: "رقم القيد",
    getValue: (r) => String(r.entry_number ?? "—"),
  },
  {
    key: "expense_account_name",
    label: "الحساب",
    getValue: (r) =>
      `${r.expense_account_code ? String(r.expense_account_code) + " — " : ""}${String(r.expense_account_name ?? "—")}`,
  },
  {
    key: "safe_name",
    label: "الخزنة",
    getValue: (r) => String(r.safe_name || "—"),
  },
  {
    key: "amount",
    label: "المبلغ",
    getValue: (r) => formatCurrency(Number(r.amount ?? 0)),
  },
  {
    key: "description",
    label: "البيان",
    getValue: (r) => String(r.description || "—"),
  },
  {
    key: "notes",
    label: "ملاحظة",
    getValue: (r) => String(r.notes || "—"),
  },
];

function accuracyLabel(v: string | undefined): string {
  if (v === "reliable") return "موثوق";
  if (v === "estimated") return "تقديري";
  if (v === "mixed") return "مختلط";
  return v || "—";
}

export const invoiceProfitColumns: ReportColumn[] = [
  {
    key: "invoice_number",
    label: "رقم الفاتورة",
    getValue: (r) => String(r.invoice_number ?? ""),
  },
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "customer_name",
    label: "العميل",
    getValue: (r) => String(r.customer_name || "نقدي"),
  },
  {
    key: "type",
    label: "النوع",
    getValue: (r) => (r.type === "sale_return" ? "مرتجع" : "بيع"),
  },
  {
    key: "revenue",
    label: "صافي البيع",
    getValue: (r) => formatCurrency(Number(r.revenue ?? 0)),
  },
  {
    key: "cost",
    label: "التكلفة",
    getValue: (r) => formatCurrency(Number(r.cost ?? 0)),
  },
  {
    key: "profit",
    label: "الربح",
    getValue: (r) => formatCurrency(Number(r.profit ?? 0)),
  },
  {
    key: "margin",
    label: "الهامش %",
    getValue: (r) => `${Number(r.margin ?? 0).toFixed(1)}%`,
  },
  {
    key: "paid_amount",
    label: "المدفوع",
    getValue: (r) => formatCurrency(Number(r.paid_amount ?? 0)),
  },
  {
    key: "remaining",
    label: "المتبقي",
    getValue: (r) => formatCurrency(Number(r.remaining ?? 0)),
  },
  {
    key: "accuracy",
    label: "دقة التكلفة",
    getValue: (r) => accuracyLabel(String(r.accuracy ?? "")),
  },
];

export const customerProfitColumns: ReportColumn[] = [
  { key: "name", label: "العميل", getValue: (r) => String(r.name ?? "") },
  { key: "phone", label: "الهاتف", getValue: (r) => String(r.phone || "—") },
  {
    key: "invoice_count",
    label: "الفواتير",
    getValue: (r) => Number(r.invoice_count ?? 0),
  },
  {
    key: "revenue",
    label: "صافي المبيعات",
    getValue: (r) => formatCurrency(Number(r.revenue ?? 0)),
  },
  {
    key: "cost",
    label: "التكلفة",
    getValue: (r) => formatCurrency(Number(r.cost ?? 0)),
  },
  {
    key: "profit",
    label: "الربح",
    getValue: (r) => formatCurrency(Number(r.profit ?? 0)),
  },
  {
    key: "margin",
    label: "الهامش %",
    getValue: (r) => `${Number(r.margin ?? 0).toFixed(1)}%`,
  },
  {
    key: "collected",
    label: "المحصل",
    getValue: (r) => formatCurrency(Number(r.collected ?? 0)),
  },
  {
    key: "remaining",
    label: "المتبقي",
    getValue: (r) => formatCurrency(Number(r.remaining ?? 0)),
  },
  {
    key: "balance",
    label: "الرصيد الحالي",
    getValue: (r) => formatCurrency(Number(r.balance ?? 0)),
  },
  {
    key: "accuracy",
    label: "دقة التكلفة",
    getValue: (r) => accuracyLabel(String(r.accuracy ?? "")),
  },
];

export const productProfitColumns: ReportColumn[] = [
  { key: "name", label: "الصنف", getValue: (r) => String(r.name ?? "") },
  { key: "sku", label: "الكود", getValue: (r) => String(r.sku ?? "") },
  {
    key: "category",
    label: "الفئة",
    getValue: (r) => String(r.category || "—"),
  },
  {
    key: "qty_sold",
    label: "الكمية المباعة",
    getValue: (r) => Number(r.qty_sold ?? 0),
  },
  {
    key: "revenue",
    label: "الإيراد",
    getValue: (r) => formatCurrency(Number(r.revenue ?? 0)),
  },
  {
    key: "profit",
    label: "الربح",
    getValue: (r) => formatCurrency(Number(r.profit ?? 0)),
  },
  {
    key: "margin",
    label: "الهامش %",
    getValue: (r) => `${Number(r.margin ?? 0).toFixed(1)}%`,
  },
  {
    key: "stock_qty",
    label: "المخزون",
    getValue: (r) => Number(r.stock_qty ?? 0),
  },
  {
    key: "stock_value",
    label: "المخزون بالتكلفة",
    getValue: (r) => formatCurrency(Number(r.stock_value ?? 0)),
  },
  {
    key: "stock_value_sell",
    label: "المخزون بسعر البيع",
    getValue: (r) => formatCurrency(Number(r.stock_value_sell ?? 0)),
  },
  {
    key: "stock_status",
    label: "الحالة",
    getValue: (r) => {
      const s = String(r.stock_status ?? "");
      if (s === "out") return "نافد";
      if (s === "low") return "منخفض";
      return "متوفر";
    },
  },
];

export const documentListColumns: ReportColumn[] = [
  {
    key: "document_number",
    label: "الرقم",
    getValue: (r) => String(r.document_number ?? ""),
  },
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "party",
    label: "الطرف",
    getValue: (r) => {
      const c = r.customer as { name?: string } | undefined;
      const s = r.supplier as { name?: string } | undefined;
      return c?.name || s?.name || "—";
    },
  },
  {
    key: "stage",
    label: "المرحلة",
    getValue: (r) =>
      DOCUMENT_STAGE_LABELS[String(r.stage ?? "")] || String(r.stage ?? "—"),
  },
  {
    key: "total",
    label: "الإجمالي",
    getValue: (r) => formatCurrency(Number(r.total ?? 0)),
  },
];

export const returnInvoiceColumns: ReportColumn[] = [
  {
    key: "invoice_number",
    label: "رقم المرتجع",
    getValue: (r) => String(r.invoice_number ?? ""),
  },
  {
    key: "original_invoice",
    label: "الفاتورة الأصلية",
    getValue: (r) => {
      const orig = r.original_invoice as { invoice_number?: string } | undefined;
      return orig?.invoice_number || "—";
    },
  },
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "party",
    label: "الطرف",
    getValue: (r) => {
      const c = r.customer as { name?: string } | undefined;
      const s = r.supplier as { name?: string } | undefined;
      return c?.name || s?.name || "—";
    },
  },
  {
    key: "total",
    label: "الإجمالي",
    getValue: (r) => formatCurrency(Number(r.total ?? 0)),
  },
  {
    key: "status",
    label: "الحالة",
    getValue: (r) => statusLabel(String(r.status ?? "")),
  },
];

export const statementInvoiceColumns: ReportColumn[] = [
  {
    key: "invoice_number",
    label: "الرقم",
    getValue: (r) => String(r.invoice_number ?? ""),
  },
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "type",
    label: "النوع",
    getValue: (r) => {
      const t = String(r.type ?? "");
      if (t === "sale") return "بيع";
      if (t === "purchase") return "شراء";
      if (t === "sale_return") return "مرتجع بيع";
      if (t === "purchase_return") return "مرتجع شراء";
      if (t === "opening") return "رصيد افتتاحي";
      if (t === "collection") return "تحصيل";
      if (t === "disbursement") return "سداد";
      if (t === "settlement") return "مقاصة";
      if (t === "workshop_sale") {
        const src = String(r.payment_method ?? "");
        if (src === "بلسية") return "فاتورة بلسية";
        if (src === "PVC") return "فاتورة PVC";
        return "بيع ورشة";
      }
      if (t === "workshop_collection") {
        const src = String(r.payment_method ?? "");
        if (src === "بلسية") return "تحصيل بلسية";
        if (src === "PVC") return "تحصيل PVC";
        return "تحصيل ورشة";
      }
      if (t === "workshop_adjustment") return "تسوية ورشة";
      if (t === "workshop_void") return "إلغاء ورشة";
      return t || "—";
    },
  },
  {
    key: "payment_method",
    label: "المصدر / الدفع",
    getValue: (r) => {
      const t = String(r.type ?? "");
      if (
        t === "collection" ||
        t === "disbursement" ||
        t === "settlement" ||
        t.startsWith("workshop_")
      ) {
        return String(
          r.payment_method || (t === "settlement" ? "مقاصة" : "خزنة")
        );
      }
      return paymentLabel(String(r.payment_method ?? ""));
    },
  },
  {
    key: "total",
    label: "الإجمالي",
    getValue: (r) => {
      const t = String(r.type ?? "");
      if (
        t === "collection" ||
        t === "disbursement" ||
        t === "settlement" ||
        t === "workshop_collection"
      )
        return "—";
      return formatCurrency(Number(r.total ?? 0));
    },
  },
  {
    key: "paid_amount",
    label: "المدفوع",
    getValue: (r) => formatCurrency(Number(r.paid_amount ?? 0)),
  },
  {
    key: "remaining",
    label: "المتبقي",
    getValue: (r) => {
      const t = String(r.type ?? "");
      if (
        t === "collection" ||
        t === "disbursement" ||
        t === "settlement" ||
        t === "opening" ||
        t.startsWith("workshop_")
      ) {
        return "—";
      }
      return formatCurrency(Number(r.total ?? 0) - Number(r.paid_amount ?? 0));
    },
  },
];

export const partyHistoryColumns: ReportColumn[] = [
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "invoice_number",
    label: "المستند",
    getValue: (r) => String(r.invoice_number ?? ""),
  },
  {
    key: "type",
    label: "النوع",
    getValue: (r) => {
      const t = String(r.type ?? "");
      if (t === "sale") return "بيع";
      if (t === "purchase") return "شراء";
      if (t === "sale_return") return "مرتجع بيع";
      if (t === "purchase_return") return "مرتجع شراء";
      if (t === "opening") return "رصيد افتتاحي";
      if (t === "collection") return "تحصيل";
      if (t === "disbursement") return "سداد";
      if (t === "settlement") return "مقاصة";
      if (t === "workshop_sale") {
        const src = String(r.payment_method ?? r.sourceSystem ?? "");
        if (src === "بلسية" || src === "plisse") return "فاتورة بلسية";
        if (src === "PVC" || src === "aa") return "فاتورة PVC";
        return "بيع ورشة";
      }
      if (t === "workshop_collection") {
        const src = String(r.payment_method ?? r.sourceSystem ?? "");
        if (src === "بلسية" || src === "plisse") return "تحصيل بلسية";
        if (src === "PVC" || src === "aa") return "تحصيل PVC";
        return "تحصيل ورشة";
      }
      if (t === "workshop_adjustment") return "تسوية ورشة";
      if (t === "workshop_void") return "إلغاء ورشة";
      return t || "—";
    },
  },
  {
    key: "total",
    label: "الإجمالي",
    getValue: (r) => {
      const t = String(r.type ?? "");
      if (
        t === "collection" ||
        t === "disbursement" ||
        t === "settlement" ||
        t === "workshop_collection"
      )
        return "—";
      return formatCurrency(Number(r.total ?? 0));
    },
  },
  {
    key: "paid_amount",
    label: "المدفوع",
    getValue: (r) => formatCurrency(Number(r.paid_amount ?? 0)),
  },
  {
    key: "remaining",
    label: "المتبقي",
    getValue: (r) => {
      if (
        r.type === "opening" ||
        r.type === "collection" ||
        r.type === "disbursement" ||
        r.type === "settlement" ||
        String(r.type ?? "").startsWith("workshop_")
      ) {
        return "—";
      }
      return formatCurrency(Number(r.total ?? 0) - Number(r.paid_amount ?? 0));
    },
  },
  {
    key: "notes",
    label: "ملاحظات",
    getValue: (r) => String(r.notes || "—"),
  },
];

export const partyPaymentPrintColumns: ReportColumn[] = [
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => formatDateShort(String(r.created_at ?? new Date())),
  },
  {
    key: "doc",
    label: "المستند",
    getValue: (r) => {
      const id = String(r.id ?? "");
      const kind = String(r.party_type ?? "customer") as "customer" | "supplier";
      if (!id) return "—";
      const prefix = kind === "customer" ? "تحص" : "سداد";
      return `${prefix}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    },
  },
  {
    key: "amount",
    label: "المبلغ",
    getValue: (r) => formatCurrency(Number(r.amount ?? 0)),
  },
  {
    key: "safe_name",
    label: "الخزنة",
    getValue: (r) => String(r.safe_name || "—"),
  },
  {
    key: "allocations",
    label: "التوزيع",
    getValue: (r) => {
      const allocs = r.allocations as
        | { invoice_number?: string; amount: number }[]
        | undefined;
      if (!allocs?.length) return "—";
      return allocs
        .map(
          (a) =>
            `${a.invoice_number || "فاتورة"}: ${formatCurrency(Number(a.amount))}`
        )
        .join(" · ");
    },
  },
  {
    key: "notes",
    label: "ملاحظة",
    getValue: (r) => String(r.notes || "—"),
  },
];

export const productMovementColumns: ReportColumn[] = [
  {
    key: "created_at",
    label: "التاريخ",
    getValue: (r) => {
      const inv = r.invoice as { created_at?: string } | null | undefined;
      return formatDateShort(String(inv?.created_at ?? new Date()));
    },
  },
  {
    key: "invoice_number",
    label: "المستند",
    getValue: (r) => {
      const inv = r.invoice as { invoice_number?: string } | null | undefined;
      return String(inv?.invoice_number ?? "—");
    },
  },
  {
    key: "type",
    label: "النوع",
    getValue: (r) => {
      const inv = r.invoice as { type?: string } | null | undefined;
      const t = String(inv?.type ?? "");
      if (t === "sale") return "بيع";
      if (t === "purchase") return "شراء";
      if (t === "sale_return") return "مرتجع بيع";
      if (t === "purchase_return") return "مرتجع شراء";
      if (t === "opening") return "رصيد افتتاحي";
      return t || "—";
    },
  },
  {
    key: "party",
    label: "الطرف",
    getValue: (r) => {
      const inv = r.invoice as
        | {
            type?: string;
            customer?: { name?: string } | null;
            supplier?: { name?: string } | null;
          }
        | null
        | undefined;
      if (inv?.type === "opening") return "رصيد ابتدائي";
      return inv?.customer?.name || inv?.supplier?.name || "—";
    },
  },
  {
    key: "quantity",
    label: "الكمية",
    getValue: (r) => {
      const inv = r.invoice as { type?: string } | null | undefined;
      const t = String(inv?.type ?? "");
      const qty = Number(r.quantity ?? 0);
      if (t === "purchase" || t === "sale_return" || t === "opening") return `+${qty}`;
      if (t === "sale" || t === "purchase_return") return `−${qty}`;
      return qty;
    },
  },
  {
    key: "running_balance",
    label: "الرصيد",
    getValue: (r) =>
      r.running_balance == null ? "—" : Number(r.running_balance),
  },
  {
    key: "unit_price",
    label: "سعر الوحدة",
    getValue: (r) => formatCurrency(Number(r.unit_price ?? 0)),
  },
  {
    key: "total",
    label: "الإجمالي",
    getValue: (r) => formatCurrency(Number(r.total ?? 0)),
  },
];

export function resolveStoreName(settings: { store_name?: string } | null): string {
  const name = settings?.store_name?.trim();
  return name || "ويندور";
}

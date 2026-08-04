export type UserRole = "owner" | "manager" | "employee";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  /** null = use role template; otherwise custom permission keys */
  permissions?: string[] | null;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category_id: string;
  category?: Category;
  unit: string;
  /** عدد الوحدات الأساسية داخل التعبئة (كرتونة مثلاً) — المخزون بالوحدة الأساسية */
  pack_size?: number;
  buy_price: number;
  sell_price: number;
  quantity: number;
  /** الرصيد الافتتاحي عند بدء استخدام الصنف */
  opening_quantity?: number;
  min_quantity: number;
  /** عند false لا يظهر الصنف في إشعارات النواقص (افتراضي true) */
  notify_low_stock?: boolean;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceTier {
  id: string;
  name: string;
  is_default: boolean;
  sort_order: number;
  created_at: string;
}

export interface ProductTierPrice {
  product_id: string;
  tier_id: string;
  sell_price: number;
}

/** نسبة خصم شريحة على قسم كامل (من سعر التجزئة) */
export interface TierCategoryDiscount {
  tier_id: string;
  category_id: string;
  discount_percent: number;
  created_at?: string;
  category?: Category;
}

/** نسبة خصم شريحة على منتج معيّن (من سعر التجزئة) */
export interface TierProductDiscount {
  tier_id: string;
  product_id: string;
  discount_percent: number;
  created_at?: string;
  product?: Product;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  /** الرصيد الجاري: موجب = عليه، سالب = له */
  balance: number;
  /** الرصيد الابتدائي عند الإنشاء/التعديل */
  opening_balance?: number;
  notes?: string;
  /** شريحة السعر (null = تجزئة / الافتراضي) */
  price_tier_id?: string | null;
  price_tier?: PriceTier | null;
  /** عند false لا يظهر في نقطة البيع والفواتير */
  is_active?: boolean;
  /** آخر فاتورة أو دفعة */
  last_activity_at?: string | null;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  /** الرصيد الجاري: موجب = علينا، سالب = لنا */
  balance: number;
  /** الرصيد الابتدائي عند الإنشاء/التعديل */
  opening_balance?: number;
  notes?: string;
  /** عند false لا يظهر في المشتريات والفواتير */
  is_active?: boolean;
  /** آخر فاتورة أو دفعة */
  last_activity_at?: string | null;
  created_at: string;
}

export type InvoiceType = "sale" | "purchase" | "sale_return" | "purchase_return";
export type InvoiceStatus = "draft" | "completed" | "cancelled";
export type PaymentMethod = "cash" | "credit" | "bank_transfer";

export interface Invoice {
  id: string;
  invoice_number: string;
  type: InvoiceType;
  status: InvoiceStatus;
  customer_id?: string;
  customer?: Customer;
  supplier_id?: string;
  supplier?: Supplier;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  paid_amount: number;
  payment_method: PaymentMethod;
  safe_id?: string;
  notes?: string;
  /** Source sale/purchase invoice for returns; null for sale/purchase */
  original_invoice_id?: string | null;
  original_invoice?: Pick<Invoice, "id" | "invoice_number" | "type"> | null;
  created_by: string;
  created_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string;
  product?: Product;
  quantity: number;
  unit_price: number;
  /** Cost snapshot at sale time; null/undefined = legacy estimated via current buy_price */
  unit_cost?: number | null;
  discount: number;
  total: number;
}

export type DocumentType = "purchase_order" | "quote";
export type DocumentStage =
  | "draft"
  | "sent"
  | "approved"
  | "rejected"
  | "converted"
  | "cancelled";

export interface CommercialDocument {
  id: string;
  document_number: string;
  type: DocumentType;
  stage: DocumentStage;
  customer_id?: string;
  customer?: Customer;
  supplier_id?: string;
  supplier?: Supplier;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  notes?: string;
  valid_until?: string;
  expected_date?: string;
  converted_invoice_id?: string;
  converted_invoice?: { id: string; invoice_number: string } | null;
  created_by?: string;
  created_at: string;
  updated_at: string;
  items?: DocumentItem[];
}

export interface DocumentItem {
  id: string;
  document_id: string;
  product_id: string;
  product?: Product;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parent_id?: string;
  balance: number;
  is_active: boolean;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  date: string;
  description: string;
  notes?: string | null;
  is_posted: boolean;
  created_by: string;
  created_at: string;
  lines?: JournalLine[];
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  account?: Account;
  debit: number;
  credit: number;
  description?: string;
}

export interface Safe {
  id: string;
  name: string;
  balance: number;
  opening_balance?: number;
  is_active: boolean;
  sort_order?: number;
  created_at: string;
}

export interface SafeTransaction {
  id: string;
  safe_id: string;
  safe?: Safe;
  type: "deposit" | "withdrawal" | "transfer";
  amount: number;
  description: string;
  notes?: string | null;
  reference_type?: string;
  reference_id?: string;
  related_safe_id?: string;
  related_safe?: Safe;
  transfer_group_id?: string;
  created_by: string;
  created_at: string;
}

export type InventoryCountStatus =
  | "draft"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface InventorySheetConfig {
  show_sku: boolean;
  show_category: boolean;
  show_unit: boolean;
  show_system_qty: boolean;
  show_counted_blank: boolean;
  show_variance_blank: boolean;
  show_notes_blank: boolean;
  group_by_category: boolean;
  title: string;
  header_notes: string;
  extra_blank_rows: number;
}

export interface InventoryCount {
  id: string;
  count_number: string;
  status: InventoryCountStatus;
  notes?: string;
  created_by?: string;
  completed_at?: string;
  created_at: string;
  items?: InventoryCountItem[];
}

export interface InventoryCountItem {
  id: string;
  count_id: string;
  product_id: string;
  product?: Product;
  system_quantity: number;
  counted_quantity: number | null;
  notes?: string;
}

export interface Settings {
  id: string;
  store_name: string;
  phone?: string;
  address?: string;
  tax_rate: number;
  tax_enabled: boolean;
  currency: string;
  logo_url?: string;
  /** رقم التسجيل الضريبي */
  tax_number?: string | null;
  /** السجل التجاري */
  commercial_register?: string | null;
  /** نص أسفل الفاتورة */
  receipt_footer?: string | null;
  /** قيمة افتراضية لـ min_quantity عند إنشاء منتج */
  default_low_stock_threshold?: number;
  print_offset: number;
  /** جملة تظهر تحت اسم المحل في فاتورة البيع (مثل: وكيل حصري لـ...) */
  invoice_tagline?: string;
  /** خزنة درج الكاشير لاستلام/تسليم الوردية */
  drawer_safe_id?: string | null;
  inventory_sheet_config?: InventorySheetConfig | Record<string, unknown>;
  /** تفضيلات تنسيق الطباعة لكل نوع مستند */
  print_formats?: import("@/lib/print-formats").PrintFormatsConfig | Record<string, unknown>;
}


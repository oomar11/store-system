export type ReportSection =
  | "overview"
  | "invoices"
  | "customers"
  | "products"
  | "treasury"
  | "expenses";

export type DatePreset = "today" | "7days" | "month" | "custom";

export type CostAccuracy = "reliable" | "estimated" | "mixed";

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export interface InvoiceLineRaw {
  id: string;
  invoice_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  unit_cost: number | null;
  discount: number;
  total: number;
  product?: {
    id: string;
    name: string;
    sku: string;
    buy_price: number;
    sell_price: number;
    quantity: number;
    min_quantity: number;
    category?: { name?: string } | null;
  } | null;
}

export interface InvoiceRaw {
  id: string;
  invoice_number: string;
  type: "sale" | "sale_return" | "purchase" | "purchase_return";
  status: string;
  customer_id?: string | null;
  customer?: { id?: string; name?: string; phone?: string; balance?: number } | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  paid_amount: number;
  payment_method: string;
  created_at: string;
  notes?: string | null;
  items?: InvoiceLineRaw[];
}

export interface ProductRaw {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  buy_price: number;
  sell_price: number;
  min_quantity: number;
  category?: { name?: string } | null;
}

export interface CustomerRaw {
  id: string;
  name: string;
  phone?: string | null;
  balance: number;
  address?: string | null;
  notes?: string | null;
}

export interface TreasuryRaw {
  id: string;
  type: "deposit" | "withdrawal" | "transfer";
  amount: number;
  description?: string | null;
  notes?: string | null;
  created_at: string;
  reference_type?: string | null;
  safe_id?: string;
  related_safe_id?: string | null;
  transfer_group_id?: string | null;
  safe?: { name?: string } | null;
}

export interface ExpenseRaw {
  entry_id: string;
  entry_number: string;
  date: string;
  description: string;
  notes?: string | null;
  amount: number;
  expense_account_id: string;
  expense_account_code: string;
  expense_account_name: string;
  safe_id: string;
  safe_name: string;
  safe_transaction_id: string;
  created_at: string;
}

export interface InvoiceProfitRow {
  id: string;
  invoice_number: string;
  created_at: string;
  customer_name: string;
  customer_id: string | null;
  payment_method: string;
  type: "sale" | "sale_return";
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  paid_amount: number;
  remaining: number;
  total: number;
  accuracy: CostAccuracy;
}

export interface CustomerProfitRow {
  id: string;
  name: string;
  phone: string;
  invoice_count: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  collected: number;
  remaining: number;
  balance: number;
  accuracy: CostAccuracy;
}

export interface ProductProfitRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  qty_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  stock_qty: number;
  stock_value: number;
  stock_status: "ok" | "low" | "out";
  accuracy: CostAccuracy;
}

export interface DailyTrendPoint {
  date: string;
  label: string;
  net_sales: number;
  profit: number;
}

export interface PaymentSlice {
  method: string;
  label: string;
  amount: number;
}

export interface OverviewSummary {
  net_sales: number;
  gross_profit: number;
  margin: number;
  collected: number;
  remaining: number;
  returns_total: number;
  invoice_count: number;
  return_count: number;
  treasury_deposits: number;
  treasury_withdrawals: number;
  treasury_net: number;
  expenses_total: number;
  expenses_count: number;
  inventory_value: number;
  low_stock_count: number;
  customer_debt: number;
  has_estimated_costs: boolean;
}

export interface ReportsBundle {
  range: DateRange;
  overview: OverviewSummary;
  invoices: InvoiceProfitRow[];
  customers: CustomerProfitRow[];
  products: ProductProfitRow[];
  treasury: TreasuryRaw[];
  expenses: ExpenseRaw[];
  dailyTrend: DailyTrendPoint[];
  paymentMix: PaymentSlice[];
  topCustomers: CustomerProfitRow[];
  topProducts: ProductProfitRow[];
}

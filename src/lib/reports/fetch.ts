import { createClient } from "@/lib/supabase";
import { listExpenses } from "@/lib/expenses";
import { rangeBounds } from "./dates";
import { buildReportsBundle } from "./aggregations";
import type {
  CustomerRaw,
  DateRange,
  ExpenseRaw,
  InvoiceRaw,
  ProductRaw,
  ReportsBundle,
  TreasuryRaw,
} from "./types";

export async function fetchReportsBundle(range: DateRange): Promise<ReportsBundle> {
  const supabase = createClient();
  const { startIso, endIso } = rangeBounds(range);

  const [invoicesRes, productsRes, customersRes, treasuryRes, expensesRes] =
    await Promise.all([
      supabase
        .from("invoices")
        .select(
          "id, invoice_number, type, status, customer_id, subtotal, tax_amount, discount_amount, total, paid_amount, payment_method, created_at, notes, customer:customers(id, name, phone, balance), items:invoice_items(*, product:products(id, name, sku, buy_price, sell_price, quantity, min_quantity, category:categories(name)))"
        )
        .in("type", ["sale", "sale_return"])
        .eq("status", "completed")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false }),
      supabase
        .from("products")
        .select(
          "id, name, sku, quantity, buy_price, sell_price, min_quantity, category:categories(name)"
        )
        .order("name"),
      supabase
        .from("customers")
        .select("id, name, phone, balance, address, notes")
        .order("name"),
      supabase
        .from("safe_transactions")
        .select(
          "id, type, amount, description, created_at, reference_type, safe_id, related_safe_id, transfer_group_id, safe:safes!safe_id(name)"
        )
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: false }),
      listExpenses(supabase, 1000),
    ]);

  if (invoicesRes.error) throw new Error(invoicesRes.error.message);
  if (productsRes.error) throw new Error(productsRes.error.message);
  if (customersRes.error) throw new Error(customersRes.error.message);
  if (treasuryRes.error) throw new Error(treasuryRes.error.message);
  if (expensesRes.error) throw new Error(expensesRes.error);

  const expenses: ExpenseRaw[] = (expensesRes.data || [])
    .filter((e) => e.date >= range.from && e.date <= range.to)
    .map((e) => ({
      entry_id: e.entry_id,
      entry_number: e.entry_number,
      date: e.date,
      description: e.description,
      amount: e.amount,
      expense_account_id: e.expense_account_id,
      expense_account_code: e.expense_account_code,
      expense_account_name: e.expense_account_name,
      safe_id: e.safe_id,
      safe_name: e.safe_name,
      safe_transaction_id: e.safe_transaction_id,
      created_at: e.created_at,
    }));

  return buildReportsBundle({
    range,
    invoices: (invoicesRes.data || []) as unknown as InvoiceRaw[],
    products: (productsRes.data || []) as unknown as ProductRaw[],
    customers: (customersRes.data || []) as unknown as CustomerRaw[],
    treasury: (treasuryRes.data || []) as unknown as TreasuryRaw[],
    expenses,
  });
}

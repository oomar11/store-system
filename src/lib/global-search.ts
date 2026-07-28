import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency, smartSearchMatch } from "@/lib/utils";

export type QuickSearchEntity =
  | "product"
  | "customer"
  | "supplier"
  | "sale"
  | "purchase";

export type QuickSearchResult = {
  id: string;
  type: QuickSearchEntity;
  title: string;
  subtitle: string;
  href: string;
};

export const quickSearchTypeLabels: Record<QuickSearchEntity, string> = {
  product: "صنف",
  customer: "عميل",
  supplier: "مورد",
  sale: "فاتورة بيع",
  purchase: "فاتورة شراء",
};

const PER_TYPE = 5;
const FETCH_LIMIT = 250;

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  sell_price: number;
  quantity: number;
};

type PartyRow = {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  type: "sale" | "purchase";
  total: number;
  created_at: string;
  customer?: { name: string } | null;
  supplier?: { name: string } | null;
};

function encodeQuery(value: string) {
  return encodeURIComponent(value.trim());
}

/** Search products, customers, suppliers, and sale/purchase invoices. */
export async function runQuickSearch(
  supabase: SupabaseClient,
  rawQuery: string
): Promise<QuickSearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 1) return [];

  const [productsRes, customersRes, suppliersRes, invoicesRes] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, name, sku, sell_price, quantity")
        .eq("is_active", true)
        .order("name")
        .limit(FETCH_LIMIT),
      supabase
        .from("customers")
        .select("id, name, phone, balance")
        .eq("is_active", true)
        .order("name")
        .limit(FETCH_LIMIT),
      supabase
        .from("suppliers")
        .select("id, name, phone, balance")
        .eq("is_active", true)
        .order("name")
        .limit(FETCH_LIMIT),
      supabase
        .from("invoices")
        .select(
          "id, invoice_number, type, total, created_at, customer:customers(name), supplier:suppliers(name)"
        )
        .in("type", ["sale", "purchase"])
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
    ]);

  const results: QuickSearchResult[] = [];

  const products = ((productsRes.data || []) as ProductRow[])
    .filter((p) => smartSearchMatch(query, [p.name, p.sku]))
    .slice(0, PER_TYPE)
    .map((p) => ({
      id: p.id,
      type: "product" as const,
      title: p.name,
      subtitle: `${p.sku || "—"} · ${formatCurrency(Number(p.sell_price))} · متاح ${p.quantity}`,
      href: `/products?q=${encodeQuery(p.name)}`,
    }));

  const customers = ((customersRes.data || []) as PartyRow[])
    .filter((c) => smartSearchMatch(query, [c.name, c.phone]))
    .slice(0, PER_TYPE)
    .map((c) => ({
      id: c.id,
      type: "customer" as const,
      title: c.name,
      subtitle: c.phone
        ? `${c.phone} · رصيد ${formatCurrency(Number(c.balance))}`
        : `رصيد ${formatCurrency(Number(c.balance))}`,
      href: `/customers?q=${encodeQuery(c.name)}`,
    }));

  const suppliers = ((suppliersRes.data || []) as PartyRow[])
    .filter((s) => smartSearchMatch(query, [s.name, s.phone]))
    .slice(0, PER_TYPE)
    .map((s) => ({
      id: s.id,
      type: "supplier" as const,
      title: s.name,
      subtitle: s.phone
        ? `${s.phone} · رصيد ${formatCurrency(Number(s.balance))}`
        : `رصيد ${formatCurrency(Number(s.balance))}`,
      href: `/suppliers?q=${encodeQuery(s.name)}`,
    }));

  const invoices = (invoicesRes.data || []) as unknown as InvoiceRow[];
  const sales = invoices
    .filter(
      (inv) =>
        inv.type === "sale" &&
        smartSearchMatch(query, [inv.invoice_number, inv.customer?.name])
    )
    .slice(0, PER_TYPE)
    .map((inv) => ({
      id: inv.id,
      type: "sale" as const,
      title: inv.invoice_number,
      subtitle: `${inv.customer?.name || "عميل نقدي"} · ${formatCurrency(Number(inv.total))}`,
      href: `/sales?q=${encodeQuery(inv.invoice_number)}`,
    }));

  const purchases = invoices
    .filter(
      (inv) =>
        inv.type === "purchase" &&
        smartSearchMatch(query, [inv.invoice_number, inv.supplier?.name])
    )
    .slice(0, PER_TYPE)
    .map((inv) => ({
      id: inv.id,
      type: "purchase" as const,
      title: inv.invoice_number,
      subtitle: `${inv.supplier?.name || "مورد"} · ${formatCurrency(Number(inv.total))}`,
      href: `/purchases?q=${encodeQuery(inv.invoice_number)}`,
    }));

  results.push(...products, ...customers, ...suppliers, ...sales, ...purchases);
  return results;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase-service";
import { listExpenses } from "@/lib/expenses";
import { fetchLowStockAlerts } from "@/lib/low-stock";
import { runQuickSearch } from "@/lib/global-search";
import { fetchOpenShift } from "@/lib/shifts";
import { smartSearchMatch } from "@/lib/utils";
import { rangeFromPreset, rangeBounds, formatRangeLabel } from "@/lib/reports/dates";
import { buildReportsBundle } from "@/lib/reports/aggregations";
import type {
  CustomerRaw,
  DatePreset,
  DateRange,
  ExpenseRaw,
  InvoiceRaw,
  ProductRaw,
  TreasuryRaw,
} from "@/lib/reports/types";

type ToolArgs = Record<string, unknown>;

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function asInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}

function resolveRange(args: ToolArgs): DateRange {
  const period = asString(args.period, "today").toLowerCase();
  const from = asString(args.from);
  const to = asString(args.to);
  if (period === "custom" || (from && to)) {
    return rangeFromPreset("custom", {
      from: from || to,
      to: to || from,
    });
  }
  const preset: DatePreset =
    period === "7days" || period === "week"
      ? "7days"
      : period === "month"
        ? "month"
        : "today";
  return rangeFromPreset(preset);
}

async function loadReportsBundle(supabase: SupabaseClient, range: DateRange) {
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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function executeBusinessTool(
  name: string,
  rawArgs: unknown
): Promise<object> {
  const args = (rawArgs && typeof rawArgs === "object"
    ? rawArgs
    : {}) as ToolArgs;
  const supabase = await createServiceClient();

  try {
    switch (name) {
      case "get_business_overview":
        return await toolBusinessOverview(supabase, args);
      case "get_sales_report":
        return await toolSalesReport(supabase, args);
      case "search_products":
        return await toolSearchProducts(supabase, args);
      case "get_stock":
        return await toolGetStock(supabase, args);
      case "get_low_stock":
        return await toolLowStock(supabase, args);
      case "search_parties":
        return await toolSearchParties(supabase, args);
      case "get_party_detail":
        return await toolPartyDetail(supabase, args);
      case "search_invoices":
        return await toolSearchInvoices(supabase, args);
      case "get_treasury":
        return await toolTreasury(supabase, args);
      case "get_expenses":
        return await toolExpenses(supabase, args);
      case "get_shifts":
        return await toolShifts(supabase, args);
      case "global_search":
        return await toolGlobalSearch(supabase, args);
      default:
        return { error: `أداة غير معروفة: ${name}` };
    }
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "فشل تنفيذ الأداة",
    };
  }
}

async function toolBusinessOverview(supabase: SupabaseClient, args: ToolArgs) {
  const range = resolveRange(args);
  const bundle = await loadReportsBundle(supabase, range);
  const o = bundle.overview;
  return {
    period: formatRangeLabel(range),
    overview: {
      net_sales: round2(o.net_sales),
      gross_profit: round2(o.gross_profit),
      margin_pct: round2(o.margin),
      collected: round2(o.collected),
      remaining: round2(o.remaining),
      returns_total: round2(o.returns_total),
      invoice_count: o.invoice_count,
      return_count: o.return_count,
      expenses_total: round2(o.expenses_total),
      expenses_count: o.expenses_count,
      treasury_net: round2(o.treasury_net),
      inventory_value: round2(o.inventory_value),
      low_stock_count: o.low_stock_count,
      customer_debt: round2(o.customer_debt),
      has_estimated_costs: o.has_estimated_costs,
    },
    top_products: bundle.topProducts.slice(0, 5).map((p) => ({
      name: p.name,
      qty_sold: round2(p.qty_sold),
      revenue: round2(p.revenue),
      profit: round2(p.profit),
    })),
    top_customers: bundle.topCustomers.slice(0, 5).map((c) => ({
      name: c.name,
      revenue: round2(c.revenue),
      profit: round2(c.profit),
      balance: round2(c.balance),
    })),
  };
}

async function toolSalesReport(supabase: SupabaseClient, args: ToolArgs) {
  const range = resolveRange(args);
  const limit = asInt(args.limit, 15);
  const bundle = await loadReportsBundle(supabase, range);
  return {
    period: formatRangeLabel(range),
    summary: {
      net_sales: round2(bundle.overview.net_sales),
      gross_profit: round2(bundle.overview.gross_profit),
      margin_pct: round2(bundle.overview.margin),
      collected: round2(bundle.overview.collected),
      remaining: round2(bundle.overview.remaining),
      returns_total: round2(bundle.overview.returns_total),
      invoice_count: bundle.overview.invoice_count,
      return_count: bundle.overview.return_count,
    },
    payment_mix: bundle.paymentMix.map((p) => ({
      label: p.label,
      amount: round2(p.amount),
    })),
    top_products: bundle.topProducts.slice(0, 8).map((p) => ({
      name: p.name,
      sku: p.sku,
      qty_sold: round2(p.qty_sold),
      revenue: round2(p.revenue),
      profit: round2(p.profit),
    })),
    top_customers: bundle.topCustomers.slice(0, 8).map((c) => ({
      name: c.name,
      revenue: round2(c.revenue),
      remaining: round2(c.remaining),
      balance: round2(c.balance),
    })),
    invoices: bundle.invoices.slice(0, limit).map((inv) => ({
      number: inv.invoice_number,
      type: inv.type,
      customer: inv.customer_name,
      total: round2(inv.total),
      paid: round2(inv.paid_amount),
      profit: round2(inv.profit),
      at: inv.created_at,
    })),
  };
}

async function toolSearchProducts(supabase: SupabaseClient, args: ToolArgs) {
  const query = asString(args.query);
  if (!query) return { error: "query مطلوب" };
  const limit = asInt(args.limit, 15);

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, sku, quantity, buy_price, sell_price, min_quantity, unit, is_active, category:categories(name)"
    )
    .eq("is_active", true)
    .order("name")
    .limit(400);

  if (error) throw new Error(error.message);

  const matched = (data || [])
    .filter((p) => smartSearchMatch(query, [p.name, p.sku]))
    .slice(0, limit)
    .map((p) => ({
      name: p.name,
      sku: p.sku,
      quantity: Number(p.quantity),
      min_quantity: Number(p.min_quantity),
      sell_price: Number(p.sell_price),
      buy_price: Number(p.buy_price),
      unit: p.unit,
      category: (p.category as { name?: string } | null)?.name || null,
    }));

  return { query, count: matched.length, products: matched };
}

async function toolGetStock(supabase: SupabaseClient, args: ToolArgs) {
  const query = asString(args.query);
  const filter = asString(args.filter, "all").toLowerCase();
  const limit = asInt(args.limit, 20);

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, sku, quantity, min_quantity, sell_price, buy_price, unit, is_active"
    )
    .eq("is_active", true)
    .order("quantity", { ascending: true })
    .limit(800);

  if (error) throw new Error(error.message);

  let rows = data || [];
  if (query) {
    rows = rows.filter((p) => smartSearchMatch(query, [p.name, p.sku]));
  }

  const summary = {
    total_skus: rows.length,
    out_of_stock: rows.filter((p) => Number(p.quantity) <= 0).length,
    low_stock: rows.filter(
      (p) =>
        Number(p.quantity) > 0 &&
        Number(p.quantity) <= Number(p.min_quantity)
    ).length,
    inventory_cost_value: round2(
      rows.reduce(
        (s, p) => s + Number(p.quantity) * Number(p.buy_price),
        0
      )
    ),
  };

  let listed = rows;
  if (filter === "out") {
    listed = rows.filter((p) => Number(p.quantity) <= 0);
  } else if (filter === "low") {
    listed = rows.filter(
      (p) =>
        Number(p.quantity) > 0 &&
        Number(p.quantity) <= Number(p.min_quantity)
    );
  }

  return {
    filter,
    query: query || null,
    summary,
    products: listed.slice(0, limit).map((p) => ({
      name: p.name,
      sku: p.sku,
      quantity: Number(p.quantity),
      min_quantity: Number(p.min_quantity),
      sell_price: Number(p.sell_price),
      unit: p.unit,
    })),
  };
}

async function toolLowStock(supabase: SupabaseClient, args: ToolArgs) {
  const limit = asInt(args.limit, 30);
  const items = await fetchLowStockAlerts(supabase);
  return {
    count: items.length,
    products: items.slice(0, limit).map((p) => ({
      name: p.name,
      sku: p.sku,
      quantity: p.quantity,
      min_quantity: p.min_quantity,
      unit: p.unit,
    })),
  };
}

async function toolSearchParties(supabase: SupabaseClient, args: ToolArgs) {
  const query = asString(args.query);
  if (!query) return { error: "query مطلوب" };
  const type = asString(args.type, "all").toLowerCase();
  const limit = asInt(args.limit, 10);

  const result: {
    customers?: object[];
    suppliers?: object[];
  } = {};

  if (type === "all" || type === "customer") {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone, balance, is_active")
      .eq("is_active", true)
      .order("name")
      .limit(400);
    if (error) throw new Error(error.message);
    result.customers = (data || [])
      .filter((c) => smartSearchMatch(query, [c.name, c.phone]))
      .slice(0, limit)
      .map((c) => ({
        name: c.name,
        phone: c.phone,
        balance: Number(c.balance),
      }));
  }

  if (type === "all" || type === "supplier") {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, phone, balance, is_active")
      .eq("is_active", true)
      .order("name")
      .limit(400);
    if (error) throw new Error(error.message);
    result.suppliers = (data || [])
      .filter((s) => smartSearchMatch(query, [s.name, s.phone]))
      .slice(0, limit)
      .map((s) => ({
        name: s.name,
        phone: s.phone,
        balance: Number(s.balance),
      }));
  }

  return { query, ...result };
}

async function toolPartyDetail(supabase: SupabaseClient, args: ToolArgs) {
  const name = asString(args.name);
  if (!name) return { error: "name مطلوب" };
  const type = asString(args.type, "auto").toLowerCase();

  type PartyHit = {
    kind: "customer" | "supplier";
    id: string;
    name: string;
    phone: string | null;
    balance: number;
    address?: string | null;
    notes?: string | null;
  };

  const hits: PartyHit[] = [];

  if (type === "auto" || type === "customer") {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, phone, balance, address, notes, is_active")
      .eq("is_active", true)
      .order("name")
      .limit(400);
    if (error) throw new Error(error.message);
    for (const c of data || []) {
      if (smartSearchMatch(name, [c.name, c.phone])) {
        hits.push({
          kind: "customer",
          id: c.id,
          name: c.name,
          phone: c.phone,
          balance: Number(c.balance),
          address: c.address,
          notes: c.notes,
        });
      }
    }
  }

  if (type === "auto" || type === "supplier") {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, phone, balance, address, notes, is_active")
      .eq("is_active", true)
      .order("name")
      .limit(400);
    if (error) throw new Error(error.message);
    for (const s of data || []) {
      if (smartSearchMatch(name, [s.name, s.phone])) {
        hits.push({
          kind: "supplier",
          id: s.id,
          name: s.name,
          phone: s.phone,
          balance: Number(s.balance),
          address: s.address,
          notes: s.notes,
        });
      }
    }
  }

  if (hits.length === 0) {
    return { found: false, message: "لا يوجد طرف مطابق" };
  }

  const party = hits[0];
  const invoiceTypes =
    party.kind === "customer"
      ? ["sale", "sale_return"]
      : ["purchase", "purchase_return"];

  let invQuery = supabase
    .from("invoices")
    .select(
      "invoice_number, type, total, paid_amount, status, created_at, payment_method"
    )
    .in("type", invoiceTypes)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(10);

  if (party.kind === "customer") {
    invQuery = invQuery.eq("customer_id", party.id);
  } else {
    invQuery = invQuery.eq("supplier_id", party.id);
  }

  const { data: invoices, error: invErr } = await invQuery;
  if (invErr) throw new Error(invErr.message);

  return {
    found: true,
    matches: hits.length,
    party: {
      kind: party.kind,
      name: party.name,
      phone: party.phone,
      balance: party.balance,
      address: party.address,
      notes: party.notes,
    },
    recent_invoices: (invoices || []).map((inv) => ({
      number: inv.invoice_number,
      type: inv.type,
      total: Number(inv.total),
      paid: Number(inv.paid_amount),
      payment_method: inv.payment_method,
      at: inv.created_at,
    })),
    other_matches:
      hits.length > 1
        ? hits.slice(1, 5).map((h) => ({
            kind: h.kind,
            name: h.name,
            balance: h.balance,
          }))
        : [],
  };
}

async function toolSearchInvoices(supabase: SupabaseClient, args: ToolArgs) {
  const query = asString(args.query);
  const invoiceType = asString(args.invoice_type, "all").toLowerCase();
  const limit = asInt(args.limit, 15);
  const hasPeriod =
    Boolean(asString(args.period)) ||
    (Boolean(asString(args.from)) && Boolean(asString(args.to)));
  const range = hasPeriod ? resolveRange(args) : null;
  const bounds = range ? rangeBounds(range) : null;

  const types =
    invoiceType === "all"
      ? ["sale", "purchase", "sale_return", "purchase_return"]
      : [invoiceType];

  let q = supabase
    .from("invoices")
    .select(
      "id, invoice_number, type, status, total, paid_amount, payment_method, created_at, customer:customers(name), supplier:suppliers(name)"
    )
    .in("type", types)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(250);

  if (bounds) {
    q = q.gte("created_at", bounds.startIso).lte("created_at", bounds.endIso);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  type InvRow = {
    invoice_number: string;
    type: string;
    total: number;
    paid_amount: number;
    payment_method: string;
    created_at: string;
    customer?: { name?: string } | null;
    supplier?: { name?: string } | null;
  };

  let rows = (data || []) as unknown as InvRow[];
  if (query) {
    rows = rows.filter((inv) =>
      smartSearchMatch(query, [
        inv.invoice_number,
        inv.customer?.name,
        inv.supplier?.name,
      ])
    );
  }

  return {
    query: query || null,
    period: range ? formatRangeLabel(range) : null,
    count: rows.length,
    invoices: rows.slice(0, limit).map((inv) => ({
      number: inv.invoice_number,
      type: inv.type,
      party: inv.customer?.name || inv.supplier?.name || null,
      total: Number(inv.total),
      paid: Number(inv.paid_amount),
      payment_method: inv.payment_method,
      at: inv.created_at,
    })),
  };
}

async function toolTreasury(supabase: SupabaseClient, args: ToolArgs) {
  const range = resolveRange(args);
  const limit = asInt(args.limit, 20);
  const { startIso, endIso } = rangeBounds(range);

  const [safesRes, txRes] = await Promise.all([
    supabase
      .from("safes")
      .select("id, name, balance, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("safe_transactions")
      .select(
        "id, type, amount, description, created_at, reference_type, safe:safes!safe_id(name)"
      )
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (safesRes.error) throw new Error(safesRes.error.message);
  if (txRes.error) throw new Error(txRes.error.message);

  const txs = txRes.data || [];
  const deposits = txs
    .filter((t) => t.type === "deposit")
    .reduce((s, t) => s + Number(t.amount), 0);
  const withdrawals = txs
    .filter((t) => t.type === "withdrawal")
    .reduce((s, t) => s + Number(t.amount), 0);

  return {
    period: formatRangeLabel(range),
    safes: (safesRes.data || []).map((s) => ({
      name: s.name,
      balance: Number(s.balance),
    })),
    period_totals: {
      deposits: round2(deposits),
      withdrawals: round2(withdrawals),
      net: round2(deposits - withdrawals),
      movement_count: txs.length,
    },
    recent_movements: txs.slice(0, limit).map((t) => ({
      type: t.type,
      amount: Number(t.amount),
      description: t.description,
      safe: (t.safe as { name?: string } | null)?.name || null,
      reference_type: t.reference_type,
      at: t.created_at,
    })),
  };
}

async function toolExpenses(supabase: SupabaseClient, args: ToolArgs) {
  const range = resolveRange(args);
  const limit = asInt(args.limit, 20);
  const { data, error } = await listExpenses(supabase, 1000);
  if (error) throw new Error(error);

  const filtered = data.filter(
    (e) => e.date >= range.from && e.date <= range.to
  );
  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);

  return {
    period: formatRangeLabel(range),
    total: round2(total),
    count: filtered.length,
    expenses: filtered.slice(0, limit).map((e) => ({
      number: e.entry_number,
      date: e.date,
      description: e.description,
      amount: Number(e.amount),
      account: e.expense_account_name,
      safe: e.safe_name,
    })),
  };
}

async function toolShifts(supabase: SupabaseClient, args: ToolArgs) {
  const includeRecent = asInt(args.include_recent, 3);
  const open = await fetchOpenShift(supabase);

  const { data: recent, error } = await supabase
    .from("shifts")
    .select(
      "id, status, opened_at, closed_at, opening_cash, expected_cash, counted_cash, variance, sales_total, purchases_total, cash_in, cash_out, notes, close_reason, safe:safes!shifts_safe_id_fkey(name)"
    )
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(includeRecent);

  if (error) {
    // Fallback without join if FK hint fails
    const plain = await supabase
      .from("shifts")
      .select(
        "id, status, opened_at, closed_at, opening_cash, expected_cash, counted_cash, variance, sales_total, purchases_total, cash_in, cash_out, notes, close_reason, safe_id"
      )
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(includeRecent);
    if (plain.error) throw new Error(plain.error.message);

    return {
      open_shift: open
        ? {
            status: open.status,
            safe: open.safe?.name || null,
            opened_at: open.opened_at,
            opening_cash: Number(open.opening_cash),
            sales_total: open.sales_total != null ? Number(open.sales_total) : null,
          }
        : null,
      recent_closed: (plain.data || []).map((s) => ({
        opened_at: s.opened_at,
        closed_at: s.closed_at,
        opening_cash: Number(s.opening_cash),
        counted_cash: s.counted_cash != null ? Number(s.counted_cash) : null,
        variance: s.variance != null ? Number(s.variance) : null,
        sales_total: s.sales_total != null ? Number(s.sales_total) : null,
        close_reason: s.close_reason,
      })),
    };
  }

  return {
    open_shift: open
      ? {
          status: open.status,
          safe: open.safe?.name || null,
          opened_at: open.opened_at,
          opening_cash: Number(open.opening_cash),
          expected_cash:
            open.expected_cash != null ? Number(open.expected_cash) : null,
          sales_total: open.sales_total != null ? Number(open.sales_total) : null,
          cash_in: open.cash_in != null ? Number(open.cash_in) : null,
          cash_out: open.cash_out != null ? Number(open.cash_out) : null,
        }
      : null,
    recent_closed: (recent || []).map((s) => ({
      safe: (s.safe as { name?: string } | null)?.name || null,
      opened_at: s.opened_at,
      closed_at: s.closed_at,
      opening_cash: Number(s.opening_cash),
      counted_cash: s.counted_cash != null ? Number(s.counted_cash) : null,
      variance: s.variance != null ? Number(s.variance) : null,
      sales_total: s.sales_total != null ? Number(s.sales_total) : null,
      close_reason: s.close_reason,
    })),
  };
}

async function toolGlobalSearch(supabase: SupabaseClient, args: ToolArgs) {
  const query = asString(args.query);
  if (!query) return { error: "query مطلوب" };
  const results = await runQuickSearch(supabase, query);
  return {
    query,
    count: results.length,
    results: results.map((r) => ({
      type: r.type,
      title: r.title,
      subtitle: r.subtitle,
    })),
  };
}

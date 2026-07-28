import { resolveUnitCost } from "@/lib/invoice-cost";
import { eachDayInRange } from "./dates";
import type {
  CostAccuracy,
  CustomerProfitRow,
  CustomerRaw,
  DailyTrendPoint,
  DateRange,
  InvoiceProfitRow,
  InvoiceRaw,
  OverviewSummary,
  PaymentSlice,
  ProductProfitRow,
  ExpenseRaw,
  ProductRaw,
  ReportsBundle,
  TreasuryRaw,
} from "./types";

function paymentLabel(method: string): string {
  if (method === "cash") return "نقدي";
  if (method === "credit") return "آجل";
  if (method === "bank_transfer") return "تحويل بنكي";
  return method || "أخرى";
}

function mergeAccuracy(a: CostAccuracy, b: CostAccuracy): CostAccuracy {
  if (a === b) return a;
  if (a === "reliable" && b === "reliable") return "reliable";
  if (a === "estimated" && b === "estimated") return "estimated";
  return "mixed";
}

function marginPct(profit: number, revenue: number): number {
  if (!revenue) return 0;
  return (profit / revenue) * 100;
}

function stockStatus(qty: number, minQty: number): "ok" | "low" | "out" {
  if (qty <= 0) return "out";
  if (qty < minQty) return "low";
  return "ok";
}

function lineRevenue(item: { total: number }): number {
  return Number(item.total) || 0;
}

function analyzeInvoice(inv: InvoiceRaw): InvoiceProfitRow {
  const items = inv.items || [];
  let cost = 0;
  let estimated = 0;
  let reliable = 0;

  for (const item of items) {
    const resolved = resolveUnitCost(item.unit_cost, item.product?.buy_price);
    cost += Number(item.quantity) * resolved.cost;
    if (resolved.isEstimated) estimated += 1;
    else reliable += 1;
  }

  const revenue =
    inv.subtotal != null
      ? Number(inv.subtotal)
      : Number(inv.total) - Number(inv.tax_amount || 0);

  const profit = revenue - cost;
  let accuracy: CostAccuracy = "reliable";
  if (items.length === 0) accuracy = "estimated";
  else if (estimated > 0 && reliable > 0) accuracy = "mixed";
  else if (estimated > 0) accuracy = "estimated";

  const sign = inv.type === "sale_return" ? -1 : 1;

  return {
    id: inv.id,
    invoice_number: inv.invoice_number,
    created_at: inv.created_at,
    customer_name: inv.customer?.name || "نقدي",
    customer_id: inv.customer_id || inv.customer?.id || null,
    payment_method: inv.payment_method,
    type: inv.type as "sale" | "sale_return",
    revenue: sign * revenue,
    cost: sign * cost,
    profit: sign * profit,
    margin: marginPct(profit, revenue),
    paid_amount: sign * Number(inv.paid_amount || 0),
    remaining: sign * (Number(inv.total) - Number(inv.paid_amount || 0)),
    total: sign * Number(inv.total),
    accuracy,
  };
}

export function buildReportsBundle(input: {
  range: DateRange;
  invoices: InvoiceRaw[];
  products: ProductRaw[];
  customers: CustomerRaw[];
  treasury: TreasuryRaw[];
  expenses: ExpenseRaw[];
}): ReportsBundle {
  const saleLike = input.invoices.filter(
    (i) =>
      (i.type === "sale" || i.type === "sale_return") && i.status === "completed"
  );

  const invoiceRows = saleLike.map(analyzeInvoice);
  const salesRows = invoiceRows.filter((r) => r.type === "sale");
  const returnRows = invoiceRows.filter((r) => r.type === "sale_return");

  const netSales = invoiceRows.reduce((s, r) => s + r.revenue, 0);
  const grossProfit = invoiceRows.reduce((s, r) => s + r.profit, 0);
  const collected = salesRows.reduce((s, r) => s + Math.max(0, r.paid_amount), 0);
  const remaining = salesRows.reduce((s, r) => s + Math.max(0, r.remaining), 0);
  const returnsTotal = returnRows.reduce((s, r) => s + Math.abs(r.total), 0);
  const hasEstimated = invoiceRows.some(
    (r) => r.accuracy === "estimated" || r.accuracy === "mixed"
  );

  const deposits = input.treasury
    .filter((t) => t.type === "deposit")
    .reduce((s, t) => s + Number(t.amount), 0);
  const withdrawals = input.treasury
    .filter((t) => t.type === "withdrawal")
    .reduce((s, t) => s + Number(t.amount), 0);

  const inventoryValue = input.products.reduce(
    (s, p) => s + Number(p.quantity) * Number(p.buy_price),
    0
  );
  const lowStockCount = input.products.filter(
    (p) => Number(p.quantity) > 0 && Number(p.quantity) < Number(p.min_quantity)
  ).length;
  const customerDebt = input.customers.reduce(
    (s, c) => s + (Number(c.balance) > 0 ? Number(c.balance) : 0),
    0
  );

  const expensesTotal = input.expenses.reduce(
    (s, e) => s + Number(e.amount),
    0
  );

  const overview: OverviewSummary = {
    net_sales: netSales,
    gross_profit: grossProfit,
    margin: marginPct(grossProfit, netSales),
    collected,
    remaining,
    returns_total: returnsTotal,
    invoice_count: salesRows.length,
    return_count: returnRows.length,
    treasury_deposits: deposits,
    treasury_withdrawals: withdrawals,
    treasury_net: deposits - withdrawals,
    expenses_total: expensesTotal,
    expenses_count: input.expenses.length,
    inventory_value: inventoryValue,
    low_stock_count: lowStockCount,
    customer_debt: customerDebt,
    has_estimated_costs: hasEstimated,
  };

  const customerMap = new Map<string, CustomerProfitRow>();
  const cashKey = "__cash__";

  for (const row of invoiceRows) {
    const key = row.customer_id || cashKey;
    const existing = customerMap.get(key);
    const base: CustomerProfitRow = existing || {
      id: key,
      name: row.customer_name,
      phone: "",
      invoice_count: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      margin: 0,
      collected: 0,
      remaining: 0,
      balance: 0,
      accuracy: row.accuracy,
    };

    if (row.type === "sale") base.invoice_count += 1;
    base.revenue += row.revenue;
    base.cost += row.cost;
    base.profit += row.profit;
    if (row.type === "sale") {
      base.collected += Math.max(0, row.paid_amount);
      base.remaining += Math.max(0, row.remaining);
    }
    base.accuracy = mergeAccuracy(base.accuracy, row.accuracy);
    customerMap.set(key, base);
  }

  for (const c of input.customers) {
    const row = customerMap.get(c.id);
    if (row) {
      row.name = c.name;
      row.phone = c.phone || "";
      row.balance = Number(c.balance) || 0;
    } else if (Number(c.balance) !== 0) {
      customerMap.set(c.id, {
        id: c.id,
        name: c.name,
        phone: c.phone || "",
        invoice_count: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: 0,
        collected: 0,
        remaining: 0,
        balance: Number(c.balance) || 0,
        accuracy: "reliable",
      });
    }
  }

  const customers = Array.from(customerMap.values())
    .map((c) => ({ ...c, margin: marginPct(c.profit, c.revenue) }))
    .sort((a, b) => b.profit - a.profit);

  const productMap = new Map<string, ProductProfitRow>();

  for (const inv of saleLike) {
    const sign = inv.type === "sale_return" ? -1 : 1;
    for (const item of inv.items || []) {
      const pid = item.product_id;
      const resolved = resolveUnitCost(item.unit_cost, item.product?.buy_price);
      const rev = sign * lineRevenue(item);
      const cst = sign * Number(item.quantity) * resolved.cost;
      const existing = productMap.get(pid);
      const base: ProductProfitRow = existing || {
        id: pid,
        name: item.product?.name || "صنف",
        sku: item.product?.sku || "",
        category: item.product?.category?.name || "—",
        qty_sold: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: 0,
        stock_qty: Number(item.product?.quantity) || 0,
        stock_value: 0,
        stock_status: "ok",
        accuracy: resolved.isEstimated ? "estimated" : "reliable",
      };
      base.qty_sold += sign * Number(item.quantity);
      base.revenue += rev;
      base.cost += cst;
      base.profit += rev - cst;
      base.accuracy = mergeAccuracy(
        base.accuracy,
        resolved.isEstimated ? "estimated" : "reliable"
      );
      productMap.set(pid, base);
    }
  }

  for (const p of input.products) {
    const row = productMap.get(p.id);
    const stockVal = Number(p.quantity) * Number(p.buy_price);
    const status = stockStatus(Number(p.quantity), Number(p.min_quantity));
    if (row) {
      row.name = p.name;
      row.sku = p.sku;
      row.category = p.category?.name || "—";
      row.stock_qty = Number(p.quantity);
      row.stock_value = stockVal;
      row.stock_status = status;
      row.margin = marginPct(row.profit, row.revenue);
    } else {
      productMap.set(p.id, {
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category?.name || "—",
        qty_sold: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: 0,
        stock_qty: Number(p.quantity),
        stock_value: stockVal,
        stock_status: status,
        accuracy: "reliable",
      });
    }
  }

  const products = Array.from(productMap.values())
    .map((p) => ({ ...p, margin: marginPct(p.profit, p.revenue) }))
    .sort((a, b) => b.profit - a.profit);

  const dayMap = new Map<string, { net_sales: number; profit: number }>();
  for (const day of eachDayInRange(input.range)) {
    dayMap.set(day, { net_sales: 0, profit: 0 });
  }
  for (const row of invoiceRows) {
    const day = row.created_at.split("T")[0];
    const bucket = dayMap.get(day);
    if (!bucket) continue;
    bucket.net_sales += row.revenue;
    bucket.profit += row.profit;
  }

  const dailyTrend: DailyTrendPoint[] = Array.from(dayMap.entries()).map(
    ([date, vals]) => ({
      date,
      label: new Intl.DateTimeFormat("ar-EG", {
        month: "short",
        day: "numeric",
      }).format(new Date(date + "T00:00:00")),
      net_sales: vals.net_sales,
      profit: vals.profit,
    })
  );

  const payMap = new Map<string, number>();
  for (const row of salesRows) {
    const key = row.payment_method || "other";
    payMap.set(key, (payMap.get(key) || 0) + Math.abs(row.total));
  }
  const paymentMix: PaymentSlice[] = Array.from(payMap.entries()).map(
    ([method, amount]) => ({
      method,
      label: paymentLabel(method),
      amount,
    })
  );

  return {
    range: input.range,
    overview,
    invoices: invoiceRows.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    customers,
    products,
    treasury: input.treasury,
    expenses: input.expenses,
    dailyTrend,
    paymentMix,
    topCustomers: customers.filter((c) => c.revenue > 0).slice(0, 8),
    topProducts: products.filter((p) => p.qty_sold > 0).slice(0, 8),
  };
}

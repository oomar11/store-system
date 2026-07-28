import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

function loadEnv(path) {
  const raw = readFileSync(path, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i)] = v;
  }
  return env;
}

const env = loadEnv(".env.local");
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function all(table, select = "*") {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function txDelta(t) {
  const amt = Number(t.amount) || 0;
  if (t.type === "deposit") return amt;
  if (t.type === "withdrawal") return -amt;
  if (t.type === "transfer") {
    if (t.reference_type === "transfer_in") return amt;
    if (t.reference_type === "transfer_out") return -amt;
  }
  return 0;
}

const issues = [];
const safes = await all("safes");
const txs = await all("safe_transactions");
for (const s of safes) {
  const sum = txs.filter((t) => t.safe_id === s.id).reduce((a, t) => a + txDelta(t), 0);
  const bal = Number(s.balance) || 0;
  if (Math.abs(bal - sum) > 0.02) {
    issues.push({
      kind: "safe_mismatch",
      name: s.name,
      balance: bal,
      txSum: +sum.toFixed(4),
      diff: +(bal - sum).toFixed(4),
    });
  }
}

const invoices = await all("invoices");
const badPaid = invoices.filter(
  (i) =>
    Number(i.paid_amount) < -0.001 ||
    Number(i.paid_amount) > Number(i.total) + 0.001
);
if (badPaid.length) {
  issues.push({ kind: "paid_out_of_range", count: badPaid.length });
}

const items = await all("invoice_items", "invoice_id");
const itemSet = new Set(items.map((i) => i.invoice_id));
const emptyInv = invoices.filter(
  (i) => i.status === "completed" && !itemSet.has(i.id)
);
if (emptyInv.length) {
  issues.push({ kind: "empty_completed_invoices", count: emptyInv.length });
}

console.log(JSON.stringify({ issues, invoiceCount: invoices.length }, null, 2));

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mergeBusinessLines,
  normalizeBusinessLines,
  type BusinessLine,
} from "@/lib/business-lines";

/**
 * Derive business lines from maps, ledger, and store activity for one customer.
 */
export async function deriveCustomerBusinessLines(
  client: SupabaseClient,
  customerId: string
): Promise<BusinessLine[]> {
  const id = String(customerId || "").trim();
  if (!id) return [];

  const [mapRes, ledgerRes, invRes, payRes, custRes] = await Promise.all([
    client
      .from("workshop_party_map")
      .select("source_system")
      .eq("party_type", "customer")
      .eq("store_party_id", id),
    client
      .from("cross_app_ledger_entries")
      .select("source_system")
      .eq("party_type", "customer")
      .eq("party_id", id)
      .limit(50),
    client
      .from("invoices")
      .select("id")
      .eq("customer_id", id)
      .eq("status", "completed")
      .in("type", ["sale", "sale_return"])
      .limit(1),
    client
      .from("party_payments")
      .select("id")
      .eq("party_type", "customer")
      .eq("party_id", id)
      .limit(1),
    client
      .from("customers")
      .select("balance, opening_balance")
      .eq("id", id)
      .maybeSingle(),
  ]);

  const lines: BusinessLine[] = [];
  const systems = new Set<string>();
  for (const row of mapRes.data || []) {
    systems.add(String(row.source_system || "").toLowerCase());
  }
  for (const row of ledgerRes.data || []) {
    systems.add(String(row.source_system || "").toLowerCase());
  }
  if (systems.has("plisse")) lines.push("wire");
  if (systems.has("aa")) lines.push("workshop");

  const hasStoreActivity =
    (invRes.data && invRes.data.length > 0) ||
    (payRes.data && payRes.data.length > 0) ||
    Math.abs(Number(custRes.data?.balance) || 0) > 0.0005 ||
    Math.abs(Number(custRes.data?.opening_balance) || 0) > 0.0005;
  if (hasStoreActivity) lines.push("store");

  return normalizeBusinessLines(lines);
}

/**
 * Refresh effective business_lines for a customer.
 * Respects business_lines_locked; always merges manual tags when unlocked.
 */
export async function refreshCustomerBusinessLines(
  client: SupabaseClient,
  customerId: string,
  options?: { forceDerivedLine?: BusinessLine | null }
): Promise<BusinessLine[]> {
  const id = String(customerId || "").trim();
  if (!id) return [];

  const { data: row, error } = await client
    .from("customers")
    .select("business_lines, business_lines_manual, business_lines_locked")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message || "تعذر قراءة تصنيف العميل");
  if (!row) return [];

  if (row.business_lines_locked) {
    return normalizeBusinessLines(row.business_lines);
  }

  const derived = await deriveCustomerBusinessLines(client, id);
  if (options?.forceDerivedLine) {
    derived.push(options.forceDerivedLine);
  }
  const manual = normalizeBusinessLines(row.business_lines_manual);
  const next = mergeBusinessLines(derived, manual);

  const prev = normalizeBusinessLines(row.business_lines);
  const same =
    prev.length === next.length && prev.every((v, i) => v === next[i]);
  if (!same) {
    const { error: upErr } = await client
      .from("customers")
      .update({ business_lines: next })
      .eq("id", id);
    if (upErr) throw new Error(upErr.message || "تعذر تحديث تصنيف العميل");
  }
  return next;
}

/**
 * Save user-chosen classification (locks auto overwrite).
 */
export async function saveCustomerBusinessLinesManual(
  client: SupabaseClient,
  customerId: string,
  lines: BusinessLine[],
  options?: { locked?: boolean }
): Promise<BusinessLine[]> {
  const id = String(customerId || "").trim();
  if (!id) throw new Error("معرّف العميل مطلوب");
  const manual = normalizeBusinessLines(lines);
  const locked = options?.locked !== false;
  const { error } = await client
    .from("customers")
    .update({
      business_lines_manual: manual,
      business_lines: manual,
      business_lines_locked: locked,
    })
    .eq("id", id);
  if (error) throw new Error(error.message || "تعذر حفظ التصنيف");
  return manual;
}

/**
 * Unlock and re-derive from activity + keep manual tags merged.
 */
export async function unlockAndRefreshCustomerBusinessLines(
  client: SupabaseClient,
  customerId: string
): Promise<BusinessLine[]> {
  const id = String(customerId || "").trim();
  if (!id) return [];
  const { error } = await client
    .from("customers")
    .update({ business_lines_locked: false })
    .eq("id", id);
  if (error) throw new Error(error.message || "تعذر فتح التصنيف التلقائي");
  return refreshCustomerBusinessLines(client, id);
}

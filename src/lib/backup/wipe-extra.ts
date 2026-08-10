import type { SupabaseClient } from "@supabase/supabase-js";

const NIL = "00000000-0000-0000-0000-000000000000";

async function assertOk(
  table: string,
  error: { message: string } | null
): Promise<void> {
  if (error) {
    throw new Error(`فشل مسح ${table}: ${error.message}`);
  }
}

async function deleteByNeq(
  client: SupabaseClient,
  table: string,
  column: string
): Promise<void> {
  const { error } = await client.from(table).delete().neq(column, NIL);
  await assertOk(table, error);
}

function isMissingRelationError(message: string | undefined): boolean {
  return /relation .* does not exist|Could not find the table/i.test(
    message || ""
  );
}

async function deleteByNeqIfExists(
  client: SupabaseClient,
  table: string,
  column: string
): Promise<void> {
  const { error } = await client.from(table).delete().neq(column, NIL);
  if (error && isMissingRelationError(error.message)) return;
  await assertOk(table, error);
}

/**
 * Full operational wipe via service client (no reseed).
 * Does not touch profiles / telegram_config / backup_runs.
 */
export async function wipeAllBusinessTables(
  client: SupabaseClient
): Promise<void> {
  const ordered: Array<{ table: string; column: string }> = [
    { table: "inventory_count_items", column: "id" },
    { table: "inventory_counts", column: "id" },
    { table: "invoice_items", column: "id" },
    { table: "invoices", column: "id" },
    { table: "document_items", column: "id" },
    { table: "documents", column: "id" },
    { table: "party_payment_allocations", column: "id" },
    { table: "party_payments", column: "id" },
    { table: "journal_lines", column: "id" },
    { table: "journal_entries", column: "id" },
    { table: "safe_transactions", column: "id" },
    { table: "product_tier_prices", column: "product_id" },
    { table: "tier_category_discounts", column: "tier_id" },
    { table: "tier_product_discounts", column: "tier_id" },
    { table: "price_tiers", column: "id" },
    { table: "products", column: "id" },
    { table: "categories", column: "id" },
    { table: "customers", column: "id" },
    { table: "suppliers", column: "id" },
    { table: "shifts", column: "id" },
    { table: "safes", column: "id" },
    { table: "accounts", column: "id" },
    { table: "settings", column: "id" },
    { table: "audit_logs", column: "id" },
    { table: "app_notifications", column: "id" },
  ];

  for (const { table, column } of ordered) {
    await deleteByNeq(client, table, column);
  }

  // Workshop bridge operational data (keep workshop_bridge_config)
  await deleteByNeqIfExists(client, "workshop_invoice_inbox", "id");
  await deleteByNeqIfExists(client, "workshop_party_map", "id");
  await deleteByNeqIfExists(client, "cross_app_ledger_entries", "id");

  {
    const { error } = await client
      .from("document_sequences")
      .delete()
      .gte("last_value", 0);
    await assertOk("document_sequences", error);
  }

  await deleteByNeq(client, "client_operations", "client_op_id");
  await deleteByNeq(client, "sync_operations", "operation_id");
  {
    const { error } = await client
      .from("sync_changes")
      .delete()
      .gte("server_seq", 0);
    await assertOk("sync_changes", error);
  }
  await deleteByNeq(client, "sync_devices", "id");
}

/**
 * Tables the older wipe_business_data() may leave behind.
 * Safe to run AFTER factory_reset() reseed (does not touch settings/safes/accounts).
 * Missing bridge tables are skipped (pre-bridge databases).
 */
export async function wipeExtraBusinessTables(
  client: SupabaseClient
): Promise<void> {
  await deleteByNeq(client, "product_tier_prices", "product_id");
  await deleteByNeq(client, "tier_category_discounts", "tier_id");
  await deleteByNeq(client, "tier_product_discounts", "tier_id");
  await deleteByNeq(client, "party_payment_allocations", "id");
  await deleteByNeq(client, "party_payments", "id");
  await deleteByNeq(client, "price_tiers", "id");
  await deleteByNeq(client, "shifts", "id");
  await deleteByNeq(client, "audit_logs", "id");
  await deleteByNeq(client, "app_notifications", "id");
  await deleteByNeq(client, "client_operations", "client_op_id");
  await deleteByNeq(client, "sync_operations", "operation_id");
  {
    const { error } = await client
      .from("sync_changes")
      .delete()
      .gte("server_seq", 0);
    await assertOk("sync_changes", error);
  }
  await deleteByNeq(client, "sync_devices", "id");

  // Belt-and-suspenders: ensure core catalogs are empty even if RPC wipe was stale
  await deleteByNeq(client, "invoice_items", "id");
  await deleteByNeq(client, "invoices", "id");
  await deleteByNeq(client, "document_items", "id");
  await deleteByNeq(client, "documents", "id");
  await deleteByNeq(client, "products", "id");
  await deleteByNeq(client, "categories", "id");
  await deleteByNeq(client, "customers", "id");
  await deleteByNeq(client, "suppliers", "id");
  await deleteByNeq(client, "inventory_count_items", "id");
  await deleteByNeq(client, "inventory_counts", "id");

  // Workshop bridge leftovers older wipe RPCs may leave behind
  await deleteByNeqIfExists(client, "workshop_invoice_inbox", "id");
  await deleteByNeqIfExists(client, "workshop_party_map", "id");
  await deleteByNeqIfExists(client, "cross_app_ledger_entries", "id");
}

/** Counts that must be 0 after a successful factory reset. */
export async function countCoreBusinessRows(
  client: SupabaseClient
): Promise<Record<string, number>> {
  const tables = [
    "products",
    "customers",
    "categories",
    "suppliers",
    "invoices",
    "documents",
    "party_payments",
    "price_tiers",
    "shifts",
    "workshop_invoice_inbox",
    "workshop_party_map",
    "cross_app_ledger_entries",
  ] as const;
  const out: Record<string, number> = {};
  for (const table of tables) {
    const { count, error } = await client
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) {
      if (isMissingRelationError(error.message)) {
        out[table] = 0;
        continue;
      }
      throw new Error(`فشل عدّ ${table}: ${error.message}`);
    }
    out[table] = count ?? 0;
  }
  return out;
}

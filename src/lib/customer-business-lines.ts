import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mergeBusinessLines,
  normalizeBusinessLines,
  type BusinessLine,
} from "@/lib/business-lines";

const NOTES_MARKER_RE =
  /(?:^|\n)<!--biz:([a-z,_]*)-->(?:\n|$)/i;

function isMissingBusinessLinesColumn(message: string | undefined): boolean {
  return (
    /column ["']?business_lines["']? .* does not exist/i.test(message || "") ||
    /Could not find the ['"]?business_lines['"]? column/i.test(message || "")
  );
}

function stripNotesMarker(notes: string | null | undefined): string {
  return String(notes || "")
    .replace(NOTES_MARKER_RE, "\n")
    .replace(/^\n+|\n+$/g, "")
    .trim();
}

function parseNotesBusinessLines(
  notes: string | null | undefined
): BusinessLine[] {
  const match = String(notes || "").match(NOTES_MARKER_RE);
  if (!match) return [];
  return normalizeBusinessLines(
    String(match[1] || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

function embedNotesBusinessLines(
  notes: string | null | undefined,
  lines: BusinessLine[]
): string | null {
  const clean = stripNotesMarker(notes);
  const normalized = normalizeBusinessLines(lines);
  if (normalized.length === 0) {
    return clean || null;
  }
  const marker = `<!--biz:${normalized.join(",")}-->`;
  return clean ? `${marker}\n${clean}` : marker;
}

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

async function readCustomerClassificationState(
  client: SupabaseClient,
  customerId: string
): Promise<{
  mode: "columns" | "notes";
  lines: BusinessLine[];
  manual: BusinessLine[];
  locked: boolean;
  notes: string | null;
}> {
  const { data, error } = await client
    .from("customers")
    .select(
      "business_lines, business_lines_manual, business_lines_locked, notes"
    )
    .eq("id", customerId)
    .maybeSingle();

  if (!error && data) {
    return {
      mode: "columns",
      lines: normalizeBusinessLines(data.business_lines),
      manual: normalizeBusinessLines(data.business_lines_manual),
      locked: data.business_lines_locked === true,
      notes: (data.notes as string | null) ?? null,
    };
  }

  if (error && !isMissingBusinessLinesColumn(error.message)) {
    throw new Error(error.message || "تعذر قراءة تصنيف العميل");
  }

  const { data: row, error: notesErr } = await client
    .from("customers")
    .select("notes")
    .eq("id", customerId)
    .maybeSingle();
  if (notesErr) throw new Error(notesErr.message || "تعذر قراءة تصنيف العميل");
  if (!row) {
    return { mode: "notes", lines: [], manual: [], locked: false, notes: null };
  }
  const fromNotes = parseNotesBusinessLines(row.notes);
  return {
    mode: "notes",
    lines: fromNotes,
    manual: fromNotes,
    locked: fromNotes.length > 0,
    notes: (row.notes as string | null) ?? null,
  };
}

/**
 * Attach business_lines onto customer rows even when DB columns are missing
 * (reads the <!--biz:...--> notes fallback).
 */
export async function hydrateCustomersBusinessLines<
  T extends { id: string; notes?: string | null; business_lines?: BusinessLine[] },
>(client: SupabaseClient, customers: T[]): Promise<T[]> {
  if (customers.length === 0) return customers;
  const already = customers.every((c) =>
    Array.isArray(c.business_lines)
  );
  // If select * returned the field (even empty arrays), keep as-is.
  if (
    already &&
    customers.some(
      (c) =>
        c.business_lines !== undefined &&
        Object.prototype.hasOwnProperty.call(c, "business_lines")
    )
  ) {
    // Still enrich empties from notes when columns exist but empty and notes have marker
    return customers.map((c) => {
      const fromCols = normalizeBusinessLines(c.business_lines);
      if (fromCols.length > 0) return { ...c, business_lines: fromCols };
      const fromNotes = parseNotesBusinessLines(c.notes);
      return fromNotes.length > 0 ? { ...c, business_lines: fromNotes } : c;
    });
  }

  // Columns likely missing — hydrate from notes on each row if present
  return customers.map((c) => {
    const fromNotes = parseNotesBusinessLines(c.notes);
    return {
      ...c,
      business_lines: fromNotes,
    };
  });
}

/**
 * Refresh effective business_lines for a customer.
 * Respects business_lines_locked; always merges manual tags when unlocked.
 * Falls back to notes marker when columns are not migrated yet.
 */
export async function refreshCustomerBusinessLines(
  client: SupabaseClient,
  customerId: string,
  options?: { forceDerivedLine?: BusinessLine | null }
): Promise<BusinessLine[]> {
  const id = String(customerId || "").trim();
  if (!id) return [];

  const state = await readCustomerClassificationState(client, id);
  if (state.locked && state.mode === "columns") {
    return state.lines;
  }
  if (state.locked && state.mode === "notes") {
    return state.lines;
  }

  const derived = await deriveCustomerBusinessLines(client, id);
  if (options?.forceDerivedLine) {
    derived.push(options.forceDerivedLine);
  }
  const next = mergeBusinessLines(derived, state.manual);

  if (state.mode === "columns") {
    const same =
      state.lines.length === next.length &&
      state.lines.every((v, i) => v === next[i]);
    if (!same) {
      const { error: upErr } = await client
        .from("customers")
        .update({ business_lines: next })
        .eq("id", id);
      if (upErr && isMissingBusinessLinesColumn(upErr.message)) {
        const notes = embedNotesBusinessLines(state.notes, next);
        const { error: notesErr } = await client
          .from("customers")
          .update({ notes })
          .eq("id", id);
        if (notesErr) {
          throw new Error(notesErr.message || "تعذر تحديث تصنيف العميل");
        }
      } else if (upErr) {
        throw new Error(upErr.message || "تعذر تحديث تصنيف العميل");
      }
    }
    return next;
  }

  const notes = embedNotesBusinessLines(state.notes, next);
  const { error: notesErr } = await client
    .from("customers")
    .update({ notes })
    .eq("id", id);
  if (notesErr) throw new Error(notesErr.message || "تعذر تحديث تصنيف العميل");
  return next;
}

/**
 * Save user-chosen classification (locks auto overwrite).
 * Uses DB columns when available; otherwise embeds marker in notes.
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

  if (!error) return manual;

  if (!isMissingBusinessLinesColumn(error.message)) {
    throw new Error(error.message || "تعذر حفظ التصنيف");
  }

  const { data: row, error: readErr } = await client
    .from("customers")
    .select("notes")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message || "تعذر حفظ التصنيف");

  const notes = embedNotesBusinessLines(row?.notes, manual);
  const { error: notesErr } = await client
    .from("customers")
    .update({ notes })
    .eq("id", id);
  if (notesErr) throw new Error(notesErr.message || "تعذر حفظ التصنيف");
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

  if (error && !isMissingBusinessLinesColumn(error.message)) {
    throw new Error(error.message || "تعذر فتح التصنيف التلقائي");
  }

  // Notes fallback has no locked flag column — clearing marker lock by
  // re-deriving and rewriting.
  return refreshCustomerBusinessLines(client, id);
}

/** Parse business lines from a customer notes field (fallback storage). */
export function businessLinesFromNotes(
  notes: string | null | undefined
): BusinessLine[] {
  return parseNotesBusinessLines(notes);
}

/**
 * Bulk-derive tags for all customers.
 * Uses columns when present; otherwise embeds <!--biz:...> in notes.
 * Safe to re-run. Does not overwrite locked columns / existing notes markers
 * unless `force` is true.
 */
export async function backfillAllCustomerBusinessLines(
  client: SupabaseClient,
  options?: { force?: boolean; limit?: number }
): Promise<{
  mode: "columns" | "notes";
  scanned: number;
  updated: number;
  skipped: number;
  errors: string[];
}> {
  const force = options?.force === true;
  const limit = Math.min(5000, Math.max(1, options?.limit || 2000));
  const errors: string[] = [];

  const probe = await client
    .from("customers")
    .select("business_lines")
    .limit(1);
  const columnsReady =
    !probe.error || !isMissingBusinessLinesColumn(probe.error.message);
  const mode: "columns" | "notes" = columnsReady ? "columns" : "notes";

  const { data: customersRaw, error: custErr } = await client
    .from("customers")
    .select(
      columnsReady
        ? "id, notes, balance, opening_balance, business_lines, business_lines_manual, business_lines_locked"
        : "id, notes, balance, opening_balance"
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (custErr) throw new Error(custErr.message || "تعذر قراءة العملاء");

  type CustRow = {
    id: string;
    notes?: string | null;
    balance?: number | null;
    opening_balance?: number | null;
    business_lines?: unknown;
    business_lines_manual?: unknown;
    business_lines_locked?: boolean | null;
  };
  const rows = (customersRaw || []) as unknown as CustRow[];
  if (rows.length === 0) {
    return { mode, scanned: 0, updated: 0, skipped: 0, errors };
  }

  const ids = rows.map((r) => String(r.id));

  const [mapRes, ledgerRes, invRes, payRes] = await Promise.all([
    client
      .from("workshop_party_map")
      .select("store_party_id, source_system")
      .eq("party_type", "customer")
      .in("store_party_id", ids),
    client
      .from("cross_app_ledger_entries")
      .select("party_id, source_system")
      .eq("party_type", "customer")
      .in("party_id", ids),
    client
      .from("invoices")
      .select("customer_id")
      .eq("status", "completed")
      .in("type", ["sale", "sale_return"])
      .in("customer_id", ids),
    client
      .from("party_payments")
      .select("party_id")
      .eq("party_type", "customer")
      .in("party_id", ids),
  ]);

  const systemsByCustomer = new Map<string, Set<string>>();
  const storeActivity = new Set<string>();

  for (const row of mapRes.data || []) {
    const id = String(row.store_party_id || "");
    if (!id) continue;
    const set = systemsByCustomer.get(id) || new Set<string>();
    set.add(String(row.source_system || "").toLowerCase());
    systemsByCustomer.set(id, set);
  }
  for (const row of ledgerRes.data || []) {
    const id = String(row.party_id || "");
    if (!id) continue;
    const set = systemsByCustomer.get(id) || new Set<string>();
    set.add(String(row.source_system || "").toLowerCase());
    systemsByCustomer.set(id, set);
  }
  for (const row of invRes.data || []) {
    if (row.customer_id) storeActivity.add(String(row.customer_id));
  }
  for (const row of payRes.data || []) {
    if (row.party_id) storeActivity.add(String(row.party_id));
  }

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = String(row.id);
    const systems = systemsByCustomer.get(id) || new Set<string>();
    const derived: BusinessLine[] = [];
    if (systems.has("plisse")) derived.push("wire");
    if (systems.has("aa")) derived.push("workshop");
    if (
      storeActivity.has(id) ||
      Math.abs(Number(row.balance) || 0) > 0.0005 ||
      Math.abs(Number(row.opening_balance) || 0) > 0.0005
    ) {
      derived.push("store");
    }
    const next = normalizeBusinessLines(derived);
    if (next.length === 0) {
      skipped++;
      continue;
    }

    if (mode === "columns") {
      const locked = row.business_lines_locked === true;
      const current = normalizeBusinessLines(row.business_lines);
      const manual = normalizeBusinessLines(row.business_lines_manual);
      if (locked && !force) {
        skipped++;
        continue;
      }
      const merged = mergeBusinessLines(next, manual);
      const same =
        current.length === merged.length &&
        current.every((v, i) => v === merged[i]);
      if (same) {
        skipped++;
        continue;
      }
      const { error } = await client
        .from("customers")
        .update({ business_lines: merged })
        .eq("id", id);
      if (error) {
        errors.push(`${id}: ${error.message}`);
        continue;
      }
      updated++;
      continue;
    }

    // notes mode
    const existing = parseNotesBusinessLines(row.notes);
    if (existing.length > 0 && !force) {
      skipped++;
      continue;
    }
    const notes = embedNotesBusinessLines(row.notes, next);
    const { error } = await client
      .from("customers")
      .update({ notes })
      .eq("id", id);
    if (error) {
      errors.push(`${id}: ${error.message}`);
      continue;
    }
    updated++;
  }

  return {
    mode,
    scanned: rows.length,
    updated,
    skipped,
    errors: errors.slice(0, 20),
  };
}

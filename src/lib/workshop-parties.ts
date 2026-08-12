import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sourceSystemToBusinessLine,
  type BusinessLine,
} from "@/lib/business-lines";
import { refreshCustomerBusinessLines } from "@/lib/customer-business-lines";

export type WorkshopSourceSystem = "aa" | "plisse";
export type PartyKind = "customer" | "supplier";

export type StorePartyRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
  is_active: boolean;
  created_at: string;
  business_lines?: BusinessLine[];
};

export function normalizePartyPhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

async function touchCustomerBusinessLines(
  client: SupabaseClient,
  partyId: string,
  sourceSystem?: WorkshopSourceSystem | null
) {
  try {
    await refreshCustomerBusinessLines(client, partyId, {
      forceDerivedLine: sourceSystem
        ? sourceSystemToBusinessLine(sourceSystem)
        : null,
    });
  } catch {
    // Classification is best-effort; never block party/ledger writes
  }
}

function digitsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Egyptian mobiles: compare last 9–10 digits
  const aa = a.slice(-10);
  const bb = b.slice(-10);
  return aa.length >= 9 && bb.length >= 9 && aa.slice(-9) === bb.slice(-9);
}

/**
 * Find an active party by phone using a targeted query (not a 50-row scan).
 * Never matches by name — common names like «عمر» must not auto-merge.
 */
async function findPartyIdByPhone(
  client: SupabaseClient,
  table: "customers" | "suppliers",
  phoneNorm: string
): Promise<string | null> {
  if (!phoneNorm || phoneNorm.length < 9) return null;
  const last9 = phoneNorm.slice(-9);
  const { data, error } = await client
    .from(table)
    .select("id, phone, phone_normalized")
    .eq("is_active", true)
    .or(
      `phone_normalized.ilike.%${last9}%,phone.ilike.%${last9}%`
    )
    .limit(200);
  if (error) {
    // Fallback: broader fetch if phone_normalized column missing
    if (/phone_normalized/i.test(error.message || "")) {
      const retry = await client
        .from(table)
        .select("id, phone")
        .eq("is_active", true)
        .ilike("phone", `%${last9}%`)
        .limit(200);
      if (retry.error) throw new Error(retry.error.message);
      const hit = (retry.data || []).find((row) =>
        digitsMatch(normalizePartyPhone(row.phone), phoneNorm)
      );
      return hit?.id || null;
    }
    throw new Error(error.message);
  }
  const hit = (data || []).find((row) =>
    digitsMatch(
      normalizePartyPhone(row.phone_normalized || row.phone),
      phoneNorm
    )
  );
  return hit?.id || null;
}

export async function searchStoreParties(
  client: SupabaseClient,
  kind: PartyKind,
  q: string,
  limit = 30
): Promise<StorePartyRow[]> {
  const table = kind === "customer" ? "customers" : "suppliers";
  const query = q.trim();
  const phone = normalizePartyPhone(query);

  let builder = client
    .from(table)
    .select(
      kind === "customer"
        ? "id, name, phone, address, notes, balance, is_active, created_at, business_lines"
        : "id, name, phone, address, notes, balance, is_active, created_at"
    )
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(limit);

  if (query) {
    if (phone.length >= 4) {
      builder = builder.or(
        `name.ilike.%${query}%,phone.ilike.%${query}%,phone_normalized.ilike.%${phone}%`
      );
    } else {
      builder = builder.ilike("name", `%${query}%`);
    }
  }

  let { data, error } = await builder;
  if (
    kind === "customer" &&
    error &&
    /business_lines/i.test(error.message || "")
  ) {
    let retry = client
      .from(table)
      .select("id, name, phone, address, notes, balance, is_active, created_at")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(limit);
    if (query) {
      if (phone.length >= 4) {
        retry = retry.or(
          `name.ilike.%${query}%,phone.ilike.%${query}%,phone_normalized.ilike.%${phone}%`
        );
      } else {
        retry = retry.ilike("name", `%${query}%`);
      }
    }
    const retried = await retry;
    data = retried.data as typeof data;
    error = retried.error;
  }
  if (error) throw new Error(error.message || "تعذر البحث");
  return (data || []) as unknown as StorePartyRow[];
}

export async function upsertWorkshopParty(
  client: SupabaseClient,
  params: {
    kind: PartyKind;
    sourceSystem: WorkshopSourceSystem;
    localPartyId?: string | null;
    name: string;
    phone?: string | null;
    address?: string | null;
    notes?: string | null;
  }
): Promise<{ party: StorePartyRow; created: boolean; mapped: boolean }> {
  const name = params.name.trim();
  if (!name) throw new Error("الاسم مطلوب");

  const phone = String(params.phone || "").trim() || null;
  const phoneNorm = normalizePartyPhone(phone);
  const address = String(params.address || "").trim() || null;
  const notes = String(params.notes || "").trim() || null;
  const table = params.kind === "customer" ? "customers" : "suppliers";
  const localId = String(params.localPartyId || "").trim();

  // 1) Existing map
  if (localId) {
    const { data: mapped } = await client
      .from("workshop_party_map")
      .select("store_party_id")
      .eq("source_system", params.sourceSystem)
      .eq("party_type", params.kind)
      .eq("local_party_id", localId)
      .maybeSingle();

    if (mapped?.store_party_id) {
      const { data: existing, error } = await client
        .from(table)
        .update({
          name,
          phone,
          address,
          notes,
          is_active: true,
        })
        .eq("id", mapped.store_party_id)
        .select(
          "id, name, phone, address, notes, balance, is_active, created_at"
        )
        .single();
      if (error) throw new Error(error.message);
      if (params.kind === "customer") {
        await touchCustomerBusinessLines(
          client,
          mapped.store_party_id,
          params.sourceSystem
        );
      }
      return {
        party: existing as StorePartyRow,
        created: false,
        mapped: true,
      };
    }
  }

  // 2) Match by phone only — never by name (avoids merging every «عمر»).
  const matchId = phoneNorm
    ? await findPartyIdByPhone(client, table, phoneNorm)
    : null;

  let party: StorePartyRow;
  let created = false;

  if (matchId) {
    const { data, error } = await client
      .from(table)
      .update({
        name,
        phone: phone || undefined,
        address: address || undefined,
        notes: notes || undefined,
        is_active: true,
      })
      .eq("id", matchId)
      .select("id, name, phone, address, notes, balance, is_active, created_at")
      .single();
    if (error) throw new Error(error.message);
    party = data as StorePartyRow;
  } else {
    const { data, error } = await client
      .from(table)
      .insert({
        name,
        phone,
        address,
        notes,
        balance: 0,
        opening_balance: 0,
        is_active: true,
      })
      .select("id, name, phone, address, notes, balance, is_active, created_at")
      .single();
    if (error) throw new Error(error.message);
    party = data as StorePartyRow;
    created = true;
  }

  let mapped = false;
  if (localId) {
    const { error: mapErr } = await client.from("workshop_party_map").upsert(
      {
        source_system: params.sourceSystem,
        local_party_id: localId,
        party_type: params.kind,
        store_party_id: party.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source_system,party_type,local_party_id" }
    );
    if (mapErr) throw new Error(mapErr.message);
    mapped = true;
  }

  if (params.kind === "customer") {
    await touchCustomerBusinessLines(client, party.id, params.sourceSystem);
  }

  return { party, created, mapped };
}

export type LedgerEntryInput = {
  sourceSystem: WorkshopSourceSystem;
  sourceRef: string;
  partyType: PartyKind;
  partyId: string;
  entryType:
    | "workshop_sale"
    | "workshop_collection"
    | "workshop_adjustment"
    | "workshop_void";
  amount: number;
  direction: "debit" | "credit";
  occurredAt?: string | null;
  notes?: string | null;
  projectLabel?: string | null;
  /** Workshop line payload (e.g. plisse door dims) for party account UI */
  details?: Record<string, unknown> | null;
};

function isMissingLedgerRpcError(message: string | undefined): boolean {
  return /Could not find the function.*apply_cross_app_ledger_entry|PGRST202/i.test(
    message || ""
  );
}

function isLedgerRpcAmbiguousError(message: string | undefined): boolean {
  return /Could not choose the best candidate function.*apply_cross_app_ledger_entry/i.test(
    message || ""
  );
}

function isMissingDetailsColumnError(message: string | undefined): boolean {
  // Postgres: column "details" of relation "cross_app_ledger_entries" does not exist
  // PostgREST schema cache: Could not find the 'details' column of 'cross_app_ledger_entries'
  return (
    /column ["']?details["']? of relation ["']?cross_app_ledger_entries["']? does not exist/i.test(
      message || ""
    ) ||
    /Could not find the ['"]?details['"]? column of ['"]?cross_app_ledger_entries['"]?/i.test(
      message || ""
    )
  );
}

function isBrokenLedgerSchemaError(message: string | undefined): boolean {
  return (
    isMissingLedgerRpcError(message) ||
    isLedgerRpcAmbiguousError(message) ||
    isMissingDetailsColumnError(message)
  );
}

type LedgerApplyResult = {
  id: string | null;
  delta: number;
  amount: number;
  direction: string;
  voided: boolean;
};

function signedLedgerAmount(
  direction: "debit" | "credit",
  amount: number
): number {
  return direction === "debit" ? amount : -amount;
}

async function adjustPartyBalance(
  client: SupabaseClient,
  partyType: PartyKind,
  partyId: string,
  delta: number
) {
  if (!partyId || Math.abs(delta) < 0.0005) return;
  const rpc =
    partyType === "customer"
      ? "adjust_customer_balance"
      : "adjust_supplier_balance";
  const { error } = await client.rpc(rpc, {
    p_id: partyId,
    p_delta: delta,
  });
  if (error) {
    throw new Error(error.message || "تعذر تحديث رصيد الطرف");
  }
}

/**
 * Service-role table writes when production RPC overloads / missing `details`
 * column break PostgREST (same pattern as transferBetweenSafesDirect).
 */
export async function applyCrossAppLedgerEntryDirect(
  client: SupabaseClient,
  input: LedgerEntryInput
): Promise<LedgerApplyResult> {
  const sourceSystem = String(input.sourceSystem || "")
    .trim()
    .toLowerCase() as WorkshopSourceSystem;
  const sourceRef = String(input.sourceRef || "").trim();
  const partyType = String(input.partyType || "")
    .trim()
    .toLowerCase() as PartyKind;
  const entryType = String(input.entryType || "").trim().toLowerCase();
  const direction = String(input.direction || "")
    .trim()
    .toLowerCase() as "debit" | "credit";
  const amount = Math.max(0, Number(input.amount) || 0);
  const partyId = String(input.partyId || "").trim();
  const occurredAt = input.occurredAt || new Date().toISOString();
  const notes = String(input.notes || "").trim() || null;
  const projectLabel = String(input.projectLabel || "").trim() || null;
  const details =
    input.details &&
    typeof input.details === "object" &&
    !Array.isArray(input.details) &&
    Object.keys(input.details).length > 0
      ? input.details
      : null;

  if (sourceSystem !== "aa" && sourceSystem !== "plisse") {
    throw new Error("source_system غير صالح");
  }
  if (!sourceRef) throw new Error("source_ref مطلوب");
  if (partyType !== "customer" && partyType !== "supplier") {
    throw new Error("party_type غير صالح");
  }
  if (!partyId) throw new Error("party_id مطلوب");
  if (
    entryType !== "workshop_sale" &&
    entryType !== "workshop_collection" &&
    entryType !== "workshop_adjustment" &&
    entryType !== "workshop_void"
  ) {
    throw new Error("entry_type غير صالح");
  }
  if (direction !== "debit" && direction !== "credit") {
    throw new Error("direction غير صالح");
  }

  const partyTable = partyType === "customer" ? "customers" : "suppliers";
  const { data: partyRow, error: partyErr } = await client
    .from(partyTable)
    .select("id")
    .eq("id", partyId)
    .maybeSingle();
  if (partyErr) throw new Error(partyErr.message || "تعذر التحقق من الطرف");
  if (!partyRow) {
    throw new Error(partyType === "customer" ? "العميل غير موجود" : "المورد غير موجود");
  }

  const { data: existing, error: existErr } = await client
    .from("cross_app_ledger_entries")
    .select(
      "id, party_type, party_id, amount, direction, entry_type, source_system, source_ref"
    )
    .eq("source_system", sourceSystem)
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (existErr) {
    throw new Error(existErr.message || "تعذر قراءة دفتر الورشة");
  }

  const oldSigned = existing
    ? signedLedgerAmount(
        existing.direction === "credit" ? "credit" : "debit",
        Number(existing.amount) || 0
      )
    : 0;
  const voided = amount < 0.0005 || entryType === "workshop_void";
  const newSigned = voided ? 0 : signedLedgerAmount(direction, amount);
  const now = new Date().toISOString();

  let entryId: string | null = existing?.id || null;

  if (voided) {
    if (existing?.id) {
      const { error: delErr } = await client
        .from("cross_app_ledger_entries")
        .delete()
        .eq("id", existing.id);
      if (delErr) {
        throw new Error(delErr.message || "تعذر إلغاء حركة الورشة");
      }
    }
  } else {
    const baseRow = {
      party_type: partyType,
      party_id: partyId,
      source_system: sourceSystem,
      source_ref: sourceRef,
      entry_type: entryType,
      amount,
      direction,
      occurred_at: occurredAt,
      notes,
      project_label: projectLabel,
      updated_at: now,
    };

    const writeWithOptionalDetails = async (
      withDetails: boolean
    ): Promise<{ id: string | null; error: string | null }> => {
      const row =
        withDetails && details != null
          ? { ...baseRow, details }
          : baseRow;
      if (existing?.id) {
        const { data, error } = await client
          .from("cross_app_ledger_entries")
          .update(row)
          .eq("id", existing.id)
          .select("id")
          .maybeSingle();
        return {
          id: data?.id || existing.id,
          error: error?.message || null,
        };
      }
      const { data, error } = await client
        .from("cross_app_ledger_entries")
        .insert(row)
        .select("id")
        .maybeSingle();
      return { id: data?.id || null, error: error?.message || null };
    };

    let written = await writeWithOptionalDetails(true);
    if (written.error && isMissingDetailsColumnError(written.error)) {
      written = await writeWithOptionalDetails(false);
    }
    if (written.error) {
      throw new Error(written.error);
    }
    entryId = written.id;
  }

  // Reverse previous effect on the OLD party (covers party moves)
  if (existing && Math.abs(oldSigned) >= 0.0005) {
    const oldType =
      existing.party_type === "supplier" ? "supplier" : "customer";
    await adjustPartyBalance(client, oldType, String(existing.party_id), -oldSigned);
  }

  // Apply new effect on the NEW party
  if (Math.abs(newSigned) >= 0.0005) {
    await adjustPartyBalance(client, partyType, partyId, newSigned);
  }

  if (partyType === "customer") {
    await touchCustomerBusinessLines(client, partyId, sourceSystem);
  }

  return {
    id: entryId,
    delta: newSigned - oldSigned,
    amount,
    direction,
    voided,
  };
}

export async function applyCrossAppLedgerEntry(
  client: SupabaseClient,
  input: LedgerEntryInput
) {
  // PostgREST matches RPCs by the exact named-arg set in the JSON body.
  // Always send `p_details` (even null) so the 11-arg signature is unique when
  // both 10-arg and 11-arg overloads exist in the schema cache.
  const params = {
    p_source_system: input.sourceSystem,
    p_source_ref: input.sourceRef,
    p_party_type: input.partyType,
    p_party_id: input.partyId,
    p_entry_type: input.entryType,
    p_amount: Number(input.amount) || 0,
    p_direction: input.direction,
    p_occurred_at: input.occurredAt || null,
    p_notes: input.notes || null,
    p_project_label: input.projectLabel || null,
    p_details: input.details ?? null,
  };

  const { data, error } = await client.rpc(
    "apply_cross_app_ledger_entry",
    params
  );

  if (!error) {
    if (input.partyType === "customer") {
      await touchCustomerBusinessLines(
        client,
        input.partyId,
        input.sourceSystem
      );
    }
    return data as LedgerApplyResult;
  }

  // Production may still have dual overloads + missing details column.
  // Fall back to direct writes (service role) so workshops stop showing «محلياً».
  if (isBrokenLedgerSchemaError(error.message)) {
    return applyCrossAppLedgerEntryDirect(client, input);
  }

  throw new Error(error.message || "تعذر تسجيل حركة الورشة");
}

export type ExternalPurchaseLine = {
  description?: string;
  name?: string;
  quantity?: number;
  unit_price?: number;
  total?: number;
};

export async function createWorkshopExternalPurchase(
  client: SupabaseClient,
  params: {
    supplierId: string;
    items: ExternalPurchaseLine[];
    subtotal: number;
    total: number;
    paidAmount?: number;
    safeId?: string | null;
    notes?: string | null;
    createdAt?: string | null;
    sourceSystem: WorkshopSourceSystem;
    sourceRef?: string | null;
  }
) {
  const { data, error } = await client.rpc("create_workshop_external_purchase", {
    p_supplier_id: params.supplierId,
    p_items: params.items,
    p_subtotal: params.subtotal,
    p_total: params.total,
    p_paid_amount: params.paidAmount ?? 0,
    p_safe_id: params.safeId || null,
    p_notes: params.notes || null,
    p_created_at: params.createdAt || null,
    p_source_system: params.sourceSystem,
    p_source_ref: params.sourceRef || null,
  });
  if (error) throw new Error(error.message || "تعذر إنشاء فاتورة التوريد");
  return data as {
    id: string;
    invoice_number: string;
    idempotent?: boolean;
  };
}

export type UnifiedStatementRow = {
  id: string;
  occurred_at: string;
  source: "store" | "aa" | "plisse";
  kind: string;
  label: string;
  reference: string;
  debit: number;
  credit: number;
  notes: string | null;
  running_balance?: number;
};

/**
 * Build chronological unified statement for a customer (optional linked supplier).
 * Customer balance convention: debit = عليه, credit = له.
 */
export async function buildUnifiedCustomerStatement(
  client: SupabaseClient,
  params: {
    customerId: string;
    linkedSupplierId?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
  }
): Promise<{
  rows: UnifiedStatementRow[];
  opening_balance: number;
  closing_balance: number;
  customer: StorePartyRow | null;
  linked_supplier: StorePartyRow | null;
}> {
  const { data: customer } = await client
    .from("customers")
    .select("id, name, phone, address, notes, balance, is_active, created_at, opening_balance, linked_supplier_id")
    .eq("id", params.customerId)
    .maybeSingle();

  if (!customer) {
    return {
      rows: [],
      opening_balance: 0,
      closing_balance: 0,
      customer: null,
      linked_supplier: null,
    };
  }

  const linkedSupplierId =
    params.linkedSupplierId ||
    (customer as { linked_supplier_id?: string | null }).linked_supplier_id ||
    null;

  let linkedSupplier: StorePartyRow | null = null;
  if (linkedSupplierId) {
    const { data } = await client
      .from("suppliers")
      .select("id, name, phone, address, notes, balance, is_active, created_at")
      .eq("id", linkedSupplierId)
      .maybeSingle();
    linkedSupplier = (data as StorePartyRow) || null;
  }

  const from = params.dateFrom ? `${params.dateFrom}T00:00:00` : null;
  const to = params.dateTo ? `${params.dateTo}T23:59:59` : null;

  let salesQ = client
    .from("invoices")
    .select(
      "id, invoice_number, type, total, paid_amount, created_at, notes, status"
    )
    .eq("customer_id", params.customerId)
    .eq("status", "completed")
    .in("type", ["sale", "sale_return"]);
  if (from) salesQ = salesQ.gte("created_at", from);
  if (to) salesQ = salesQ.lte("created_at", to);

  let paysQ = client
    .from("party_payments")
    .select("id, amount, notes, created_at, is_settlement")
    .eq("party_type", "customer")
    .eq("party_id", params.customerId);
  if (from) paysQ = paysQ.gte("created_at", from);
  if (to) paysQ = paysQ.lte("created_at", to);

  let ledgerQ = client
    .from("cross_app_ledger_entries")
    .select(
      "id, source_system, source_ref, entry_type, amount, direction, occurred_at, notes, project_label"
    )
    .eq("party_type", "customer")
    .eq("party_id", params.customerId);
  if (from) ledgerQ = ledgerQ.gte("occurred_at", from);
  if (to) ledgerQ = ledgerQ.lte("occurred_at", to);

  const [salesRes, paysRes, ledgerRes] = await Promise.all([
    salesQ,
    paysQ,
    ledgerQ,
  ]);

  if (salesRes.error) throw new Error(salesRes.error.message);
  if (paysRes.error) throw new Error(paysRes.error.message);
  if (ledgerRes.error) throw new Error(ledgerRes.error.message);

  const rows: UnifiedStatementRow[] = [];

  for (const inv of salesRes.data || []) {
    const total = Number(inv.total) || 0;
    const paid = Math.max(0, Number(inv.paid_amount) || 0);
    const isReturn = inv.type === "sale_return";
    rows.push({
      id: `inv-${inv.id}`,
      occurred_at: inv.created_at,
      source: "store",
      kind: inv.type,
      label: isReturn ? "مرتجع بيع" : "بيع محل",
      reference: inv.invoice_number,
      debit: isReturn ? 0 : total,
      credit: isReturn ? total : 0,
      notes: inv.notes || null,
    });
    // Cash/partial paid on the invoice itself (not in party_payments)
    if (paid >= 0.0005) {
      rows.push({
        id: `inv-paid-${inv.id}`,
        occurred_at: inv.created_at,
        source: "store",
        kind: isReturn ? "return_refund" : "invoice_payment",
        label: isReturn ? "استرداد مع المرتجع" : "مدفوع مع الفاتورة",
        reference: inv.invoice_number,
        debit: isReturn ? paid : 0,
        credit: isReturn ? 0 : paid,
        notes: null,
      });
    }
  }

  for (const pay of paysRes.data || []) {
    const amount = Number(pay.amount) || 0;
    const isSettlement = Boolean(pay.is_settlement);
    rows.push({
      id: `pay-${pay.id}`,
      occurred_at: pay.created_at,
      source: "store",
      kind: isSettlement ? "settlement" : "collection",
      label: isSettlement ? "مقاصة" : "تحصيل",
      reference: `تحص-${String(pay.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      debit: 0,
      credit: amount,
      notes: pay.notes || null,
    });
  }

  for (const entry of ledgerRes.data || []) {
    const amount = Number(entry.amount) || 0;
    const isDebit = entry.direction === "debit";
    const src = entry.source_system === "plisse" ? "plisse" : "aa";
    const labelMap: Record<string, string> = {
      workshop_sale: src === "plisse" ? "بيع بلسية" : "بيع PVC",
      workshop_collection: src === "plisse" ? "تحصيل بلسية" : "تحصيل PVC",
      workshop_adjustment: "تسوية ورشة",
      workshop_void: "إلغاء ورشة",
    };
    rows.push({
      id: `xapp-${entry.id}`,
      occurred_at: entry.occurred_at,
      source: src,
      kind: entry.entry_type,
      label: labelMap[entry.entry_type] || entry.entry_type,
      reference: entry.source_ref,
      debit: isDebit ? amount : 0,
      credit: isDebit ? 0 : amount,
      notes: [entry.project_label, entry.notes].filter(Boolean).join(" — ") || null,
    });
  }

  if (linkedSupplierId) {
    let purchQ = client
      .from("invoices")
      .select(
        "id, invoice_number, type, total, paid_amount, created_at, notes, status"
      )
      .eq("supplier_id", linkedSupplierId)
      .eq("status", "completed")
      .in("type", ["purchase", "purchase_return"]);
    if (from) purchQ = purchQ.gte("created_at", from);
    if (to) purchQ = purchQ.lte("created_at", to);

    let suppPayQ = client
      .from("party_payments")
      .select("id, amount, notes, created_at, is_settlement")
      .eq("party_type", "supplier")
      .eq("party_id", linkedSupplierId);
    if (from) suppPayQ = suppPayQ.gte("created_at", from);
    if (to) suppPayQ = suppPayQ.lte("created_at", to);

    let suppLedgerQ = client
      .from("cross_app_ledger_entries")
      .select(
        "id, source_system, source_ref, entry_type, amount, direction, occurred_at, notes, project_label"
      )
      .eq("party_type", "supplier")
      .eq("party_id", linkedSupplierId);
    if (from) suppLedgerQ = suppLedgerQ.gte("occurred_at", from);
    if (to) suppLedgerQ = suppLedgerQ.lte("occurred_at", to);

    const [purchRes, suppPayRes, suppLedgerRes] = await Promise.all([
      purchQ,
      suppPayQ,
      suppLedgerQ,
    ]);
    if (purchRes.error) throw new Error(purchRes.error.message);
    if (suppPayRes.error) throw new Error(suppPayRes.error.message);
    if (suppLedgerRes.error) throw new Error(suppLedgerRes.error.message);

    for (const inv of purchRes.data || []) {
      const total = Number(inv.total) || 0;
      const paid = Math.max(0, Number(inv.paid_amount) || 0);
      const isReturn = inv.type === "purchase_return";
      // On unified net view: purchase (we owe) is credit to net "لنا/علينا" from customer perspective
      // Customer view of linked supplier: purchase increases what we owe them → treat as credit against customer net
      rows.push({
        id: `pinv-${inv.id}`,
        occurred_at: inv.created_at,
        source: "store",
        kind: inv.type,
        label: isReturn ? "مرتجع شراء" : "شراء",
        reference: inv.invoice_number,
        debit: isReturn ? total : 0,
        credit: isReturn ? 0 : total,
        notes: inv.notes || null,
      });
      if (paid >= 0.0005) {
        rows.push({
          id: `pinv-paid-${inv.id}`,
          occurred_at: inv.created_at,
          source: "store",
          kind: isReturn ? "return_refund" : "invoice_payment",
          label: isReturn ? "استرداد مع مرتجع الشراء" : "مدفوع مع فاتورة الشراء",
          reference: inv.invoice_number,
          debit: isReturn ? 0 : paid,
          credit: isReturn ? paid : 0,
          notes: null,
        });
      }
    }

    for (const pay of suppPayRes.data || []) {
      const amount = Number(pay.amount) || 0;
      rows.push({
        id: `spay-${pay.id}`,
        occurred_at: pay.created_at,
        source: "store",
        kind: pay.is_settlement ? "settlement" : "disbursement",
        label: pay.is_settlement ? "مقاصة" : "سداد مورد",
        reference: `سداد-${String(pay.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`,
        debit: amount,
        credit: 0,
        notes: pay.notes || null,
      });
    }

    for (const entry of suppLedgerRes.data || []) {
      const amount = Number(entry.amount) || 0;
      const isDebit = entry.direction === "debit";
      const src = entry.source_system === "plisse" ? "plisse" : "aa";
      rows.push({
        id: `sxapp-${entry.id}`,
        occurred_at: entry.occurred_at,
        source: src,
        kind: entry.entry_type,
        label: "حركة مورد ورشة",
        reference: entry.source_ref,
        // supplier debit (علينا) → credit on customer-net view
        debit: isDebit ? 0 : amount,
        credit: isDebit ? amount : 0,
        notes: [entry.project_label, entry.notes].filter(Boolean).join(" — ") || null,
      });
    }
  }

  rows.sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );

  const opening = Number(
    (customer as { opening_balance?: number }).opening_balance ?? 0
  );
  let running = opening;
  const withBalance = rows.map((row) => {
    running += row.debit - row.credit;
    return { ...row, running_balance: running };
  });

  return {
    rows: withBalance,
    opening_balance: opening,
    closing_balance: running,
    customer: customer as StorePartyRow,
    linked_supplier: linkedSupplier,
  };
}

export type WorkshopPartyMapRow = {
  id: string;
  source_system: WorkshopSourceSystem;
  party_type: PartyKind;
  local_party_id: string;
  store_party_id: string;
  updated_at: string | null;
  ledger_with_details: number;
  ledger_total_on_party: number;
};

function entryBelongsToLocalParty(
  entry: {
    source_system: string;
    details: Record<string, unknown> | null;
  },
  sourceSystem: WorkshopSourceSystem,
  localPartyId: string
): boolean {
  if (String(entry.source_system || "").toLowerCase() !== sourceSystem) {
    return false;
  }
  const details = entry.details;
  if (!details || typeof details !== "object") return false;
  const candidates = [
    details.local_party_id,
    details.customer_id,
    details.local_customer_id,
  ];
  return candidates.some(
    (v) => v != null && String(v).trim() === localPartyId
  );
}

/** List workshop_party_map rows pointing at a store customer/supplier. */
export async function listWorkshopPartyMapsForStoreParty(
  client: SupabaseClient,
  params: { storePartyId: string; partyType?: PartyKind }
): Promise<WorkshopPartyMapRow[]> {
  const storePartyId = String(params.storePartyId || "").trim();
  if (!storePartyId) return [];
  const partyType = params.partyType || "customer";

  const { data: maps, error } = await client
    .from("workshop_party_map")
    .select(
      "id, source_system, party_type, local_party_id, store_party_id, updated_at"
    )
    .eq("store_party_id", storePartyId)
    .eq("party_type", partyType)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message || "تعذر قراءة روابط الورشة");

  const { data: ledgerRows, error: ledgerErr } = await client
    .from("cross_app_ledger_entries")
    .select("id, source_system, details")
    .eq("party_type", partyType)
    .eq("party_id", storePartyId);
  if (ledgerErr && !/details/i.test(ledgerErr.message || "")) {
    throw new Error(ledgerErr.message || "تعذر قراءة دفتر الجسر");
  }

  const ledger = (ledgerRows || []) as Array<{
    id: string;
    source_system: string;
    details: Record<string, unknown> | null;
  }>;

  return (maps || []).map((m) => {
    const sourceSystem = String(m.source_system || "").toLowerCase() as WorkshopSourceSystem;
    const localId = String(m.local_party_id || "");
    const withDetails = ledger.filter((e) =>
      entryBelongsToLocalParty(e, sourceSystem, localId)
    ).length;
    return {
      id: String(m.id),
      source_system: sourceSystem,
      party_type: (m.party_type === "supplier" ? "supplier" : "customer") as PartyKind,
      local_party_id: localId,
      store_party_id: String(m.store_party_id),
      updated_at: (m.updated_at as string | null) || null,
      ledger_with_details: withDetails,
      ledger_total_on_party: ledger.filter(
        (e) => String(e.source_system || "").toLowerCase() === sourceSystem
      ).length,
    };
  });
}

/**
 * Detach one workshop local party from a merged store party:
 * create a new store party, remap workshop_party_map, move ledger rows
 * that carry details.local_party_id / customer_id (and all rows from that
 * source_system when this is the only map for it).
 */
export async function splitWorkshopPartyMapLink(
  client: SupabaseClient,
  params: {
    storePartyId: string;
    sourceSystem: WorkshopSourceSystem;
    localPartyId: string;
    partyType?: PartyKind;
    newName?: string | null;
  }
): Promise<{
  newParty: StorePartyRow;
  movedEntries: number;
  mapUpdated: boolean;
  warning: string | null;
}> {
  const storePartyId = String(params.storePartyId || "").trim();
  const localPartyId = String(params.localPartyId || "").trim();
  const sourceSystem = params.sourceSystem;
  const partyType = params.partyType || "customer";
  if (!storePartyId) throw new Error("store_party_id مطلوب");
  if (!localPartyId) throw new Error("local_party_id مطلوب");
  if (sourceSystem !== "aa" && sourceSystem !== "plisse") {
    throw new Error("source_system غير صالح");
  }

  const table = partyType === "customer" ? "customers" : "suppliers";

  const { data: mapRow, error: mapErr } = await client
    .from("workshop_party_map")
    .select("id, store_party_id")
    .eq("source_system", sourceSystem)
    .eq("party_type", partyType)
    .eq("local_party_id", localPartyId)
    .maybeSingle();
  if (mapErr) throw new Error(mapErr.message);
  if (!mapRow || String(mapRow.store_party_id) !== storePartyId) {
    throw new Error("الرابط غير موجود على هذا العميل");
  }

  const { data: oldParty, error: oldErr } = await client
    .from(table)
    .select("id, name, phone, address, notes, balance, is_active, created_at")
    .eq("id", storePartyId)
    .single();
  if (oldErr || !oldParty) throw new Error(oldErr?.message || "العميل غير موجود");

  const newName =
    String(params.newName || "").trim() ||
    `${oldParty.name} · ورشة ${localPartyId.slice(0, 6)}`;

  const { data: created, error: createErr } = await client
    .from(table)
    .insert({
      name: newName,
      phone: oldParty.phone,
      address: oldParty.address,
      notes: [
        String(oldParty.notes || "").trim(),
        `فصل من دمج جسر (${sourceSystem}:${localPartyId})`,
      ]
        .filter(Boolean)
        .join(" · "),
      balance: 0,
      opening_balance: 0,
      is_active: true,
    })
    .select("id, name, phone, address, notes, balance, is_active, created_at")
    .single();
  if (createErr || !created) {
    throw new Error(createErr?.message || "تعذر إنشاء عميل جديد");
  }
  const newParty = created as StorePartyRow;

  const { error: remapErr } = await client
    .from("workshop_party_map")
    .update({
      store_party_id: newParty.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", mapRow.id);
  if (remapErr) throw new Error(remapErr.message);

  // How many maps remain on the old party for this source_system?
  const { data: siblingMaps, error: sibErr } = await client
    .from("workshop_party_map")
    .select("id")
    .eq("store_party_id", storePartyId)
    .eq("party_type", partyType)
    .eq("source_system", sourceSystem);
  if (sibErr) throw new Error(sibErr.message);
  const soleMapForSystem = (siblingMaps || []).length === 0;

  let ledgerQ = await client
    .from("cross_app_ledger_entries")
    .select(
      "id, source_system, source_ref, party_type, party_id, entry_type, amount, direction, occurred_at, notes, project_label, details"
    )
    .eq("party_type", partyType)
    .eq("party_id", storePartyId)
    .eq("source_system", sourceSystem);

  if (ledgerQ.error && /details/i.test(ledgerQ.error.message || "")) {
    ledgerQ = (await client
      .from("cross_app_ledger_entries")
      .select(
        "id, source_system, source_ref, party_type, party_id, entry_type, amount, direction, occurred_at, notes, project_label"
      )
      .eq("party_type", partyType)
      .eq("party_id", storePartyId)
      .eq("source_system", sourceSystem)) as typeof ledgerQ;
  }
  if (ledgerQ.error) throw new Error(ledgerQ.error.message);

  type MoveRow = {
    id: string;
    source_system: string;
    source_ref: string;
    party_type: string;
    party_id: string;
    entry_type: string;
    amount: number;
    direction: string;
    occurred_at: string | null;
    notes: string | null;
    project_label: string | null;
    details?: Record<string, unknown> | null;
  };

  const candidates = (ledgerQ.data || []) as MoveRow[];
  const toMove = candidates.filter((entry) => {
    if (soleMapForSystem) return true;
    return entryBelongsToLocalParty(
      {
        source_system: entry.source_system,
        details: entry.details ?? null,
      },
      sourceSystem,
      localPartyId
    );
  });

  let moved = 0;
  for (const entry of toMove) {
    await applyCrossAppLedgerEntryDirect(client, {
      sourceSystem,
      sourceRef: entry.source_ref,
      partyType,
      partyId: newParty.id,
      entryType: entry.entry_type as LedgerEntryInput["entryType"],
      amount: Number(entry.amount) || 0,
      direction: entry.direction === "credit" ? "credit" : "debit",
      occurredAt: entry.occurred_at,
      notes: entry.notes,
      projectLabel: entry.project_label,
      details: {
        ...(entry.details && typeof entry.details === "object"
          ? entry.details
          : {}),
        local_party_id: localPartyId,
        split_from_party_id: storePartyId,
      },
    });
    moved += 1;
  }

  if (partyType === "customer") {
    await touchCustomerBusinessLines(client, storePartyId, sourceSystem);
    await touchCustomerBusinessLines(client, newParty.id, sourceSystem);
  }

  let warning: string | null = null;
  if (!soleMapForSystem && moved === 0 && candidates.length > 0) {
    warning =
      "اتفصل الرابط واتعمل عميل جديد، لكن قيود الدفتر القديمة من غير تفاصيل العميل المحلي — راجع كشف الحساب أو أعد مزامنة الورشة.";
  } else if (!soleMapForSystem && moved < candidates.length) {
    warning = `اتنقل ${moved} قيد. باقي قيود ${sourceSystem} على العميل الأصلي ممكن تكون لعملاء ورشة تانيين مربوطين عليه.`;
  }

  return {
    newParty,
    movedEntries: moved,
    mapUpdated: true,
    warning,
  };
}

/**
 * Emergency repair: strip all workshop maps + void all cross-app ledger
 * rows on a wrongly-merged store customer so workshops can re-upsert cleanly.
 * (Name-only merge used to pile unrelated PVC projects onto one party.)
 */
export async function resetWronglyMergedStoreCustomer(
  client: SupabaseClient,
  params: { storePartyId: string; partyType?: PartyKind }
): Promise<{
  mapsDeleted: number;
  entriesVoided: number;
  balanceAfter: number;
  voidedRefs: string[];
}> {
  const storePartyId = String(params.storePartyId || "").trim();
  const partyType = params.partyType || "customer";
  if (!storePartyId) throw new Error("store_party_id مطلوب");

  const { data: maps, error: mapErr } = await client
    .from("workshop_party_map")
    .select("id")
    .eq("store_party_id", storePartyId)
    .eq("party_type", partyType);
  if (mapErr) throw new Error(mapErr.message);

  let mapsDeleted = 0;
  if ((maps || []).length > 0) {
    const { error: delMapErr } = await client
      .from("workshop_party_map")
      .delete()
      .eq("store_party_id", storePartyId)
      .eq("party_type", partyType);
    if (delMapErr) throw new Error(delMapErr.message);
    mapsDeleted = maps!.length;
  }

  const { data: entries, error: entErr } = await client
    .from("cross_app_ledger_entries")
    .select("id, source_system, source_ref, entry_type, amount, direction")
    .eq("party_type", partyType)
    .eq("party_id", storePartyId);
  if (entErr) throw new Error(entErr.message);

  const voidedRefs: string[] = [];
  for (const entry of entries || []) {
    const sourceSystem = String(entry.source_system || "").toLowerCase();
    if (sourceSystem !== "aa" && sourceSystem !== "plisse") continue;
    await applyCrossAppLedgerEntryDirect(client, {
      sourceSystem: sourceSystem as WorkshopSourceSystem,
      sourceRef: String(entry.source_ref),
      partyType,
      partyId: storePartyId,
      entryType: "workshop_void",
      amount: 0,
      direction: entry.direction === "credit" ? "credit" : "debit",
      notes: "إصلاح دمج عميل ورشة — إعادة ترحيل",
    });
    voidedRefs.push(`${sourceSystem}:${entry.source_ref}`);
  }

  const table = partyType === "customer" ? "customers" : "suppliers";
  const { data: party } = await client
    .from(table)
    .select("balance")
    .eq("id", storePartyId)
    .maybeSingle();

  return {
    mapsDeleted,
    entriesVoided: voidedRefs.length,
    balanceAfter: Number(party?.balance) || 0,
    voidedRefs,
  };
}

/**
 * Detach each sale:{projectId} (and matching collections by project_label)
 * onto its own store customer — for cases where maps alone can't split.
 */
export async function detachLedgerProjectsToNewCustomers(
  client: SupabaseClient,
  params: { storePartyId: string }
): Promise<{
  created: Array<{
    projectKey: string;
    projectLabel: string;
    newCustomerId: string;
    moved: number;
  }>;
  leftoverEntries: number;
}> {
  const storePartyId = String(params.storePartyId || "").trim();
  if (!storePartyId) throw new Error("store_party_id مطلوب");

  let ledgerQ = await client
    .from("cross_app_ledger_entries")
    .select(
      "id, source_system, source_ref, entry_type, amount, direction, occurred_at, notes, project_label, details"
    )
    .eq("party_type", "customer")
    .eq("party_id", storePartyId);

  if (ledgerQ.error && /details/i.test(ledgerQ.error.message || "")) {
    ledgerQ = (await client
      .from("cross_app_ledger_entries")
      .select(
        "id, source_system, source_ref, entry_type, amount, direction, occurred_at, notes, project_label"
      )
      .eq("party_type", "customer")
      .eq("party_id", storePartyId)) as typeof ledgerQ;
  }
  if (ledgerQ.error) throw new Error(ledgerQ.error.message);

  type Row = {
    id: string;
    source_system: string;
    source_ref: string;
    entry_type: string;
    amount: number;
    direction: string;
    occurred_at: string | null;
    notes: string | null;
    project_label: string | null;
    details?: Record<string, unknown> | null;
  };
  const rows = (ledgerQ.data || []) as Row[];

  const sales = rows.filter(
    (r) =>
      r.entry_type === "workshop_sale" ||
      (r.entry_type === "workshop_adjustment" && r.direction === "debit")
  );

  const created: Array<{
    projectKey: string;
    projectLabel: string;
    newCustomerId: string;
    moved: number;
  }> = [];

  const movedIds = new Set<string>();

  for (const sale of sales) {
    const ref = String(sale.source_ref || "");
    if (!ref.startsWith("sale:") && !ref.startsWith("inv:")) continue;
    const projectKey = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
    const label =
      String(sale.project_label || "").trim() ||
      String(sale.notes || "")
        .split("—")[0]
        ?.trim() ||
      `مشروع ${projectKey.slice(0, 8)}`;

    const { data: newParty, error: createErr } = await client
      .from("customers")
      .insert({
        name: label,
        phone: null,
        notes: `فصل من دمج جسر · ${ref}`,
        balance: 0,
        opening_balance: 0,
        is_active: true,
      })
      .select("id, name")
      .single();
    if (createErr || !newParty) {
      throw new Error(createErr?.message || "تعذر إنشاء عميل للمشروع");
    }

    const related = rows.filter((r) => {
      if (movedIds.has(r.id)) return false;
      if (r.id === sale.id) return true;
      if (String(r.source_ref) === ref) return true;
      const pl = String(r.project_label || "").trim();
      if (pl && pl === label) return true;
      const notes = String(r.notes || "");
      if (label && notes.includes(label)) return true;
      const details = r.details;
      if (details && typeof details === "object") {
        if (String(details.project_id || "") === projectKey) return true;
        if (String(details.invoice_id || "") === projectKey) return true;
      }
      return false;
    });

    let moved = 0;
    for (const entry of related) {
      const sourceSystem = String(entry.source_system || "").toLowerCase();
      if (sourceSystem !== "aa" && sourceSystem !== "plisse") continue;
      await applyCrossAppLedgerEntryDirect(client, {
        sourceSystem: sourceSystem as WorkshopSourceSystem,
        sourceRef: String(entry.source_ref),
        partyType: "customer",
        partyId: String(newParty.id),
        entryType: entry.entry_type as LedgerEntryInput["entryType"],
        amount: Number(entry.amount) || 0,
        direction: entry.direction === "credit" ? "credit" : "debit",
        occurredAt: entry.occurred_at,
        notes: entry.notes,
        projectLabel: entry.project_label,
        details: {
          ...(entry.details && typeof entry.details === "object"
            ? entry.details
            : {}),
          split_from_party_id: storePartyId,
          project_id:
            (entry.details as { project_id?: string } | null)?.project_id ||
            (ref.startsWith("sale:") ? projectKey : undefined),
        },
      });
      movedIds.add(entry.id);
      moved += 1;
    }

    created.push({
      projectKey,
      projectLabel: label,
      newCustomerId: String(newParty.id),
      moved,
    });
  }

  return {
    created,
    leftoverEntries: rows.filter((r) => !movedIds.has(r.id)).length,
  };
}

/** Find store customers that have more than one workshop map (likely merges). */
export async function listMergedWorkshopCustomers(
  client: SupabaseClient,
  options?: { nameQuery?: string | null; limit?: number }
): Promise<
  Array<{
    store_party_id: string;
    name: string;
    phone: string | null;
    map_count: number;
    maps: WorkshopPartyMapRow[];
  }>
> {
  const limit = Math.min(50, Math.max(1, options?.limit || 20));
  const nameQuery = String(options?.nameQuery || "").trim();

  let custQ = client
    .from("customers")
    .select("id, name, phone")
    .eq("is_active", true)
    .order("name")
    .limit(200);
  if (nameQuery) {
    custQ = custQ.ilike("name", `%${nameQuery}%`);
  }
  const { data: customers, error: custErr } = await custQ;
  if (custErr) throw new Error(custErr.message);

  const results: Array<{
    store_party_id: string;
    name: string;
    phone: string | null;
    map_count: number;
    maps: WorkshopPartyMapRow[];
  }> = [];

  for (const c of customers || []) {
    const maps = await listWorkshopPartyMapsForStoreParty(client, {
      storePartyId: String(c.id),
      partyType: "customer",
    });
    if (maps.length < 2 && !nameQuery) continue;
    if (maps.length === 0) continue;
    results.push({
      store_party_id: String(c.id),
      name: String(c.name || ""),
      phone: (c.phone as string | null) || null,
      map_count: maps.length,
      maps,
    });
    if (results.length >= limit) break;
  }

  results.sort((a, b) => b.map_count - a.map_count);
  return results;
}

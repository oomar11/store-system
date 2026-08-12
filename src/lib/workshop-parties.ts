import type { SupabaseClient } from "@supabase/supabase-js";

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
};

export function normalizePartyPhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

function digitsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Egyptian mobiles: compare last 9–10 digits
  const aa = a.slice(-10);
  const bb = b.slice(-10);
  return aa.length >= 9 && bb.length >= 9 && aa.slice(-9) === bb.slice(-9);
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
    .select("id, name, phone, address, notes, balance, is_active, created_at")
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

  const { data, error } = await builder;
  if (error) throw new Error(error.message || "تعذر البحث");
  return (data || []) as StorePartyRow[];
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
      return {
        party: existing as StorePartyRow,
        created: false,
        mapped: true,
      };
    }
  }

  // 2) Match by phone then exact name
  let matchId: string | null = null;
  if (phoneNorm) {
    const { data: byPhone } = await client
      .from(table)
      .select("id, phone, phone_normalized")
      .eq("is_active", true)
      .limit(50);
    const hit = (byPhone || []).find((row) =>
      digitsMatch(
        normalizePartyPhone(row.phone_normalized || row.phone),
        phoneNorm
      )
    );
    if (hit) matchId = hit.id;
  }

  if (!matchId) {
    const { data: byName } = await client
      .from(table)
      .select("id")
      .eq("is_active", true)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (byName?.id) matchId = byName.id;
  }

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
  return /column ["']?details["']? of relation ["']?cross_app_ledger_entries["']? does not exist/i.test(
    message || ""
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
    input.details && typeof input.details === "object" && !Array.isArray(input.details)
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

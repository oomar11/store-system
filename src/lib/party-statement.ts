import type { SupabaseClient } from "@supabase/supabase-js";
import {
  invoiceTypeLabel,
  parseCrossAppDetails,
  type CrossAppLedgerLine,
} from "@/lib/history";
import { partyPaymentDocNumber } from "@/lib/party-payments";
import { roundMoney } from "@/lib/utils";
import {
  assemblePartyStatement,
  type PartyKind,
  type PartyStatement,
  type PartyStatementEvent,
  type StatementLine,
  type StatementParty,
  type StatementSource,
} from "./party-statement-core";

export {
  assemblePartyStatement,
  daysAgoIsoDate,
  debitCreditForPrimary,
  monthStartIsoDate,
  todayIsoDate,
  toWhatsAppDigits,
} from "./party-statement-core";
export type {
  PartyKind,
  PartyStatement,
  PartyStatementEvent,
  StatementLine,
  StatementParty,
  StatementRow,
  StatementSource,
} from "./party-statement-core";

type RawInvoice = {
  id: string;
  invoice_number: string;
  type: string;
  total: number;
  paid_amount: number;
  created_at: string;
  status: string;
  notes?: string | null;
  payment_method?: string | null;
};

type RawPayment = {
  id: string;
  party_type: PartyKind;
  amount: number;
  notes?: string | null;
  created_at: string;
  is_settlement?: boolean | null;
  safes?: { name?: string } | { name?: string }[] | null;
  party_payment_allocations?: {
    invoice_id?: string;
    amount: number;
    invoices?: { invoice_number?: string } | { invoice_number?: string }[] | null;
  }[];
};

type RawLedger = {
  id: string;
  source_system?: string | null;
  source_ref?: string | null;
  entry_type?: string | null;
  amount: number;
  direction?: string | null;
  occurred_at: string;
  notes?: string | null;
  project_label?: string | null;
  details?: unknown;
};

const PAGE = 1000;
const ITEM_CHUNK = 80;

function firstRel<T>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

function dayStart(date: string): string {
  return `${date}T00:00:00`;
}

async function fetchPaged<T>(makeQuery: () => unknown): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const query = makeQuery() as {
      range: (
        start: number,
        end: number
      ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
    };
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function workshopLines(raw: unknown): StatementLine[] {
  const details = parseCrossAppDetails(raw);
  const lines = details?.lines || [];
  return lines.map((line: CrossAppLedgerLine) => {
    const dims =
      line.width_cm != null && line.height_cm != null
        ? `${line.width_cm}×${line.height_cm} سم`
        : null;
    const area =
      line.area_m2 != null ? `${Number(line.area_m2).toFixed(2)} م²` : null;
    const extra = [line.system_label, line.handles_label, line.closure_label]
      .filter(Boolean)
      .join(" · ");
    return {
      name: line.product_name || "ضلفة",
      detail: [dims, area, extra, line.notes].filter(Boolean).join(" · ") || undefined,
      qty: area || undefined,
      unitPrice: line.unit_price ?? null,
      total: line.line_total ?? null,
    };
  });
}

function invoiceEvents(
  originKind: PartyKind,
  inv: RawInvoice,
  allocated: number
): PartyStatementEvent[] {
  const total = roundMoney(Number(inv.total) || 0);
  const paid = roundMoney(Number(inv.paid_amount) || 0);
  const cash = roundMoney(Math.max(0, paid - allocated));
  const isReturn = inv.type === "sale_return" || inv.type === "purchase_return";
  const invoiceSign = isReturn ? -1 : 1;
  const src: StatementSource = "store";
  const events: PartyStatementEvent[] = [
    {
      id: `inv-${inv.id}`,
      occurredAt: inv.created_at,
      sortRank: 0,
      originKind,
      type: inv.type,
      label: invoiceTypeLabel(inv.type, "store"),
      reference: inv.invoice_number,
      notes: inv.notes || null,
      signedOrigin: roundMoney(invoiceSign * total),
      sourceSystem: src,
      invoiceId: inv.id,
      lines: [],
    },
  ];
  if (cash >= 0.0005) {
    events.push({
      id: `inv-paid-${inv.id}`,
      occurredAt: inv.created_at,
      sortRank: 1,
      originKind,
      type: isReturn ? "return_refund" : "invoice_payment",
      label: isReturn ? "استرداد مع المرتجع" : "مدفوع مع الفاتورة",
      reference: inv.invoice_number,
      notes: null,
      signedOrigin: roundMoney(-invoiceSign * cash),
      sourceSystem: src,
      invoiceId: inv.id,
      lines: [],
    });
  }
  return events;
}

function paymentEvent(originKind: PartyKind, pay: RawPayment): PartyStatementEvent {
  const amount = roundMoney(Number(pay.amount) || 0);
  const isSettlement = Boolean(pay.is_settlement);
  const safe = firstRel(pay.safes);
  const allocs = pay.party_payment_allocations || [];
  const allocNote = allocs
    .map((a) => {
      const inv = firstRel(a.invoices);
      return `${inv?.invoice_number || "فاتورة"}: ${roundMoney(Number(a.amount)).toFixed(2)}`;
    })
    .join(" · ");
  return {
    id: `pay-${pay.id}`,
    occurredAt: pay.created_at,
    sortRank: 2,
    originKind,
    type: isSettlement
      ? "settlement"
      : originKind === "customer"
        ? "collection"
        : "disbursement",
    label: isSettlement
      ? "مقاصة"
      : originKind === "customer"
        ? "تحصيل"
        : "سداد",
    reference: isSettlement
      ? `مقاصة-${String(pay.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`
      : partyPaymentDocNumber(pay.id, originKind),
    notes: [pay.notes, allocNote ? `توزيع: ${allocNote}` : null, safe?.name]
      .filter(Boolean)
      .join(" — ") || null,
    signedOrigin: -amount,
    sourceSystem: "store",
    lines: [],
  };
}

function ledgerEvent(originKind: PartyKind, entry: RawLedger): PartyStatementEvent {
  const amount = roundMoney(Number(entry.amount) || 0);
  const isDebit = String(entry.direction || "") === "debit";
  const src: StatementSource =
    entry.source_system === "plisse" ? "plisse" : "aa";
  const details = parseCrossAppDetails(entry.details);
  const docNo =
    details?.invoice_number != null
      ? String(details.invoice_number)
      : String(entry.source_ref || "").slice(0, 24);
  const type = String(entry.entry_type || "workshop_adjustment");
  return {
    id: `xapp-${entry.id}`,
    occurredAt: String(entry.occurred_at || ""),
    sortRank: 0,
    originKind,
    type,
    label: invoiceTypeLabel(type, src),
    reference: docNo,
    notes:
      [entry.project_label, entry.notes].filter(Boolean).join(" — ") || null,
    signedOrigin: isDebit ? amount : -amount,
    sourceSystem: src,
    lines: workshopLines(entry.details),
  };
}

async function fetchPartyRow(
  client: SupabaseClient,
  kind: PartyKind,
  id: string
): Promise<StatementParty> {
  const table = kind === "customer" ? "customers" : "suppliers";
  const { data, error } = await client
    .from(table)
    .select("id, name, phone, address, balance, opening_balance")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("الطرف غير موجود");
  const row = data as {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
    balance?: number;
    opening_balance?: number;
  };
  return {
    id: row.id,
    kind,
    name: row.name,
    phone: row.phone || null,
    address: row.address || null,
    balance: Number(row.balance) || 0,
    openingBalance: Number(row.opening_balance) || 0,
  };
}

async function fetchSideEvents(
  client: SupabaseClient,
  kind: PartyKind,
  partyId: string,
  fromIso: string | null
): Promise<{ events: PartyStatementEvent[]; invoiceIds: string[] }> {
  const types =
    kind === "customer"
      ? ["sale", "sale_return"]
      : ["purchase", "purchase_return"];
  const partyCol = kind === "customer" ? "customer_id" : "supplier_id";

  const invoices = await fetchPaged<RawInvoice>(() => {
    let q = client
      .from("invoices")
      .select(
        "id, invoice_number, type, total, paid_amount, created_at, status, notes, payment_method"
      )
      .eq(partyCol, partyId)
      .in("type", types)
      .eq("status", "completed")
      .order("created_at", { ascending: true });
    if (fromIso) q = q.gte("created_at", fromIso);
    return q;
  });

  const payments = await fetchPaged<RawPayment>(() => {
    let q = client
      .from("party_payments")
      .select(
        "id, party_type, amount, notes, created_at, is_settlement, safes(name), party_payment_allocations(invoice_id, amount, invoices(invoice_number))"
      )
      .eq("party_type", kind)
      .eq("party_id", partyId)
      .order("created_at", { ascending: true });
    if (fromIso) q = q.gte("created_at", fromIso);
    return q;
  });

  let ledger: RawLedger[] = [];
  try {
    ledger = await fetchPaged<RawLedger>(() => {
      let q = client
        .from("cross_app_ledger_entries")
        .select(
          "id, source_system, source_ref, entry_type, amount, direction, occurred_at, notes, project_label, details"
        )
        .eq("party_type", kind)
        .eq("party_id", partyId)
        .order("occurred_at", { ascending: true });
      if (fromIso) q = q.gte("occurred_at", fromIso);
      return q;
    });
  } catch {
    ledger = await fetchPaged<RawLedger>(() => {
      let q = client
        .from("cross_app_ledger_entries")
        .select(
          "id, source_system, source_ref, entry_type, amount, direction, occurred_at, notes, project_label"
        )
        .eq("party_type", kind)
        .eq("party_id", partyId)
        .order("occurred_at", { ascending: true });
      if (fromIso) q = q.gte("occurred_at", fromIso);
      return q;
    });
  }

  const allocatedByInvoice = new Map<string, number>();
  for (const pay of payments) {
    for (const a of pay.party_payment_allocations || []) {
      if (!a.invoice_id) continue;
      allocatedByInvoice.set(
        a.invoice_id,
        roundMoney((allocatedByInvoice.get(a.invoice_id) || 0) + Number(a.amount))
      );
    }
  }

  const events: PartyStatementEvent[] = [];
  const invoiceIds: string[] = [];
  for (const inv of invoices) {
    invoiceIds.push(inv.id);
    events.push(
      ...invoiceEvents(kind, inv, allocatedByInvoice.get(inv.id) || 0)
    );
  }
  for (const pay of payments) events.push(paymentEvent(kind, pay));
  for (const entry of ledger) events.push(ledgerEvent(kind, entry));
  return { events, invoiceIds };
}

async function fetchInvoiceLines(
  client: SupabaseClient,
  invoiceIds: string[]
): Promise<Map<string, StatementLine[]>> {
  const map = new Map<string, StatementLine[]>();
  if (invoiceIds.length === 0) return map;
  for (let i = 0; i < invoiceIds.length; i += ITEM_CHUNK) {
    const chunk = invoiceIds.slice(i, i + ITEM_CHUNK);
    const { data, error } = await client
      .from("invoice_items")
      .select("id, invoice_id, quantity, unit_price, discount, total, product:products(name, sku)")
      .in("invoice_id", chunk)
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const rec = row as {
        invoice_id: string;
        quantity: number;
        unit_price: number;
        total: number;
        product?: { name?: string; sku?: string } | { name?: string; sku?: string }[] | null;
      };
      const product = firstRel(rec.product);
      const line: StatementLine = {
        name: product?.name || "صنف",
        detail: product?.sku || undefined,
        qty: String(Number(rec.quantity) || 0),
        unitPrice: Number(rec.unit_price) || 0,
        total: Number(rec.total) || 0,
      };
      const list = map.get(rec.invoice_id) || [];
      list.push(line);
      map.set(rec.invoice_id, list);
    }
  }
  return map;
}

export async function buildPartyStatement(
  client: SupabaseClient,
  params: {
    kind: PartyKind;
    partyId: string;
    dateFrom?: string | null;
    dateTo?: string | null;
    includeLines?: boolean;
  }
): Promise<PartyStatement> {
  const kind = params.kind;
  const dateFrom = params.dateFrom?.trim() || null;
  const dateTo = params.dateTo?.trim() || null;
  const includeLines = params.includeLines !== false;
  const fromIso = dateFrom ? dayStart(dateFrom) : null;

  const table = kind === "customer" ? "customers" : "suppliers";
  const linkCol =
    kind === "customer" ? "linked_supplier_id" : "linked_customer_id";
  const { data: rawParty, error: partyErr } = await client
    .from(table)
    .select(
      `id, name, phone, address, balance, opening_balance, ${linkCol}`
    )
    .eq("id", params.partyId)
    .maybeSingle();
  if (partyErr) throw new Error(partyErr.message);
  if (!rawParty) throw new Error("الطرف غير موجود");

  const party: StatementParty = {
    id: rawParty.id as string,
    kind,
    name: String(rawParty.name),
    phone: (rawParty.phone as string | null) || null,
    address: (rawParty.address as string | null) || null,
    balance: Number(rawParty.balance) || 0,
    openingBalance: Number(rawParty.opening_balance) || 0,
  };

  let linkedParty: StatementParty | null = null;
  const linkedId =
    kind === "customer"
      ? ((rawParty as { linked_supplier_id?: string | null }).linked_supplier_id ||
        null)
      : ((rawParty as { linked_customer_id?: string | null }).linked_customer_id ||
        null);
  if (linkedId) {
    linkedParty = await fetchPartyRow(
      client,
      kind === "customer" ? "supplier" : "customer",
      linkedId
    );
  }

  const primary = await fetchSideEvents(client, kind, party.id, fromIso);
  let events = primary.events;
  let invoiceIds = [...primary.invoiceIds];
  if (linkedParty) {
    const secondary = await fetchSideEvents(
      client,
      linkedParty.kind,
      linkedParty.id,
      fromIso
    );
    events = [...events, ...secondary.events];
    invoiceIds = [...invoiceIds, ...secondary.invoiceIds];
  }

  if (includeLines) {
    const linesByInvoice = await fetchInvoiceLines(client, invoiceIds);
    events = events.map((ev) => {
      if (!ev.invoiceId || ev.lines.length > 0) return ev;
      if (ev.type === "invoice_payment" || ev.type === "return_refund") return ev;
      const lines = linesByInvoice.get(ev.invoiceId);
      return lines ? { ...ev, lines } : ev;
    });
  } else {
    events = events.map((ev) => ({ ...ev, lines: [] }));
  }

  return assemblePartyStatement({
    kind,
    party,
    linkedParty,
    dateFrom,
    dateTo,
    events,
  });
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUSINESS_LINE_LABELS,
  type BusinessLine,
} from "@/lib/business-lines";

export type ProjectReceivableSource = "wire" | "workshop" | "store";

export type ProjectReceivableRow = {
  id: string;
  source: ProjectReceivableSource;
  sourceLabel: string;
  projectKey: string;
  projectLabel: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  sale: number;
  paid: number;
  remaining: number;
  occurredAt: string | null;
};

export type ProjectReceivablesTotals = {
  sale: number;
  paid: number;
  remaining: number;
  owedCount: number;
};

type LedgerRow = {
  id: string;
  party_id: string;
  source_system: string;
  source_ref: string;
  entry_type: string;
  amount: number;
  direction: string;
  occurred_at: string | null;
  project_label: string | null;
  notes: string | null;
  details: Record<string, unknown> | null;
};

type CustomerLite = {
  id: string;
  name: string;
  phone: string | null;
};

type Acc = {
  source: ProjectReceivableSource;
  projectKey: string;
  projectLabel: string;
  /** Raw ledger project_label used to match aa collections (never reformatted). */
  matchLabel: string;
  customerId: string;
  sale: number;
  paid: number;
  occurredAt: string | null;
};

function sourceLabel(source: ProjectReceivableSource): string {
  if (source === "wire") return BUSINESS_LINE_LABELS.wire;
  if (source === "workshop") return BUSINESS_LINE_LABELS.workshop;
  return BUSINESS_LINE_LABELS.store;
}

function parseProjectKey(
  sourceRef: string
): { kind: "sale" | "inv" | "pay" | "other"; key: string } {
  const ref = String(sourceRef || "").trim();
  if (ref.startsWith("sale:")) {
    return { kind: "sale", key: ref.slice(5) };
  }
  if (ref.startsWith("inv:")) {
    return { kind: "inv", key: ref.slice(4) };
  }
  if (ref.startsWith("pay:")) {
    return { kind: "pay", key: ref.slice(4) };
  }
  return { kind: "other", key: ref };
}

function invoiceNumberFromDetails(
  details: Record<string, unknown> | null
): string | null {
  if (!details || typeof details !== "object") return null;
  const n = details.invoice_number;
  if (n == null) return null;
  const s = String(n).trim();
  return s || null;
}

function detailString(
  details: Record<string, unknown> | null,
  ...keys: string[]
): string | null {
  if (!details || typeof details !== "object") return null;
  for (const key of keys) {
    const v = details[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** Allocate paid amounts FIFO across sale rows (legacy fallback only). */
function allocateFifo(targets: Acc[], paidTotal: number) {
  let left = Math.max(0, paidTotal);
  const ordered = [...targets].sort((a, b) => {
    const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    return ta - tb;
  });
  for (const acc of ordered) {
    if (left <= 0) break;
    const need = Math.max(0, acc.sale - acc.paid);
    const take = Math.min(need, left);
    acc.paid += take;
    left -= take;
  }
  return left;
}

/**
 * Build per-project / per-invoice outstanding rows across workshops + store credit.
 */
export async function listProjectReceivables(
  client: SupabaseClient,
  options?: {
    customerId?: string | null;
    onlyOwed?: boolean;
    source?: ProjectReceivableSource | "all" | BusinessLine;
  }
): Promise<{
  rows: ProjectReceivableRow[];
  totals: ProjectReceivablesTotals;
}> {
  const customerId = String(options?.customerId || "").trim() || null;
  const onlyOwed = options?.onlyOwed !== false;
  const sourceFilter = options?.source || "all";

  let ledgerRows: LedgerRow[] = [];
  {
    let ledgerQ = client
      .from("cross_app_ledger_entries")
      .select(
        "id, party_id, source_system, source_ref, entry_type, amount, direction, occurred_at, project_label, notes, details"
      )
      .eq("party_type", "customer")
      .in("entry_type", [
        "workshop_sale",
        "workshop_collection",
        "workshop_adjustment",
      ]);
    if (customerId) ledgerQ = ledgerQ.eq("party_id", customerId);
    let ledgerRes = await ledgerQ;
    if (ledgerRes.error && /details/i.test(ledgerRes.error.message || "")) {
      let retry = client
        .from("cross_app_ledger_entries")
        .select(
          "id, party_id, source_system, source_ref, entry_type, amount, direction, occurred_at, project_label, notes"
        )
        .eq("party_type", "customer")
        .in("entry_type", [
          "workshop_sale",
          "workshop_collection",
          "workshop_adjustment",
        ]);
      if (customerId) retry = retry.eq("party_id", customerId);
      ledgerRes = (await retry) as typeof ledgerRes;
    }
    if (ledgerRes.error) {
      throw new Error(ledgerRes.error.message || "تعذر قراءة دفتر الورش");
    }
    ledgerRows = ((ledgerRes.data || []) as LedgerRow[]).map((row) => ({
      ...row,
      details: row.details ?? null,
    }));
  }

  let invoicesQ = client
    .from("invoices")
    .select(
      "id, invoice_number, customer_id, total, paid_amount, created_at, status, type"
    )
    .eq("status", "completed")
    .eq("type", "sale");
  if (customerId) invoicesQ = invoicesQ.eq("customer_id", customerId);

  const invoicesRes = await invoicesQ;
  if (invoicesRes.error) {
    throw new Error(invoicesRes.error.message || "تعذر قراءة فواتير المحل");
  }

  const ledger = ledgerRows;
  const partyIds = new Set<string>();
  for (const row of ledger) partyIds.add(String(row.party_id));
  for (const inv of invoicesRes.data || []) {
    if (inv.customer_id) partyIds.add(String(inv.customer_id));
  }

  const customersById = new Map<string, CustomerLite>();
  if (partyIds.size > 0) {
    const { data: customers, error: custErr } = await client
      .from("customers")
      .select("id, name, phone")
      .in("id", Array.from(partyIds));
    if (custErr) {
      throw new Error(custErr.message || "تعذر قراءة العملاء");
    }
    for (const c of customers || []) {
      customersById.set(String(c.id), {
        id: String(c.id),
        name: String(c.name || "عميل"),
        phone: (c.phone as string | null) ?? null,
      });
    }
  }

  const byProject = new Map<string, Acc>();
  /** aa collections keyed by party + project_id (preferred) */
  const aaCollectionsByProjectId = new Map<string, number>();
  /** aa collections keyed by source + party + project_label (legacy fallback) */
  const aaCollectionsByLabel = new Map<string, number>();
  /** plisse collections keyed by party + invoice_id */
  const wireCollectionsByInvoiceId = new Map<string, number>();
  /** plisse collections without invoice_id — FIFO leftover per party */
  const wireCollectionsByParty = new Map<string, number>();

  for (const row of ledger) {
    const sys = String(row.source_system || "").toLowerCase();
    const source: ProjectReceivableSource =
      sys === "plisse" ? "wire" : "workshop";
    const amount = Math.max(0, Number(row.amount) || 0);
    const parsed = parseProjectKey(row.source_ref);
    const label = String(row.project_label || "").trim();
    const invNo = invoiceNumberFromDetails(row.details);
    const partyKey = String(row.party_id || "").trim();
    if (!partyKey) continue;
    // Never mix another customer's rows into this view.
    if (customerId && partyKey !== customerId) continue;

    if (
      row.entry_type === "workshop_sale" ||
      (row.entry_type === "workshop_adjustment" && row.direction === "debit")
    ) {
      if (parsed.kind === "pay") continue;
      // Include party_id so identical source_ref across customers never merges.
      const mapKey = `${partyKey}:${source}:${parsed.kind}:${parsed.key}`;
      const existing = byProject.get(mapKey);
      const occurredAt = row.occurred_at || existing?.occurredAt || null;
      let projectLabel = existing?.projectLabel || "";
      if (invNo) projectLabel = `فاتورة ${invNo}`;
      else if (source === "workshop" && label) projectLabel = label;
      else if (!projectLabel) {
        projectLabel =
          parsed.kind === "inv"
            ? `فاتورة بلسية ${parsed.key.slice(0, 8)}`
            : parsed.kind === "sale"
              ? label || `مشروع ${parsed.key.slice(0, 8)}`
              : label || parsed.key.slice(0, 12);
      }
      byProject.set(mapKey, {
        source,
        projectKey: parsed.key,
        projectLabel,
        matchLabel: existing?.matchLabel || label || "_",
        customerId: partyKey,
        sale:
          (existing?.sale || 0) + (row.direction === "debit" ? amount : 0),
        paid: existing?.paid || 0,
        occurredAt,
      });
      continue;
    }

    if (
      row.entry_type === "workshop_collection" ||
      (row.entry_type === "workshop_adjustment" && row.direction === "credit")
    ) {
      const credit = row.direction === "credit" ? amount : 0;
      if (credit <= 0) continue;
      if (source === "wire") {
        const invoiceId =
          detailString(row.details, "invoice_id") ||
          (parsed.kind === "pay" ? null : parsed.kind === "inv" ? parsed.key : null);
        if (invoiceId) {
          const key = `${partyKey}::${invoiceId}`;
          wireCollectionsByInvoiceId.set(
            key,
            (wireCollectionsByInvoiceId.get(key) || 0) + credit
          );
        } else {
          wireCollectionsByParty.set(
            partyKey,
            (wireCollectionsByParty.get(partyKey) || 0) + credit
          );
        }
      } else {
        const projectId = detailString(row.details, "project_id");
        if (projectId) {
          const key = `${partyKey}::${projectId}`;
          aaCollectionsByProjectId.set(
            key,
            (aaCollectionsByProjectId.get(key) || 0) + credit
          );
        } else {
          // Legacy: match aa payments to sales by raw project_label.
          const labelKey = `${source}::${partyKey}::${label || "_"}`;
          aaCollectionsByLabel.set(
            labelKey,
            (aaCollectionsByLabel.get(labelKey) || 0) + credit
          );
        }
      }
    }
  }

  // Attach aa collections by project_id first, then legacy label.
  for (const acc of byProject.values()) {
    if (acc.source !== "workshop") continue;
    const idKey = `${acc.customerId}::${acc.projectKey}`;
    const byId = aaCollectionsByProjectId.get(idKey) || 0;
    if (byId > 0) {
      acc.paid += byId;
      aaCollectionsByProjectId.delete(idKey);
    }
    const labelKey = `workshop::${acc.customerId}::${acc.matchLabel || "_"}`;
    const byLabel = aaCollectionsByLabel.get(labelKey) || 0;
    if (byLabel > 0) {
      acc.paid += byLabel;
      aaCollectionsByLabel.delete(labelKey);
    }
  }

  // Plisse: attach by invoice_id, then FIFO leftover without invoice_id.
  for (const acc of byProject.values()) {
    if (acc.source !== "wire") continue;
    const idKey = `${acc.customerId}::${acc.projectKey}`;
    const byId = wireCollectionsByInvoiceId.get(idKey) || 0;
    if (byId > 0) {
      acc.paid += byId;
      wireCollectionsByInvoiceId.delete(idKey);
    }
  }

  const wireByParty = new Map<string, Acc[]>();
  for (const acc of byProject.values()) {
    if (acc.source !== "wire") continue;
    const list = wireByParty.get(acc.customerId) || [];
    list.push(acc);
    wireByParty.set(acc.customerId, list);
  }
  for (const [pid, paidTotal] of wireCollectionsByParty.entries()) {
    const targets = wireByParty.get(pid) || [];
    const leftover = allocateFifo(targets, paidTotal);
    if (leftover > 0.0005 && targets.length === 0) {
      byProject.set(`${pid}:wire:orphan:pay`, {
        source: "wire",
        projectKey: `pay:${pid}`,
        projectLabel: "تحصيل سلك",
        matchLabel: "_",
        customerId: pid,
        sale: 0,
        paid: leftover,
        occurredAt: null,
      });
    }
  }

  // Orphan plisse collections with invoice_id but no matching sale
  for (const [idKey, paid] of wireCollectionsByInvoiceId.entries()) {
    if (paid <= 0) continue;
    const parts = idKey.split("::");
    const cid = parts[0] || "";
    const invId = parts[1] || "";
    if (customerId && cid !== customerId) continue;
    byProject.set(`${cid}:wire:orphan:${invId}`, {
      source: "wire",
      projectKey: invId || `pay:${cid}`,
      projectLabel: invId
        ? `تحصيل فاتورة ${invId.slice(0, 8)}`
        : "تحصيل سلك",
      matchLabel: "_",
      customerId: cid,
      sale: 0,
      paid,
      occurredAt: null,
    });
  }

  // Orphan aa collections by project_id
  for (const [idKey, paid] of aaCollectionsByProjectId.entries()) {
    if (paid <= 0) continue;
    const parts = idKey.split("::");
    const cid = parts[0] || "";
    const projectId = parts[1] || "";
    if (customerId && cid !== customerId) continue;
    byProject.set(`${cid}:workshop:orphan:id:${projectId}`, {
      source: "workshop",
      projectKey: projectId || `pay:${cid}`,
      projectLabel: projectId
        ? `تحصيل مشروع ${projectId.slice(0, 8)}`
        : "تحصيل بدون مشروع",
      matchLabel: "_",
      customerId: cid,
      sale: 0,
      paid,
      occurredAt: null,
    });
  }

  // Orphan aa collections by label
  for (const [labelKey, paid] of aaCollectionsByLabel.entries()) {
    if (paid <= 0) continue;
    const parts = labelKey.split("::");
    const cid = parts[1] || "";
    const label = parts.slice(2).join("::");
    if (customerId && cid !== customerId) continue;
    byProject.set(`${cid}:workshop:orphan:${label}`, {
      source: "workshop",
      projectKey: `pay:${label || cid}`,
      projectLabel: label === "_" ? "تحصيل بدون مشروع" : label,
      matchLabel: label || "_",
      customerId: cid,
      sale: 0,
      paid,
      occurredAt: null,
    });
  }

  const rows: ProjectReceivableRow[] = [];

  for (const [mapKey, acc] of byProject.entries()) {
    if (customerId && acc.customerId !== customerId) continue;
    if (sourceFilter !== "all" && acc.source !== sourceFilter) continue;
    const remaining = Math.max(0, acc.sale - acc.paid);
    if (onlyOwed && remaining <= 0.0005) continue;
    const customer = customersById.get(acc.customerId);
    rows.push({
      id: mapKey,
      source: acc.source,
      sourceLabel: sourceLabel(acc.source),
      projectKey: acc.projectKey,
      projectLabel: acc.projectLabel,
      customerId: acc.customerId,
      customerName: customer?.name || "عميل",
      customerPhone: customer?.phone || "",
      sale: acc.sale,
      paid: acc.paid,
      remaining,
      occurredAt: acc.occurredAt,
    });
  }

  if (sourceFilter === "all" || sourceFilter === "store") {
    for (const inv of invoicesRes.data || []) {
      const cid = String(inv.customer_id || "").trim();
      if (!cid) continue;
      if (customerId && cid !== customerId) continue;
      const total = Number(inv.total) || 0;
      const paid = Number(inv.paid_amount) || 0;
      const remaining = Math.max(0, total - paid);
      if (onlyOwed && remaining <= 0.0005) continue;
      const customer = customersById.get(cid);
      rows.push({
        id: `${cid}:store:inv:${inv.id}`,
        source: "store",
        sourceLabel: sourceLabel("store"),
        projectKey: String(inv.id),
        projectLabel: `فاتورة ${inv.invoice_number || String(inv.id).slice(0, 8)}`,
        customerId: cid,
        customerName: customer?.name || "عميل",
        customerPhone: customer?.phone || "",
        sale: total,
        paid,
        remaining,
        occurredAt: inv.created_at || null,
      });
    }
  }

  rows.sort((a, b) => {
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    return tb - ta;
  });

  const totals: ProjectReceivablesTotals = {
    sale: rows.reduce((s, r) => s + r.sale, 0),
    paid: rows.reduce((s, r) => s + r.paid, 0),
    remaining: rows.reduce((s, r) => s + r.remaining, 0),
    owedCount: rows.filter((r) => r.remaining > 0.0005).length,
  };

  return { rows, totals };
}

export async function listCustomerProjectReceivables(
  client: SupabaseClient,
  customerId: string
): Promise<ProjectReceivableRow[]> {
  const id = String(customerId || "").trim();
  if (!id) return [];
  const { rows } = await listProjectReceivables(client, {
    customerId: id,
    onlyOwed: true,
    source: "all",
  });
  // Hard guard: never surface another customer's projects on the party page.
  return rows.filter((row) => row.customerId === id);
}

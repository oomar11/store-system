import type { SupabaseClient } from "@supabase/supabase-js";
import {
  entityTable,
  getMeta,
  getOfflineDb,
  putEntity,
  requestPersistentStorage,
  setMeta,
  toLocalRow,
  type EntityStoreName,
} from "@/lib/offline/db";
import {
  applyServerTime,
  deviceLabel,
  getDeviceState,
  getOrCreateDeviceId,
  persistLastHlc,
  updateDeviceState,
} from "@/lib/offline/device";
import {
  compareHlc,
  isClockSkewUnsafe,
  parseHlc,
  receiveHlc,
  type Hlc,
} from "@/lib/offline/hlc";
import { isEffectivelyOnline } from "@/lib/offline/local-first";
import {
  listSyncOutbox,
  markOutboxSynced,
  updateOutboxStatus,
} from "@/lib/offline/outbox";
import { DATA_PACK_VERSION } from "@/lib/offline/pack-version";
import type { SyncChangeRow, SyncOutboxEntry } from "@/lib/offline/types";
import { createCompletedInvoice } from "@/lib/create-invoice";
import {
  createExpense,
  deleteExpense,
  updateExpense,
} from "@/lib/expenses";
import { applyPartyPayment } from "@/lib/party-payments";

export type SyncResult = {
  synced: number;
  conflicts: number;
  failed: number;
  remaining: number;
  pulled: number;
  superseded: number;
  clockOk: boolean;
  driftMs?: number;
};

export type BootstrapProgress = {
  entity: string;
  entityIndex: number;
  entityTotal: number;
  pageRows: number;
  entityRows: number;
  label: string;
  percent: number;
};

let syncInFlight: Promise<SyncResult> | null = null;

const ENTITY_STORES: EntityStoreName[] = [
  "products",
  "categories",
  "customers",
  "suppliers",
  "safes",
  "invoices",
  "invoice_items",
  "documents",
  "document_items",
  "settings",
  "shifts",
  "party_payments",
  "party_payment_allocations",
  "accounts",
  "journal_entries",
  "journal_lines",
  "safe_transactions",
  "inventory_counts",
  "inventory_count_items",
  "price_tiers",
  "product_tier_prices",
  "tier_category_discounts",
  "tier_product_discounts",
  "profiles",
  "audit_logs",
];

const ENTITY_LABELS: Record<string, string> = {
  profiles: "المستخدمون",
  categories: "التصنيفات",
  products: "الأصناف",
  customers: "العملاء",
  suppliers: "الموردون",
  safes: "الخزائن",
  settings: "الإعدادات",
  accounts: "الحسابات",
  price_tiers: "شرائح الأسعار",
  product_tier_prices: "أسعار الشرائح",
  tier_category_discounts: "خصومات التصنيف",
  tier_product_discounts: "خصومات الأصناف",
  documents: "المستندات",
  document_items: "بنود المستندات",
  invoices: "الفواتير",
  invoice_items: "بنود الفواتير",
  party_payments: "المدفوعات",
  party_payment_allocations: "توزيع المدفوعات",
  journal_entries: "القيود",
  journal_lines: "بنود القيود",
  safe_transactions: "حركات الخزنة",
  shifts: "الورديات",
  inventory_counts: "الجرد",
  inventory_count_items: "بنود الجرد",
  audit_logs: "سجل التدقيق",
};

function isEntityStore(name: string): name is EntityStoreName {
  return (ENTITY_STORES as string[]).includes(name);
}

type BootstrapCheckpoint = {
  pack_version: number;
  since: string;
  entity_index: number;
  cursor: string | null;
  entity_rows: number;
  counts: Record<string, number>;
  checkpoint: number;
};

async function loadBootstrapCheckpoint(): Promise<BootstrapCheckpoint | null> {
  const raw = await getMeta("bootstrap_checkpoint");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BootstrapCheckpoint;
  } catch {
    return null;
  }
}

async function saveBootstrapCheckpoint(cp: BootstrapCheckpoint): Promise<void> {
  await setMeta("bootstrap_checkpoint", JSON.stringify(cp));
}

async function revokeOfflineUserIfInactive(
  profile: Record<string, unknown>
): Promise<void> {
  if (profile.is_active !== false) return;
  const userId = String(profile.id || "");
  if (!userId) return;
  try {
    const { revokeOfflineCredentialByUserId } = await import(
      "@/lib/offline/auth-session"
    );
    await revokeOfflineCredentialByUserId(userId);
  } catch {
    /* auth module may not be ready */
  }
}

async function applyChangeLocally(change: SyncChangeRow): Promise<void> {
  const db = getOfflineDb();
  const deviceId = await getOrCreateDeviceId();
  const remoteHlc: Hlc = {
    physicalMs: change.hlc_physical_ms,
    counter: change.hlc_counter,
    deviceId: change.hlc_device_id,
  };
  receiveHlc(remoteHlc, deviceId);
  await persistLastHlc(remoteHlc);

  if (!isEntityStore(change.entity_type)) {
    if (change.deleted || change.op_kind === "delete") {
      await db.tombstones.put({
        entity_type: change.entity_type,
        entity_id: change.entity_id,
        hlc_physical_ms: change.hlc_physical_ms,
        hlc_counter: change.hlc_counter,
        hlc_device_id: change.hlc_device_id,
        deleted_at: new Date().toISOString(),
        server_seq: change.server_seq,
      });
    }
    return;
  }

  const table = entityTable(change.entity_type);
  const existing = await table.get(change.entity_id);
  if (existing) {
    const localHlc = parseHlc({
      last_hlc_physical_ms: existing.last_hlc_physical_ms,
      last_hlc_counter: existing.last_hlc_counter,
      last_hlc_device_id: existing.last_hlc_device_id,
    });
    if (localHlc && compareHlc(remoteHlc, localHlc) < 0) {
      return;
    }
  }

  if (change.deleted || change.op_kind === "delete") {
    const now = new Date().toISOString();
    await table.put({
      id: change.entity_id,
      data: { ...(existing?.data || { id: change.entity_id }), deleted_at: now },
      sync_version: change.version,
      deleted_at: now,
      last_hlc_physical_ms: change.hlc_physical_ms,
      last_hlc_counter: change.hlc_counter,
      last_hlc_device_id: change.hlc_device_id,
      updated_at: now,
    });
    await db.tombstones.put({
      entity_type: change.entity_type,
      entity_id: change.entity_id,
      hlc_physical_ms: change.hlc_physical_ms,
      hlc_counter: change.hlc_counter,
      hlc_device_id: change.hlc_device_id,
      deleted_at: now,
      server_seq: change.server_seq,
    });

    if (change.entity_type === "profiles") {
      await revokeOfflineUserIfInactive({
        id: change.entity_id,
        is_active: false,
      });
    }

    const pending = await db.outbox
      .where("status")
      .anyOf(["pending", "syncing", "conflict"])
      .toArray();
    for (const op of pending) {
      if (op.entity_type === change.entity_type && op.entity_id === change.entity_id) {
        const opHlc: Hlc = {
          physicalMs: op.hlc_physical_ms,
          counter: op.hlc_counter,
          deviceId: op.hlc_device_id,
        };
        if (compareHlc(opHlc, remoteHlc) < 0) {
          await updateOutboxStatus(op.id, {
            status: "superseded",
            lastError: "تجاوزتها عملية أحدث على السيرفر (حذف/تعديل)",
          });
        }
      }
    }
    return;
  }

  if (change.row_data) {
    const row = toLocalRow({
      ...change.row_data,
      id: change.entity_id,
      sync_version: change.version,
      last_hlc_physical_ms: change.hlc_physical_ms,
      last_hlc_counter: change.hlc_counter,
      last_hlc_device_id: change.hlc_device_id,
      deleted_at: null,
    });
    await table.put(row);
    if (change.entity_type === "profiles") {
      await revokeOfflineUserIfInactive(change.row_data);
    }
  }
}

async function pullChanges(
  supabase: SupabaseClient,
  afterSeq: number
): Promise<{ pulled: number; checkpoint: number }> {
  let checkpoint = afterSeq;
  let pulled = 0;
  let hasMore = true;
  const deviceId = await getOrCreateDeviceId();

  while (hasMore) {
    const { data, error } = await supabase.rpc("sync_pull_changes", {
      p_device_id: deviceId,
      p_after_seq: checkpoint,
      p_limit: 500,
    });
    if (error) throw new Error(error.message);
    const body = data as {
      changes?: SyncChangeRow[];
      checkpoint?: number;
      server_ms?: number;
      has_more?: boolean;
    };
    if (body.server_ms) await applyServerTime(body.server_ms);
    const changes = body.changes || [];
    for (const ch of changes) {
      await applyChangeLocally(ch);
      pulled += 1;
    }
    checkpoint = Number(body.checkpoint ?? checkpoint);
    hasMore = Boolean(body.has_more) && changes.length > 0;
    if (!changes.length) hasMore = false;
  }

  await updateDeviceState({
    checkpoint,
    last_sync_at: new Date().toISOString(),
  });
  return { pulled, checkpoint };
}

async function pushDomainOp(
  supabase: SupabaseClient,
  entry: SyncOutboxEntry
): Promise<"synced" | "conflict" | "failed" | "superseded"> {
  if (entry.domain_op === "create_invoice") {
    const p = entry.payload;
    const result = await createCompletedInvoice(supabase, {
      type: p.type as "sale" | "purchase" | "sale_return" | "purchase_return",
      items: (p.items as Array<Record<string, unknown>>).map((item) => ({
        product_id: String(item.product_id),
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        unit_cost: Number(item.unit_cost ?? 0),
        discount: Number(item.discount ?? 0),
        total: Number(item.total),
      })),
      subtotal: Number(p.subtotal),
      taxAmount: Number(p.taxAmount ?? 0),
      discountAmount: Number(p.discountAmount ?? 0),
      total: Number(p.total),
      paidAmount: Number(p.paidAmount),
      paymentMethod: (p.paymentMethod as "cash" | "credit") || "cash",
      customerId: (p.customerId as string) || null,
      supplierId: (p.supplierId as string) || null,
      safeId: (p.safeId as string) || null,
      notes: (p.notes as string) || null,
      createdAt: (p.occurredAt as string) || entry.created_at,
      originalInvoiceId: (p.originalInvoiceId as string) || null,
      clientOpId: entry.id,
      forWorkshop: Boolean(p.forWorkshop),
    });
    await markOutboxSynced(entry.id, {
      id: result.id,
      invoice_number: result.invoice_number,
      number: result.invoice_number,
    });
    const db = getOfflineDb();
    await db.idMap.put({
      local_id: String(p.tempNumber || entry.id),
      remote_id: result.id,
      remote_number: result.invoice_number,
      kind: "invoice",
      updated_at: new Date().toISOString(),
    });
    return "synced";
  }

  if (entry.domain_op === "party_payment") {
    const p = entry.payload;
    const result = await applyPartyPayment(supabase, {
      kind: p.kind as "customer" | "supplier",
      partyId: String(p.partyId),
      partyName: p.partyName as string | undefined,
      amount: Number(p.amount),
      safeId: String(p.safeId),
      notes: (p.notes as string) || undefined,
      createdAt: (p.occurredAt as string) || entry.created_at,
    });
    await markOutboxSynced(entry.id, {
      id: result.paymentId,
      number: String(p.tempNumber || result.paymentId),
    });
    return "synced";
  }

  if (entry.domain_op === "expense" || entry.domain_op === "expense_create") {
    const p = entry.payload;
    const { data, error } = await createExpense(supabase, {
      date: String(p.date),
      amount: Number(p.amount),
      description: String(p.description),
      notes: (p.notes as string) || null,
      expenseAccountId: String(p.expenseAccountId),
      safeId: String(p.safeId),
      createdAt: (p.occurredAt as string) || entry.created_at,
    });
    if (error || !data) throw new Error(error || "تعذر حفظ المصروف");
    await markOutboxSynced(entry.id, {
      id: data.entry_id,
      number: data.entry_number,
    });
    const db = getOfflineDb();
    const localId = String(p.localEntryId || entry.entity_id || entry.id);
    await db.idMap.put({
      local_id: localId,
      remote_id: data.entry_id,
      remote_number: data.entry_number,
      kind: "expense",
      updated_at: new Date().toISOString(),
    });
    // Remap local journal row to server id when different
    if (localId !== data.entry_id) {
      const localEntry = await db.journal_entries.get(localId);
      if (localEntry) {
        await db.journal_entries.delete(localId);
        await putEntity("journal_entries", {
          ...localEntry.data,
          id: data.entry_id,
          entry_number: data.entry_number,
        });
      }
    } else {
      await putEntity("journal_entries", {
        id: data.entry_id,
        entry_number: data.entry_number,
        date: data.date,
        description: data.description,
        notes: data.notes || null,
        created_at: data.created_at,
        created_by: data.created_by,
      });
    }
    return "synced";
  }

  if (entry.domain_op === "expense_update") {
    const p = entry.payload;
    const entryId = String(p.entryId || entry.entity_id);
    const { data, error } = await updateExpense(
      supabase,
      entryId,
      {
        date: String(p.date),
        amount: Number(p.amount),
        description: String(p.description),
        notes: (p.notes as string) || null,
        expenseAccountId: String(p.expenseAccountId),
        safeId: String(p.safeId),
        createdAt: (p.occurredAt as string) || entry.created_at,
      },
      p.before as
        | {
            entry_number: string;
            amount: number;
            description: string;
            notes?: string | null;
            safe_id: string;
            expense_account_id: string;
          }
        | undefined
    );
    if (error || !data) throw new Error(error || "تعذر تعديل المصروف");
    await markOutboxSynced(entry.id, {
      id: data.entry_id,
      number: data.entry_number,
    });
    return "synced";
  }

  if (entry.domain_op === "expense_delete") {
    const entryId = String(entry.payload.entryId || entry.entity_id);
    const { error } = await deleteExpense(supabase, entryId);
    if (error) throw new Error(error);
    await markOutboxSynced(entry.id, { id: entryId });
    return "synced";
  }

  if (entry.domain_op === "expense_account_create") {
    const p = entry.payload;
    const { createExpenseAccount } = await import("@/lib/expenses");
    const { data, error } = await createExpenseAccount(
      supabase,
      String(p.name || "")
    );
    if (error || !data) throw new Error(error || "تعذر إنشاء حساب المصروف");
    await markOutboxSynced(entry.id, { id: data.id, number: data.code });
    const localId = String(p.localId || entry.entity_id);
    if (localId !== data.id) {
      const db = getOfflineDb();
      await db.accounts.delete(localId);
      await putEntity("accounts", data as unknown as Record<string, unknown>);
      await db.idMap.put({
        local_id: localId,
        remote_id: data.id,
        remote_number: data.code,
        kind: "account",
        updated_at: new Date().toISOString(),
      });
    }
    return "synced";
  }

  if (entry.domain_op === "delete_invoice") {
    const { data, error } = await supabase.rpc("sync_push_batch", {
      p_ops: [
        {
          operation_id: entry.id,
          device_id: entry.device_id,
          entity_type: "invoices",
          entity_id: entry.entity_id,
          op_kind: "domain",
          domain_op: "delete_invoice",
          payload: entry.payload,
          base_version: entry.base_version,
          hlc_physical_ms: entry.hlc_physical_ms,
          hlc_counter: entry.hlc_counter,
          hlc_device_id: entry.hlc_device_id,
        },
      ],
    });
    if (error) throw new Error(error.message);
    const results = (data as { results?: Array<{ status?: string }> })?.results || [];
    const status = results[0]?.status || "applied";
    if (status === "superseded") {
      await updateOutboxStatus(entry.id, {
        status: "superseded",
        lastError: "عملية أحدث على السيرفر",
      });
      return "superseded";
    }
    await markOutboxSynced(entry.id, results[0] as Record<string, unknown>);
    return "synced";
  }

  const { data, error } = await supabase.rpc("sync_push_batch", {
    p_ops: [
      {
        operation_id: entry.id,
        device_id: entry.device_id,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        op_kind: entry.op_kind,
        domain_op: entry.domain_op,
        payload: entry.payload,
        base_version: entry.base_version,
        hlc_physical_ms: entry.hlc_physical_ms,
        hlc_counter: entry.hlc_counter,
        hlc_device_id: entry.hlc_device_id,
      },
    ],
  });
  if (error) throw new Error(error.message);
  const body = data as {
    results?: Array<{ status?: string; reason?: string }>;
    server_ms?: number;
  };
  if (body.server_ms) await applyServerTime(body.server_ms);
  const st = body.results?.[0]?.status || "applied";
  if (st === "superseded") {
    await updateOutboxStatus(entry.id, {
      status: "superseded",
      lastError: "عملية أحدث فازت (LWW)",
    });
    return "superseded";
  }
  if (st === "rejected") {
    await updateOutboxStatus(entry.id, {
      status: "rejected",
      lastError: body.results?.[0]?.reason || "مرفوضة",
    });
    return "conflict";
  }
  await markOutboxSynced(entry.id, body.results?.[0] as Record<string, unknown>);
  return "synced";
}

async function processOne(
  supabase: SupabaseClient,
  entry: SyncOutboxEntry
): Promise<"synced" | "conflict" | "failed" | "superseded"> {
  if (entry.status === "synced" || entry.status === "cancelled") return "synced";
  if (entry.status === "superseded") return "superseded";

  await updateOutboxStatus(entry.id, {
    status: "syncing",
    attempts: entry.attempts + 1,
  });

  try {
    return await pushDomainOp(supabase, entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const network =
      /fetch|network|timeout|Failed to fetch|offline|503/i.test(message);
    if (network) {
      await updateOutboxStatus(entry.id, {
        status: "pending",
        lastError: message,
      });
      return "failed";
    }
    await updateOutboxStatus(entry.id, {
      status: "conflict",
      lastError: message,
    });
    return "conflict";
  }
}

export async function getInstalledDataPackVersion(): Promise<number> {
  const raw = await getMeta("data_pack_version");
  const n = Number(raw || 0);
  return Number.isFinite(n) ? n : 0;
}

export async function needsBootstrapRefresh(): Promise<boolean> {
  const installed = await getInstalledDataPackVersion();
  if (installed < DATA_PACK_VERSION) return true;
  const complete = await getMeta("bootstrap_complete");
  if (complete !== "1") return true;
  const state = await getDeviceState();
  return !state?.bootstrapped_at;
}

/**
 * Paged year bootstrap with resumable checkpoint after each page.
 */
export async function bootstrapLocalData(
  supabase: SupabaseClient,
  options?: { onProgress?: (p: BootstrapProgress) => void }
): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  const persisted = await requestPersistentStorage();

  const { data: timeData } = await supabase.rpc("sync_server_time");
  if (timeData && typeof timeData === "object" && "server_ms" in timeData) {
    await applyServerTime(Number((timeData as { server_ms: number }).server_ms));
  }

  await supabase.rpc("sync_register_device", {
    p_device_id: deviceId,
    p_label: deviceLabel(),
    p_clock_offset_ms: 0,
  });

  const { data: entitiesRaw, error: entitiesErr } = await supabase.rpc(
    "sync_bootstrap_entities"
  );
  if (entitiesErr) throw new Error(entitiesErr.message);
  const entities = (Array.isArray(entitiesRaw) ? entitiesRaw : []) as Array<{
    entity: string;
    mode: string;
  }>;
  if (!entities.length) {
    throw new Error("قائمة كيانات التنزيل فارغة");
  }

  const sinceDefault = new Date(
    Date.now() - 365 * 24 * 60 * 60 * 1000
  ).toISOString();

  if (!(await needsBootstrapRefresh())) {
    const { data: snap } = await supabase.rpc("sync_bootstrap_snapshot");
    const checkpoint = Number(
      (snap as { checkpoint?: number } | null)?.checkpoint ?? 0
    );
    if ((snap as { server_ms?: number } | null)?.server_ms) {
      await applyServerTime(Number((snap as { server_ms: number }).server_ms));
    }
    const state = await getDeviceState();
    await updateDeviceState({
      checkpoint: Math.max(checkpoint, state?.checkpoint ?? 0),
      bootstrapped_at: state?.bootstrapped_at || new Date().toISOString(),
      last_sync_at: new Date().toISOString(),
      storage_persisted: persisted,
    });
    const { rebuildCompatSnapshot } = await import("@/lib/offline/snapshot");
    await rebuildCompatSnapshot();
    return;
  }

  let cp = await loadBootstrapCheckpoint();
  if (!cp || cp.pack_version !== DATA_PACK_VERSION) {
    cp = {
      pack_version: DATA_PACK_VERSION,
      since: sinceDefault,
      entity_index: 0,
      cursor: null,
      entity_rows: 0,
      counts: {},
      checkpoint: 0,
    };
    await setMeta("bootstrap_complete", "0");
    await saveBootstrapCheckpoint(cp);
  }

  const entityTotal = entities.length;
  let maxCheckpoint = cp.checkpoint || 0;

  for (let i = cp.entity_index; i < entityTotal; i++) {
    const entityName = entities[i].entity;
    if (!isEntityStore(entityName)) {
      cp = {
        ...cp,
        entity_index: i + 1,
        cursor: null,
        entity_rows: 0,
      };
      await saveBootstrapCheckpoint(cp);
      continue;
    }

    let cursor: string | null = i === cp.entity_index ? cp.cursor : null;
    let entityRows: number = i === cp.entity_index ? cp.entity_rows : 0;
    let hasMore = true;
    const storeName = entityName;
    const label = ENTITY_LABELS[entityName] || entityName;

    while (hasMore) {
      const { data, error } = await supabase.rpc("sync_bootstrap_page", {
        p_entity: entityName,
        p_since: entities[i].mode === "full" ? "1970-01-01T00:00:00Z" : cp.since,
        p_cursor: cursor,
        p_limit: 400,
      });
      if (error) throw new Error(error.message);
      const page = data as {
        rows?: unknown[];
        has_more?: boolean;
        next_cursor?: string | null;
        count?: number;
        checkpoint?: number;
        server_ms?: number;
        data_pack_version?: number;
      };
      if (page.server_ms) await applyServerTime(Number(page.server_ms));
      const rows = Array.isArray(page.rows) ? page.rows : [];
      for (const row of rows) {
        if (row && typeof row === "object") {
          await putEntity(storeName, row as Record<string, unknown>);
        }
      }
      entityRows += rows.length;
      maxCheckpoint = Math.max(maxCheckpoint, Number(page.checkpoint ?? 0));
      hasMore = Boolean(page.has_more);
      cursor = page.next_cursor ?? null;

      const percent = Math.min(
        95,
        Math.floor(((i + (hasMore ? 0.5 : 1)) / entityTotal) * 100)
      );
      options?.onProgress?.({
        entity: entityName,
        entityIndex: i,
        entityTotal,
        pageRows: rows.length,
        entityRows,
        label: `تنزيل ${label}… (${entityRows})`,
        percent,
      });

      cp = {
        ...cp,
        entity_index: i,
        cursor,
        entity_rows: entityRows,
        counts: { ...cp.counts, [entityName]: entityRows },
        checkpoint: maxCheckpoint,
      };
      await saveBootstrapCheckpoint(cp);

      if (!hasMore) break;
      if (!rows.length) break;
    }

    cp = {
      ...cp,
      entity_index: i + 1,
      cursor: null,
      entity_rows: 0,
      counts: { ...cp.counts, [entityName]: entityRows },
      checkpoint: maxCheckpoint,
    };
    await saveBootstrapCheckpoint(cp);
  }

  await updateDeviceState({
    checkpoint: maxCheckpoint,
    bootstrapped_at: new Date().toISOString(),
    last_sync_at: new Date().toISOString(),
    storage_persisted: persisted,
  });
  await setMeta("data_pack_version", String(DATA_PACK_VERSION));
  await setMeta("bootstrap_complete", "1");
  await setMeta("offline_ready_at", new Date().toISOString());
  await setMeta(
    "offline_pack_summary",
    JSON.stringify({
      ...cp.counts,
      checkpoint: maxCheckpoint,
      data_pack_version: DATA_PACK_VERSION,
      at: new Date().toISOString(),
    })
  );
  await setMeta("bootstrap_checkpoint", "");

  const { rebuildCompatSnapshot } = await import("@/lib/offline/snapshot");
  await rebuildCompatSnapshot();

  options?.onProgress?.({
    entity: "done",
    entityIndex: entityTotal,
    entityTotal,
    pageRows: 0,
    entityRows: 0,
    label: "اكتمل تنزيل بيانات آخر سنة",
    percent: 100,
  });
}

export async function syncOutbox(
  supabase: SupabaseClient
): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const result: SyncResult = {
      synced: 0,
      conflicts: 0,
      failed: 0,
      remaining: 0,
      pulled: 0,
      superseded: 0,
      clockOk: true,
    };

    if (!(await isEffectivelyOnline())) {
      result.remaining = (await listSyncOutbox()).length;
      return result;
    }

    if (isClockSkewUnsafe()) {
      result.clockOk = false;
      result.remaining = (await listSyncOutbox()).length;
      return result;
    }

    const deviceId = await getOrCreateDeviceId();
    const { data: timeData } = await supabase.rpc("sync_server_time");
    if (timeData && typeof timeData === "object" && "server_ms" in timeData) {
      const cal = await applyServerTime(
        Number((timeData as { server_ms: number }).server_ms)
      );
      result.driftMs = cal.driftMs;
      result.clockOk = cal.ok;
      if (!cal.ok) {
        result.remaining = (await listSyncOutbox()).length;
        return result;
      }
    }

    await supabase.rpc("sync_register_device", {
      p_device_id: deviceId,
      p_label: deviceLabel(),
      p_clock_offset_ms: 0,
    });

    if (await needsBootstrapRefresh()) {
      await bootstrapLocalData(supabase);
    }

    const pending = (await listSyncOutbox()).filter(
      (e) => e.status === "pending" || e.status === "syncing"
    );

    for (const entry of pending) {
      const status = await processOne(supabase, entry);
      if (status === "synced") result.synced += 1;
      else if (status === "superseded") result.superseded += 1;
      else if (status === "conflict") result.conflicts += 1;
      else {
        result.failed += 1;
        break;
      }
    }

    const state = await getDeviceState();
    const pull = await pullChanges(supabase, state?.checkpoint ?? 0);
    result.pulled = pull.pulled;

    const { rebuildCompatSnapshot } = await import("@/lib/offline/snapshot");
    await rebuildCompatSnapshot();

    result.remaining = (await listSyncOutbox()).length;
    await setMeta("last_sync_at", new Date().toISOString());
    return result;
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

export async function retryAndSync(
  supabase: SupabaseClient,
  id: string
): Promise<SyncResult> {
  await updateOutboxStatus(id, { status: "pending", lastError: null });
  return syncOutbox(supabase);
}

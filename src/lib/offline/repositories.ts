/**
 * Local-first repositories — read/write Dexie, enqueue sync ops.
 */
import {
  getEntity,
  listActiveEntities,
  putEntity,
  softDeleteEntity,
  type EntityStoreName,
} from "@/lib/offline/db";
import { enqueueSyncOp } from "@/lib/offline/outbox";
import { rebuildCompatSnapshot } from "@/lib/offline/snapshot";

async function upsertLocal(
  store: EntityStoreName,
  data: Record<string, unknown>,
  options?: { enqueue?: boolean }
): Promise<Record<string, unknown>> {
  const id = String(data.id || crypto.randomUUID());
  const row = { ...data, id, deleted_at: null };
  await putEntity(store, row);
  if (options?.enqueue !== false) {
    await enqueueSyncOp({
      entity_type: store,
      entity_id: id,
      op_kind: "upsert",
      payload: row,
    });
  }
  await rebuildCompatSnapshot();
  return row;
}

async function deleteLocal(
  store: EntityStoreName,
  id: string,
  options?: { enqueue?: boolean; domain_op?: string }
): Promise<void> {
  const deviceId = crypto.randomUUID(); // placeholder — enqueueSyncOp ticks real HLC
  // softDelete needs hlc; enqueue first then apply with that hlc
  const entry = await enqueueSyncOp({
    entity_type: store,
    entity_id: id,
    op_kind: options?.domain_op ? "domain" : "delete",
    domain_op: options?.domain_op ?? null,
    payload: { id },
  });
  await softDeleteEntity(store, id, {
    physicalMs: entry.hlc_physical_ms,
    counter: entry.hlc_counter,
    deviceId: entry.hlc_device_id || deviceId,
  });
  await rebuildCompatSnapshot();
}

export const productsRepo = {
  list: () => listActiveEntities("products"),
  get: (id: string) => getEntity("products", id),
  save: (data: Record<string, unknown>) => upsertLocal("products", data),
  remove: (id: string) => deleteLocal("products", id),
};

export const categoriesRepo = {
  list: () => listActiveEntities("categories"),
  get: (id: string) => getEntity("categories", id),
  save: (data: Record<string, unknown>) => upsertLocal("categories", data),
  remove: (id: string) => deleteLocal("categories", id),
};

export const customersRepo = {
  list: () => listActiveEntities("customers"),
  get: (id: string) => getEntity("customers", id),
  save: (data: Record<string, unknown>) => upsertLocal("customers", data),
  remove: (id: string) => deleteLocal("customers", id),
};

export const suppliersRepo = {
  list: () => listActiveEntities("suppliers"),
  get: (id: string) => getEntity("suppliers", id),
  save: (data: Record<string, unknown>) => upsertLocal("suppliers", data),
  remove: (id: string) => deleteLocal("suppliers", id),
};

export const safesRepo = {
  list: () => listActiveEntities("safes"),
  get: (id: string) => getEntity("safes", id),
  save: (data: Record<string, unknown>) => upsertLocal("safes", data),
  remove: (id: string) => deleteLocal("safes", id),
};

export const invoicesRepo = {
  list: () => listActiveEntities("invoices"),
  get: (id: string) => getEntity("invoices", id),
  /** Soft-delete with domain op so server applies LWW tombstone */
  remove: (id: string) =>
    deleteLocal("invoices", id, { domain_op: "delete_invoice" }),
};

export const documentsRepo = {
  list: () => listActiveEntities("documents"),
  get: (id: string) => getEntity("documents", id),
  save: (data: Record<string, unknown>) => upsertLocal("documents", data),
  remove: (id: string) => deleteLocal("documents", id),
};

export const shiftsRepo = {
  list: () => listActiveEntities("shifts"),
  get: (id: string) => getEntity("shifts", id),
  save: (data: Record<string, unknown>) => upsertLocal("shifts", data),
};

export const accountsRepo = {
  list: () => listActiveEntities("accounts"),
  get: (id: string) => getEntity("accounts", id),
  save: (data: Record<string, unknown>) => upsertLocal("accounts", data),
};

export const settingsRepo = {
  async get(): Promise<Record<string, unknown> | null> {
    const rows = await listActiveEntities("settings");
    return rows[0] || null;
  },
  save: (data: Record<string, unknown>) => upsertLocal("settings", data),
};

export async function markDeletedLocalOnly(
  store: EntityStoreName,
  id: string
): Promise<void> {
  const { tickHlc } = await import("@/lib/offline/hlc");
  const { getOrCreateDeviceId, persistLastHlc } = await import(
    "@/lib/offline/device"
  );
  const deviceId = await getOrCreateDeviceId();
  const hlc = tickHlc(deviceId);
  await persistLastHlc(hlc);
  await softDeleteEntity(store, id, hlc);
  await rebuildCompatSnapshot();
}

export async function readEntitiesLocalFirst(
  store: EntityStoreName,
  networkFetch?: () => Promise<Record<string, unknown>[]>
): Promise<Record<string, unknown>[]> {
  const local = await listActiveEntities(store);
  if (local.length) {
    if (networkFetch) {
      void networkFetch()
        .then(async (rows) => {
          for (const row of rows) await putEntity(store, row);
          await rebuildCompatSnapshot();
        })
        .catch(() => {});
    }
    return local;
  }
  if (networkFetch) {
    try {
      const rows = await networkFetch();
      for (const row of rows) await putEntity(store, row);
      await rebuildCompatSnapshot();
      return rows;
    } catch {
      return [];
    }
  }
  return [];
}

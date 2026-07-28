import Dexie, { type Table } from "dexie";
import type {
  DeviceState,
  IdMapRow,
  LocalEntityRow,
  MetaRow,
  SnapshotBundle,
  SyncOutboxEntry,
  TombstoneRow,
} from "@/lib/offline/types";

export type OfflineCredentialRow = {
  username: string;
  user_id: string;
  salt_b64: string;
  verifier_b64: string;
  iterations: number;
  profile_json: string;
  enrolled_at: string;
  last_online_at: string;
  fail_count: number;
  locked_until: string | null;
  revoked: boolean;
};

export type OfflineSessionRow = {
  id: "active";
  user_id: string;
  username: string;
  profile_json: string;
  created_at: string;
  expires_at: string;
  mode: "online" | "offline";
};

/**
 * Local-first IndexedDB.
 * v1 = legacy outbox/snapshots
 * v2 = normalized entity stores + sync outbox + tombstones
 * v3 = year history tables + offline credentials/session
 */
class OfflineDatabase extends Dexie {
  outbox!: Table<SyncOutboxEntry, string>;
  legacyOutbox!: Table<Record<string, unknown>, string>;
  idMap!: Table<IdMapRow, string>;
  snapshots!: Table<SnapshotBundle, string>;
  meta!: Table<MetaRow, string>;
  device!: Table<DeviceState, string>;
  tombstones!: Table<TombstoneRow, [string, string]>;
  products!: Table<LocalEntityRow, string>;
  categories!: Table<LocalEntityRow, string>;
  customers!: Table<LocalEntityRow, string>;
  suppliers!: Table<LocalEntityRow, string>;
  safes!: Table<LocalEntityRow, string>;
  invoices!: Table<LocalEntityRow, string>;
  invoice_items!: Table<LocalEntityRow, string>;
  documents!: Table<LocalEntityRow, string>;
  document_items!: Table<LocalEntityRow, string>;
  settings!: Table<LocalEntityRow, string>;
  shifts!: Table<LocalEntityRow, string>;
  party_payments!: Table<LocalEntityRow, string>;
  party_payment_allocations!: Table<LocalEntityRow, string>;
  accounts!: Table<LocalEntityRow, string>;
  journal_entries!: Table<LocalEntityRow, string>;
  journal_lines!: Table<LocalEntityRow, string>;
  safe_transactions!: Table<LocalEntityRow, string>;
  inventory_counts!: Table<LocalEntityRow, string>;
  inventory_count_items!: Table<LocalEntityRow, string>;
  price_tiers!: Table<LocalEntityRow, string>;
  product_tier_prices!: Table<LocalEntityRow, string>;
  tier_category_discounts!: Table<LocalEntityRow, string>;
  tier_product_discounts!: Table<LocalEntityRow, string>;
  profiles!: Table<LocalEntityRow, string>;
  audit_logs!: Table<LocalEntityRow, string>;
  offline_credentials!: Table<OfflineCredentialRow, string>;
  offline_session!: Table<OfflineSessionRow, string>;

  constructor() {
    super("windoor-offline");

    this.version(1).stores({
      outbox: "id, type, status, occurred_at",
      idMap: "local_id, remote_id, kind",
      snapshots: "id",
      meta: "key",
    });

    this.version(2)
      .stores({
        outbox:
          "id, status, entity_type, entity_id, hlc_physical_ms, [status+hlc_physical_ms]",
        idMap: "local_id, remote_id, kind",
        snapshots: "id",
        meta: "key",
        device: "id",
        tombstones: "[entity_type+entity_id], entity_type, entity_id",
        products: "id, deleted_at, last_hlc_physical_ms",
        categories: "id, deleted_at",
        customers: "id, deleted_at",
        suppliers: "id, deleted_at",
        safes: "id, deleted_at",
        invoices: "id, deleted_at, last_hlc_physical_ms",
        invoice_items: "id, deleted_at",
        documents: "id, deleted_at",
        settings: "id, deleted_at",
        shifts: "id, deleted_at",
        party_payments: "id, deleted_at",
        accounts: "id, deleted_at",
        inventory_counts: "id, deleted_at",
        price_tiers: "id, deleted_at",
        product_tier_prices: "id",
        tier_category_discounts: "id",
        tier_product_discounts: "id",
      })
      .upgrade(async (tx) => {
        try {
          const old = await tx.table("outbox").toArray();
          if (old.length) {
            await tx.table("meta").put({
              key: "legacy_outbox_v1",
              value: JSON.stringify(old),
            });
          }
          await tx.table("outbox").clear();
        } catch {
          /* ignore */
        }
      });

    this.version(3).stores({
      outbox:
        "id, status, entity_type, entity_id, hlc_physical_ms, [status+hlc_physical_ms]",
      idMap: "local_id, remote_id, kind",
      snapshots: "id",
      meta: "key",
      device: "id",
      tombstones: "[entity_type+entity_id], entity_type, entity_id",
      products: "id, deleted_at, last_hlc_physical_ms",
      categories: "id, deleted_at",
      customers: "id, deleted_at",
      suppliers: "id, deleted_at",
      safes: "id, deleted_at",
      invoices: "id, deleted_at, last_hlc_physical_ms",
      invoice_items: "id, deleted_at",
      documents: "id, deleted_at",
      document_items: "id, deleted_at",
      settings: "id, deleted_at",
      shifts: "id, deleted_at",
      party_payments: "id, deleted_at",
      party_payment_allocations: "id, deleted_at",
      accounts: "id, deleted_at",
      journal_entries: "id, deleted_at",
      journal_lines: "id, deleted_at",
      safe_transactions: "id, deleted_at",
      inventory_counts: "id, deleted_at",
      inventory_count_items: "id, deleted_at",
      price_tiers: "id, deleted_at",
      product_tier_prices: "id",
      tier_category_discounts: "id",
      tier_product_discounts: "id",
      profiles: "id, deleted_at",
      audit_logs: "id, deleted_at",
      offline_credentials: "username, user_id",
      offline_session: "id",
    });
  }
}

let dbSingleton: OfflineDatabase | null = null;

export function getOfflineDb(): OfflineDatabase {
  if (typeof window === "undefined") {
    throw new Error("Offline DB is browser-only");
  }
  if (!dbSingleton) {
    dbSingleton = new OfflineDatabase();
  }
  return dbSingleton;
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await getOfflineDb().meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await getOfflineDb().meta.put({ key, value });
}

export type EntityStoreName =
  | "products"
  | "categories"
  | "customers"
  | "suppliers"
  | "safes"
  | "invoices"
  | "invoice_items"
  | "documents"
  | "document_items"
  | "settings"
  | "shifts"
  | "party_payments"
  | "party_payment_allocations"
  | "accounts"
  | "journal_entries"
  | "journal_lines"
  | "safe_transactions"
  | "inventory_counts"
  | "inventory_count_items"
  | "price_tiers"
  | "product_tier_prices"
  | "tier_category_discounts"
  | "tier_product_discounts"
  | "profiles"
  | "audit_logs";

export function entityTable(
  name: EntityStoreName
): Table<LocalEntityRow, string> {
  const db = getOfflineDb();
  const table = db[name] as Table<LocalEntityRow, string> | undefined;
  if (!table) throw new Error(`Unknown entity store: ${name}`);
  return table;
}

export function toLocalRow(
  raw: Record<string, unknown>,
  fallbackId?: string
): LocalEntityRow {
  const id = String(
    raw.id ??
      fallbackId ??
      (raw.product_id && raw.tier_id
        ? `${raw.product_id}:${raw.tier_id}`
        : raw.tier_id && raw.category_id
          ? `${raw.tier_id}:${raw.category_id}`
          : raw.tier_id && raw.product_id
            ? `${raw.tier_id}:${raw.product_id}`
            : "")
  );
  return {
    id,
    data: raw,
    sync_version: Number(raw.sync_version ?? 1) || 1,
    deleted_at: (raw.deleted_at as string | null) ?? null,
    last_hlc_physical_ms: Number(raw.last_hlc_physical_ms ?? 0) || 0,
    last_hlc_counter: Number(raw.last_hlc_counter ?? 0) || 0,
    last_hlc_device_id: (raw.last_hlc_device_id as string | null) ?? null,
    updated_at: String(
      raw.updated_at ?? raw.created_at ?? new Date().toISOString()
    ),
  };
}

export async function putEntity(
  store: EntityStoreName,
  raw: Record<string, unknown>
): Promise<void> {
  const row = toLocalRow(raw);
  if (!row.id) return;
  await entityTable(store).put(row);
}

export async function softDeleteEntity(
  store: EntityStoreName,
  id: string,
  hlc: { physicalMs: number; counter: number; deviceId: string }
): Promise<void> {
  const table = entityTable(store);
  const existing = await table.get(id);
  const now = new Date().toISOString();
  await table.put({
    id,
    data: { ...(existing?.data || { id }), deleted_at: now },
    sync_version: (existing?.sync_version || 0) + 1,
    deleted_at: now,
    last_hlc_physical_ms: hlc.physicalMs,
    last_hlc_counter: hlc.counter,
    last_hlc_device_id: hlc.deviceId,
    updated_at: now,
  });
  await getOfflineDb().tombstones.put({
    entity_type: store,
    entity_id: id,
    hlc_physical_ms: hlc.physicalMs,
    hlc_counter: hlc.counter,
    hlc_device_id: hlc.deviceId,
    deleted_at: now,
    server_seq: null,
  });
}

export async function listActiveEntities(
  store: EntityStoreName
): Promise<Record<string, unknown>[]> {
  const rows = await entityTable(store).toArray();
  return rows.filter((r) => !r.deleted_at).map((r) => r.data);
}

export async function getEntity(
  store: EntityStoreName,
  id: string
): Promise<Record<string, unknown> | null> {
  const row = await entityTable(store).get(id);
  if (!row || row.deleted_at) return null;
  return row.data;
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return null;
  }
  try {
    const already = await navigator.storage.persisted();
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function getStorageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }
  try {
    const est = await navigator.storage.estimate();
    return {
      usage: Number(est.usage || 0),
      quota: Number(est.quota || 0),
    };
  } catch {
    return null;
  }
}

const BUSINESS_ENTITY_STORES: EntityStoreName[] = [
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

const BOOTSTRAP_META_KEYS = [
  "bootstrap_checkpoint",
  "bootstrap_complete",
  "last_sync_at",
  "legacy_outbox_v1",
  "data_pack_version",
];

/**
 * Wipe local business data after factory reset / restore.
 * Keeps offline login credentials and the active session.
 */
export async function clearLocalBusinessData(): Promise<void> {
  const db = getOfflineDb();

  await Promise.all([
    ...BUSINESS_ENTITY_STORES.map((name) => entityTable(name).clear()),
    db.outbox.clear(),
    db.snapshots.clear(),
    db.tombstones.clear(),
    db.idMap.clear(),
  ]);

  // Force a full re-bootstrap on next online load.
  const device = await db.device.get("main");
  if (device) {
    await db.device.put({
      ...device,
      checkpoint: 0,
      bootstrapped_at: null,
      last_sync_at: null,
      last_hlc: null,
    });
  } else {
    await db.device.clear();
  }

  await Promise.all(BOOTSTRAP_META_KEYS.map((key) => db.meta.delete(key)));
  await setMeta("factory_reset_at", new Date().toISOString());

  // Drop any Cache Storage entries that might serve stale API/HTML shells.
  if (typeof caches !== "undefined") {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("windoor") || k.includes("serwist"))
          .map((k) => caches.delete(k))
      );
    } catch {
      /* ignore */
    }
  }
}

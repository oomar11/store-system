/** Export / import local offline database as a JSON file (Windows backup). */

import { getOfflineDb, listActiveEntities, type EntityStoreName } from "@/lib/offline/db";
import { getDeviceState } from "@/lib/offline/device";
import { listSyncOutbox } from "@/lib/offline/outbox";

const STORES: EntityStoreName[] = [
  "products",
  "categories",
  "customers",
  "suppliers",
  "safes",
  "invoices",
  "invoice_items",
  "documents",
  "settings",
  "shifts",
  "party_payments",
  "accounts",
  "inventory_counts",
  "price_tiers",
  "product_tier_prices",
  "tier_category_discounts",
  "tier_product_discounts",
];

export type LocalBackupFile = {
  version: 1;
  exported_at: string;
  device: Awaited<ReturnType<typeof getDeviceState>>;
  entities: Record<string, Record<string, unknown>[]>;
  outbox: Awaited<ReturnType<typeof listSyncOutbox>>;
  tombstones: unknown[];
};

export async function buildLocalBackup(): Promise<LocalBackupFile> {
  const entities: Record<string, Record<string, unknown>[]> = {};
  for (const store of STORES) {
    entities[store] = await listActiveEntities(store);
  }
  const db = getOfflineDb();
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    device: await getDeviceState(),
    entities,
    outbox: await listSyncOutbox({ includeSynced: true }),
    tombstones: await db.tombstones.toArray(),
  };
}

export async function downloadLocalBackup(): Promise<void> {
  const backup = await buildLocalBackup();
  const blob = new Blob([JSON.stringify(backup)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `windoor-local-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupTableName,
} from "./tables";

export type BackupPayload = {
  version: number;
  exported_at: string;
  store_name: string;
  tables: Record<BackupTableName, Record<string, unknown>[]>;
};

const PAGE_SIZE = 1000;

async function fetchAllRows(
  client: SupabaseClient,
  table: BackupTableName
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`فشل قراءة ${table}: ${error.message}`);
    }

    if (!data?.length) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function exportBackup(
  client: SupabaseClient
): Promise<BackupPayload> {
  const tables = {} as Record<BackupTableName, Record<string, unknown>[]>;

  for (const table of BACKUP_TABLES) {
    tables[table] = await fetchAllRows(client, table);
  }

  const storeName =
    (tables.settings[0]?.store_name as string | undefined) || "المحل";

  return {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    store_name: storeName,
    tables,
  };
}

export function backupToJson(payload: BackupPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function backupFilename(payload: BackupPayload): string {
  const day = payload.exported_at.slice(0, 10);
  // HTTP headers / FormData filenames must be ASCII (ByteString)
  const safe = payload.store_name
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `backup-${safe || "store"}-${day}.json`;
}

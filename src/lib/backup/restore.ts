import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackupPayload } from "./export";
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
  RESTORE_ORDER,
  type BackupTableName,
} from "./tables";
import { wipeExtraBusinessTables } from "./wipe-extra";

const CHUNK = 200;

function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== "number" || !v.tables || typeof v.tables !== "object") {
    return false;
  }
  return true;
}

export function parseBackupJson(raw: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ملف JSON غير صالح");
  }

  if (!isBackupPayload(parsed)) {
    throw new Error("صيغة ملف النسخة الاحتياطية غير معروفة");
  }

  if (parsed.version !== BACKUP_VERSION) {
    throw new Error(`إصدار الباكب غير مدعوم: ${parsed.version}`);
  }

  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(parsed.tables[table])) {
      parsed.tables[table] = [];
    }
  }

  return parsed;
}

async function insertChunk(
  client: SupabaseClient,
  table: BackupTableName,
  rows: Record<string, unknown>[]
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await client.from(table).insert(slice);
    if (error) {
      throw new Error(`فشل إدراج ${table}: ${error.message}`);
    }
  }
}

/** Accounts may self-reference via parent_id — insert without parent, then patch. */
async function restoreAccounts(
  client: SupabaseClient,
  rows: Record<string, unknown>[]
) {
  if (!rows.length) return;

  const stripped = rows.map((row) => {
    const copy = { ...row };
    copy.parent_id = null;
    return copy;
  });

  await insertChunk(client, "accounts", stripped);

  const withParent = rows.filter((r) => r.parent_id != null);
  for (const row of withParent) {
    const { error } = await client
      .from("accounts")
      .update({ parent_id: row.parent_id })
      .eq("id", row.id);
    if (error) {
      throw new Error(`فشل تحديث parent_id للحسابات: ${error.message}`);
    }
  }
}

export async function restoreBackup(
  client: SupabaseClient,
  payload: BackupPayload
): Promise<void> {
  const { error: wipeError } = await client.rpc("wipe_business_data");
  if (wipeError) {
    throw new Error(`فشل مسح البيانات قبل الاستعادة: ${wipeError.message}`);
  }

  await wipeExtraBusinessTables(client);

  for (const table of RESTORE_ORDER) {
    const rows = payload.tables[table] || [];
    if (!rows.length) continue;

    if (table === "accounts") {
      await restoreAccounts(client, rows);
      continue;
    }

    await insertChunk(client, table, rows);
  }
}

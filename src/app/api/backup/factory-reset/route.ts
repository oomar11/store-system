import { NextRequest, NextResponse } from "next/server";
import {
  FACTORY_RESET_CONFIRM,
  backupFilename,
  backupToJson,
  exportBackup,
  isTelegramConfigured,
  logBackupRun,
  requireOwner,
  sendTelegramDocument,
} from "@/lib/backup";
import { createServiceClient } from "@/lib/supabase-service";
import { logAuditEvent } from "@/lib/audit";
import {
  countCoreBusinessRows,
  wipeExtraBusinessTables,
} from "@/lib/backup/wipe-extra";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const confirm =
      typeof body?.confirm === "string" ? body.confirm.trim() : "";

    if (confirm !== FACTORY_RESET_CONFIRM) {
      return NextResponse.json(
        { error: `للتأكيد اكتب: ${FACTORY_RESET_CONFIRM}` },
        { status: 400 }
      );
    }

    if (!(await isTelegramConfigured())) {
      return NextResponse.json(
        {
          error:
            "لازم تضبط تيليجرام أولاً — قبل إعادة الضبط بيتبعت باك أب تلقائي على تيليجرام",
        },
        { status: 400 }
      );
    }

    const client = await createServiceClient();

    // 1) Backup first, send to Telegram — refuse reset if send fails
    const payload = await exportBackup(client);
    const json = backupToJson(payload);
    const filename = backupFilename(payload);
    const byteSize = Buffer.byteLength(json, "utf8");

    const tg = await sendTelegramDocument({
      filename,
      content: json,
      caption: `نسخة قبل إعادة ضبط المصنع — ${payload.store_name}\n${payload.exported_at}`,
    });

    if (!tg.ok) {
      await logBackupRun({
        source: "telegram",
        status: "failed",
        byteSize,
        errorMessage: tg.description || "فشل إرسال باك أب قبل إعادة الضبط",
        createdBy: auth.userId,
      });
      return NextResponse.json(
        {
          error:
            tg.description ||
            "فشل إرسال الباكب على تيليجرام — تم إلغاء إعادة الضبط",
        },
        { status: 502 }
      );
    }

    await logBackupRun({
      source: "telegram",
      status: "success",
      byteSize,
      createdBy: auth.userId,
    });

    await logAuditEvent(client, {
      action: "system.factory_reset",
      entityType: "system",
      entityLabel: "إعادة ضبط المصنع",
      meta: { confirm, pre_backup: filename, pre_backup_bytes: byteSize },
      source: "api",
      actorId: auth.userId,
    });

    // 2) Wipe + reseed defaults
    const { error } = await client.rpc("factory_reset");
    if (error) {
      throw new Error(error.message);
    }

    // 3) Clear any tables older wipe RPCs may leave; also re-clear catalogs
    await wipeExtraBusinessTables(client);

    // 4) Verify core tables are empty
    const leftovers = await countCoreBusinessRows(client);
    const dirty = Object.entries(leftovers).filter(([, n]) => n > 0);
    if (dirty.length) {
      throw new Error(
        `إعادة الضبط لم تُفرّغ النظام بالكامل: ${dirty
          .map(([t, n]) => `${t}=${n}`)
          .join(", ")}`
      );
    }

    await logBackupRun({
      source: "factory_reset",
      status: "success",
      createdBy: auth.userId,
    });

    return NextResponse.json({
      ok: true,
      backup_sent: true,
      backup_filename: filename,
      verified_empty: leftovers,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "فشل إعادة الضبط";
    await logBackupRun({
      source: "factory_reset",
      status: "failed",
      errorMessage: message,
      createdBy: auth.userId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

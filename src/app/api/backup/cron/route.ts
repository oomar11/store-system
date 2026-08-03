import { NextRequest, NextResponse } from "next/server";
import {
  backupFilename,
  backupToJson,
  exportBackup,
  isTelegramConfigured,
  logBackupRun,
  requireCronSecret,
  sendTelegramDocument,
  sendTelegramMessage,
} from "@/lib/backup";
import { createServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (!(await isTelegramConfigured())) {
      await logBackupRun({
        source: "cron",
        status: "failed",
        errorMessage: "Telegram not configured",
      });
      return NextResponse.json(
        { error: "Telegram not configured" },
        { status: 500 }
      );
    }

    const client = await createServiceClient();
    const payload = await exportBackup(client);
    const json = backupToJson(payload);
    const filename = backupFilename(payload);
    const byteSize = Buffer.byteLength(json, "utf8");

    const tg = await sendTelegramDocument({
      filename,
      content: json,
      caption: `نسخة يومية تلقائية — ${payload.store_name}\n${payload.exported_at}`,
    });

    if (!tg.ok) {
      await logBackupRun({
        source: "cron",
        status: "failed",
        byteSize,
        errorMessage: tg.description,
      });
      return NextResponse.json(
        { error: tg.description || "Telegram send failed" },
        { status: 502 }
      );
    }

    await logBackupRun({
      source: "cron",
      status: "success",
      byteSize,
    });

    return NextResponse.json({
      ok: true,
      filename,
      byte_size: byteSize,
      exported_at: payload.exported_at,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Cron backup failed";
    await logBackupRun({
      source: "cron",
      status: "failed",
      errorMessage: message,
    });
    try {
      if (await isTelegramConfigured()) {
        await sendTelegramMessage(`فشل النسخ الاحتياطي اليومي:\n${message}`);
      }
    } catch {
      // ignore secondary failure
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

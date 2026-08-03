import { NextRequest, NextResponse } from "next/server";
import {
  backupFilename,
  backupToJson,
  exportBackup,
  isTelegramConfigured,
  logBackupRun,
  requireOwner,
  sendTelegramDocument,
} from "@/lib/backup";
import { createServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const sendTelegram =
    request.nextUrl.searchParams.get("send") === "telegram";

  try {
    const client = await createServiceClient();
    const payload = await exportBackup(client);
    const json = backupToJson(payload);
    const filename = backupFilename(payload);
    const byteSize = Buffer.byteLength(json, "utf8");

    if (sendTelegram) {
      if (!(await isTelegramConfigured())) {
        return NextResponse.json(
          { error: "تيليجرام غير مضبوط — احفظ التوكن و Chat ID من الإعدادات" },
          { status: 400 }
        );
      }

      const tg = await sendTelegramDocument({
        filename,
        content: json,
        caption: `نسخة احتياطية — ${payload.store_name}\n${payload.exported_at}`,
      });

      if (!tg.ok) {
        await logBackupRun({
          source: "telegram",
          status: "failed",
          byteSize,
          errorMessage: tg.description,
          createdBy: auth.userId,
        });
        return NextResponse.json(
          { error: tg.description || "فشل إرسال تيليجرام" },
          { status: 502 }
        );
      }

      await logBackupRun({
        source: "telegram",
        status: "success",
        byteSize,
        createdBy: auth.userId,
      });

      return NextResponse.json({
        ok: true,
        sent: true,
        filename,
        byte_size: byteSize,
        exported_at: payload.exported_at,
      });
    }

    await logBackupRun({
      source: "manual",
      status: "success",
      byteSize,
      createdBy: auth.userId,
    });

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "فشل التصدير";
    await logBackupRun({
      source: sendTelegram ? "telegram" : "manual",
      status: "failed",
      errorMessage: message,
      createdBy: auth.userId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

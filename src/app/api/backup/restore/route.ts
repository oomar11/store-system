import { NextRequest, NextResponse } from "next/server";
import {
  logBackupRun,
  parseBackupJson,
  requireOwner,
  restoreBackup,
  RESTORE_CONFIRM,
} from "@/lib/backup";
import { createServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const confirm = typeof body?.confirm === "string" ? body.confirm.trim() : "";
    if (confirm !== RESTORE_CONFIRM) {
      return NextResponse.json(
        { error: `للتأكيد اكتب: ${RESTORE_CONFIRM}` },
        { status: 400 }
      );
    }

    const raw =
      typeof body?.backup === "string"
        ? body.backup
        : JSON.stringify(body?.backup ?? body?.payload ?? null);

    if (!raw || raw === "null") {
      return NextResponse.json(
        { error: "لم يتم إرسال ملف النسخة الاحتياطية" },
        { status: 400 }
      );
    }

    const payload = parseBackupJson(raw);
    const client = await createServiceClient();
    await restoreBackup(client, payload);

    await logBackupRun({
      source: "restore",
      status: "success",
      byteSize: Buffer.byteLength(raw, "utf8"),
      createdBy: auth.userId,
    });

    return NextResponse.json({
      ok: true,
      exported_at: payload.exported_at,
      store_name: payload.store_name,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "فشل الاستعادة";
    await logBackupRun({
      source: "restore",
      status: "failed",
      errorMessage: message,
      createdBy: auth.userId,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

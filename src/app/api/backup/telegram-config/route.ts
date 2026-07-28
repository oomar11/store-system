import { NextRequest, NextResponse } from "next/server";
import {
  loadTelegramConfig,
  requireOwner,
  syncTelegramBotBranding,
} from "@/lib/backup";
import {
  getTelegramConfigPublic,
  saveTelegramConfig,
} from "@/lib/backup/telegram-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const config = await getTelegramConfigPublic();
    return NextResponse.json(config);
  } catch (e) {
    const message = e instanceof Error ? e.message : "فشل التحميل";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const config = await saveTelegramConfig({
      bot_token:
        typeof body.bot_token === "string" ? body.bot_token : undefined,
      chat_id: typeof body.chat_id === "string" ? body.chat_id : undefined,
      clear_token: body.clear_token === true,
      updated_by: auth.userId,
    });

    let branding = null;
    const live = await loadTelegramConfig();
    if (live?.bot_token) {
      branding = await syncTelegramBotBranding(live.bot_token);
    }

    return NextResponse.json({ ok: true, ...config, branding });
  } catch (e) {
    const message = e instanceof Error ? e.message : "فشل الحفظ";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

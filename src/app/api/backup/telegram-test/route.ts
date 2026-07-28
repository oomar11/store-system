import { NextResponse } from "next/server";
import {
  isTelegramConfigured,
  loadTelegramConfig,
  requireOwner,
  sendTelegramMessage,
  syncTelegramBotBranding,
} from "@/lib/backup";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  if (!(await isTelegramConfigured())) {
    return NextResponse.json(
      { error: "تيليجرام غير مضبوط — احفظ التوكن و Chat ID من الإعدادات" },
      { status: 400 }
    );
  }

  try {
    const live = await loadTelegramConfig();
    let branding = null;
    if (live?.bot_token) {
      branding = await syncTelegramBotBranding(live.bot_token);
    }

    const nameHint = branding?.name ? ` (${branding.name})` : "";
    const tg = await sendTelegramMessage(
      `✅ اختبار اتصال — نظام النسخ الاحتياطي يعمل.${nameHint}`
    );
    if (!tg.ok) {
      return NextResponse.json(
        { error: tg.description || "فشل الإرسال", branding },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, branding });
  } catch (e) {
    const message = e instanceof Error ? e.message : "فشل الاختبار";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireOwner, isTelegramConfigured } from "@/lib/backup";
import {
  getTelegramWebhookInfo,
  getWebhookSecret,
  getWebhookUrl,
  isGeminiConfigured,
  getGeminiModelName,
  registerTelegramWebhook,
  unregisterTelegramWebhook,
  sendTelegramChatMessage,
  JARVIS_START_MESSAGE,
} from "@/lib/ai";
import { loadTelegramConfig } from "@/lib/backup/telegram-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const telegramOk = await isTelegramConfigured();
  const geminiOk = isGeminiConfigured();
  const webhookSecretOk = Boolean(getWebhookSecret());
  let webhook = null;
  if (telegramOk) {
    try {
      webhook = await getTelegramWebhookInfo();
    } catch (e) {
      webhook = {
        ok: false,
        description: e instanceof Error ? e.message : "فشل getWebhookInfo",
      };
    }
  }

  return NextResponse.json({
    telegram_configured: telegramOk,
    gemini_configured: geminiOk,
    webhook_secret_configured: webhookSecretOk,
    webhook_url: getWebhookUrl(),
    model: getGeminiModelName(),
    webhook,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const action = (body.action || "").trim();

  if (!(await isTelegramConfigured())) {
    return NextResponse.json(
      { error: "تيليجرام غير مضبوط — احفظ التوكن و Chat ID أولاً" },
      { status: 400 }
    );
  }

  if (action === "register") {
    if (!isGeminiConfigured()) {
      return NextResponse.json(
        {
          error:
            "أضف GEMINI_API_KEY في متغيرات البيئة على Vercel ثم أعد النشر",
        },
        { status: 400 }
      );
    }
    const result = await registerTelegramWebhook();
    if (!result.ok) {
      return NextResponse.json(
        { error: result.description || "فشل تسجيل الـ webhook", ...result },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      url: result.url,
      description: result.description,
    });
  }

  if (action === "unregister") {
    const result = await unregisterTelegramWebhook();
    if (!result.ok) {
      return NextResponse.json(
        { error: result.description || "فشل إلغاء الـ webhook" },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      description: result.description,
    });
  }

  if (action === "test") {
    if (!isGeminiConfigured()) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY غير مضبوط" },
        { status: 400 }
      );
    }
    const cfg = await loadTelegramConfig();
    if (!cfg) {
      return NextResponse.json({ error: "تيليجرام غير مضبوط" }, { status: 400 });
    }
    const tg = await sendTelegramChatMessage({
      chatId: cfg.chat_id,
      text: `✅ اختبار مساعد جارفس\n\n${JARVIS_START_MESSAGE}`,
    });
    if (!tg.ok) {
      return NextResponse.json(
        { error: tg.description || "فشل إرسال رسالة الاختبار" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "action غير معروف — استخدم register | unregister | test" },
    { status: 400 }
  );
}

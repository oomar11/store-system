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
import {
  getGeminiConfigPublic,
  saveGeminiApiKey,
} from "@/lib/ai/gemini-config";
import { loadTelegramConfig } from "@/lib/backup/telegram-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const telegramOk = await isTelegramConfigured();
  const gemini = await getGeminiConfigPublic();
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
    gemini_configured: gemini.configured,
    gemini_source: gemini.source,
    gemini_key_masked: gemini.key_masked,
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

  let body: { action?: string; api_key?: string };
  try {
    body = (await request.json()) as { action?: string; api_key?: string };
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const action = (body.action || "").trim();

  if (action === "save_key") {
    const saved = await saveGeminiApiKey({
      api_key: body.api_key || "",
      updated_by: auth.userId,
    });
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 400 });
    }
    const publicCfg = await getGeminiConfigPublic();
    return NextResponse.json({
      ok: true,
      key_masked: saved.key_masked,
      configured: publicCfg.configured,
      source: publicCfg.source,
    });
  }

  if (!(await isTelegramConfigured())) {
    return NextResponse.json(
      { error: "تيليجرام غير مضبوط — احفظ التوكن و Chat ID أولاً" },
      { status: 400 }
    );
  }

  if (action === "register") {
    // Webhook can be registered before Gemini key — key can be set via Telegram /gemini
    const result = await registerTelegramWebhook();
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.description || "فشل تسجيل الـ webhook",
          url: result.url,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      url: result.url,
      description: result.description,
      gemini_configured: await isGeminiConfigured(),
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
    const cfg = await loadTelegramConfig();
    if (!cfg) {
      return NextResponse.json({ error: "تيليجرام غير مضبوط" }, { status: 400 });
    }
    const ready = await isGeminiConfigured();
    const tg = await sendTelegramChatMessage({
      chatId: cfg.chat_id,
      text: ready
        ? `✅ اختبار مساعد جارفس\n\n${JARVIS_START_MESSAGE}`
        : `✅ الـ webhook شغال.\nالمفتاح لسه ناقص — ابعت:\n/gemini YOUR_API_KEY`,
    });
    if (!tg.ok) {
      return NextResponse.json(
        { error: tg.description || "فشل إرسال رسالة الاختبار" },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, gemini_configured: ready });
  }

  return NextResponse.json(
    {
      error:
        "action غير معروف — استخدم save_key | register | unregister | test",
    },
    { status: 400 }
  );
}

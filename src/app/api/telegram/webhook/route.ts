import { NextRequest, NextResponse } from "next/server";
import { loadTelegramConfig } from "@/lib/backup/telegram-config";
import {
  getWebhookSecret,
  handleJarvisMessage,
  sendChatAction,
  sendTelegramChatMessage,
} from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number | string; type?: string };
    from?: { id?: number; is_bot?: boolean; first_name?: string };
  };
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export async function POST(request: NextRequest) {
  const configuredSecret = getWebhookSecret();
  if (configuredSecret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (!timingSafeEqual(header, configuredSecret)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text || message.from?.is_bot) {
    return NextResponse.json({ ok: true });
  }

  const chatId = String(message.chat.id);
  let cfg;
  try {
    cfg = await loadTelegramConfig();
  } catch (e) {
    console.error("telegram webhook config", e);
    return NextResponse.json({
      ok: true,
      skipped: "config_error",
      error: e instanceof Error ? e.message : "config_error",
    });
  }
  if (!cfg) {
    return NextResponse.json({ ok: true, skipped: "telegram_not_configured" });
  }

  if (chatId !== String(cfg.chat_id).trim()) {
    // Ignore foreign chats silently
    return NextResponse.json({
      ok: true,
      skipped: "chat_not_allowed",
      chat_id: chatId,
    });
  }

  // Respond quickly to Telegram; process AI in the same request (Vercel serverless)
  try {
    await sendChatAction(chatId, "typing");
    const reply = await handleJarvisMessage(chatId, message.text);
    const sent = await sendTelegramChatMessage({
      chatId,
      text: reply.text,
      replyToMessageId: message.message_id,
    });
    return NextResponse.json({
      ok: true,
      replied: true,
      send_ok: sent.ok,
      used_tools: reply.usedTools,
    });
  } catch (e) {
    console.error("telegram webhook jarvis", e);
    try {
      await sendTelegramChatMessage({
        chatId,
        text:
          e instanceof Error
            ? `حصل خطأ: ${e.message}`
            : "حصل خطأ أثناء معالجة الرسالة.",
        replyToMessageId: message.message_id,
      });
    } catch {
      // ignore
    }
    return NextResponse.json({
      ok: true,
      replied: false,
      error: e instanceof Error ? e.message : "handler_error",
    });
  }
}

export async function GET() {
  let telegramConfigured = false;
  let geminiConfigured = false;
  let chatIdSet = false;
  let configError: string | null = null;
  try {
    const cfg = await loadTelegramConfig();
    telegramConfigured = Boolean(cfg);
    chatIdSet = Boolean(cfg?.chat_id);
  } catch (e) {
    configError = e instanceof Error ? e.message : "config error";
  }
  try {
    const { isGeminiConfigured } = await import("@/lib/ai");
    geminiConfigured = await isGeminiConfigured();
  } catch (e) {
    configError =
      (configError ? configError + " | " : "") +
      (e instanceof Error ? e.message : "gemini error");
  }

  return NextResponse.json({
    ok: true,
    service: "telegram-jarvis-webhook",
    host: "store-system-rho",
    telegram_configured: telegramConfigured,
    chat_id_set: chatIdSet,
    gemini_configured: geminiConfigured,
    config_error: configError,
  });
}

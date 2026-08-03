import { loadTelegramConfig } from "@/lib/backup/telegram-config";

const TG_TEXT_LIMIT = 4000;

export type TelegramChatSendResult = {
  ok: boolean;
  description?: string;
};

async function resolveToken(): Promise<string> {
  const cfg = await loadTelegramConfig();
  if (!cfg?.bot_token) {
    throw new Error("تيليجرام غير مضبوط");
  }
  return cfg.bot_token;
}

export async function sendChatAction(
  chatId: string,
  action: "typing" | "upload_document" = "typing"
): Promise<void> {
  try {
    const token = await resolveToken();
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // non-fatal
  }
}

function splitMessage(text: string): string[] {
  if (text.length <= TG_TEXT_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TG_TEXT_LIMIT) {
    let cut = remaining.lastIndexOf("\n", TG_TEXT_LIMIT);
    if (cut < TG_TEXT_LIMIT * 0.5) cut = TG_TEXT_LIMIT;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendTelegramChatMessage(opts: {
  chatId: string;
  text: string;
  replyToMessageId?: number;
}): Promise<TelegramChatSendResult> {
  const token = await resolveToken();
  const parts = splitMessage(opts.text);
  let last: TelegramChatSendResult = { ok: true };

  for (let i = 0; i < parts.length; i++) {
    const body: Record<string, unknown> = {
      chat_id: opts.chatId,
      text: parts[i],
      disable_web_page_preview: true,
    };
    if (i === 0 && opts.replyToMessageId) {
      body.reply_to_message_id = opts.replyToMessageId;
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const data = (await res.json()) as {
      ok: boolean;
      description?: string;
    };
    last = { ok: data.ok, description: data.description };
    if (!data.ok) return last;
  }

  return last;
}

export function getAppBaseUrl(): string {
  const site =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://store-system-iota.vercel.app";
  return site.replace(/\/$/, "");
}

export function getWebhookUrl(): string {
  return `${getAppBaseUrl()}/api/telegram/webhook`;
}

export function getWebhookSecret(): string | null {
  const s = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return s || null;
}

export async function telegramBotApi<T = unknown>(
  method: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; description?: string; result?: T }> {
  const token = await resolveToken();
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: T;
  };
}

export async function registerTelegramWebhook(): Promise<{
  ok: boolean;
  url: string;
  description?: string;
}> {
  const secret = getWebhookSecret();
  if (!secret) {
    return {
      ok: false,
      url: getWebhookUrl(),
      description:
        "أضف TELEGRAM_WEBHOOK_SECRET في متغيرات البيئة ثم أعد النشر",
    };
  }
  const url = getWebhookUrl();
  const res = await telegramBotApi("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  return {
    ok: res.ok,
    url,
    description: res.description,
  };
}

export async function unregisterTelegramWebhook(): Promise<{
  ok: boolean;
  description?: string;
}> {
  const res = await telegramBotApi("deleteWebhook", {
    drop_pending_updates: false,
  });
  return { ok: res.ok, description: res.description };
}

export async function getTelegramWebhookInfo(): Promise<{
  ok: boolean;
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  description?: string;
}> {
  const res = await telegramBotApi<{
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
  }>("getWebhookInfo");
  return {
    ok: res.ok,
    url: res.result?.url,
    pending_update_count: res.result?.pending_update_count,
    last_error_message: res.result?.last_error_message,
    description: res.description,
  };
}

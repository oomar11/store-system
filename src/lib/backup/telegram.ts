import { gzipSync } from "zlib";
import { loadTelegramConfig } from "./telegram-config";

const TELEGRAM_DOC_LIMIT = 45 * 1024 * 1024; // leave margin under 50MB

export type TelegramSendResult = {
  ok: boolean;
  description?: string;
  message_id?: number;
};

async function resolveConfig() {
  const cfg = await loadTelegramConfig();
  if (!cfg) {
    throw new Error(
      "تيليجرام غير مضبوط — أدخل التوكن و Chat ID من الإعدادات"
    );
  }
  return { token: cfg.bot_token, chatId: cfg.chat_id };
}

export async function sendTelegramMessage(
  text: string
): Promise<TelegramSendResult> {
  const { token, chatId } = await resolveConfig();
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { message_id?: number };
  };
  return {
    ok: data.ok,
    description: data.description,
    message_id: data.result?.message_id,
  };
}

export async function sendTelegramDocument(opts: {
  filename: string;
  content: string | Buffer;
  caption?: string;
}): Promise<TelegramSendResult> {
  const { token, chatId } = await resolveConfig();

  let body: Buffer;
  let filename = opts.filename;

  if (typeof opts.content === "string") {
    const utf8 = Buffer.from(opts.content, "utf8");
    if (utf8.byteLength > TELEGRAM_DOC_LIMIT) {
      body = gzipSync(utf8);
      filename = filename.endsWith(".gz") ? filename : `${filename}.gz`;
    } else {
      body = utf8;
    }
  } else {
    body = opts.content;
  }

  if (body.byteLength > TELEGRAM_DOC_LIMIT) {
    throw new Error(
      `حجم الملف (${Math.round(body.byteLength / 1024 / 1024)}MB) أكبر من حد تيليجرام`
    );
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  if (opts.caption) form.append("caption", opts.caption);
  form.append(
    "document",
    new Blob([new Uint8Array(body)], { type: "application/octet-stream" }),
    filename
  );

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendDocument`,
    { method: "POST", body: form }
  );

  const data = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { message_id?: number };
  };

  return {
    ok: data.ok,
    description: data.description,
    message_id: data.result?.message_id,
  };
}

export async function isTelegramConfigured(): Promise<boolean> {
  const cfg = await loadTelegramConfig();
  return Boolean(cfg);
}

import { createServiceClient } from "@/lib/supabase-service";

export type TelegramConfig = {
  bot_token: string;
  chat_id: string;
  source: "database" | "env";
};

const CONFIG_ID = "b0000000-0000-0000-0000-000000000001";

function maskToken(token: string | null | undefined): string {
  if (!token) return "";
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export async function loadTelegramConfig(): Promise<TelegramConfig | null> {
  try {
    const client = createServiceClient();
    const { data } = await client
      .from("telegram_config")
      .select("bot_token, chat_id")
      .eq("id", CONFIG_ID)
      .maybeSingle();

    const dbToken = (data?.bot_token || "").trim();
    const dbChat = (data?.chat_id || "").trim();
    if (dbToken && dbChat) {
      return { bot_token: dbToken, chat_id: dbChat, source: "database" };
    }
  } catch (e) {
    console.error("loadTelegramConfig db", e);
  }

  const envToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const envChat = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (envToken && envChat) {
    return { bot_token: envToken, chat_id: envChat, source: "env" };
  }

  return null;
}

export async function getTelegramConfigPublic() {
  try {
    const client = createServiceClient();
    const { data } = await client
      .from("telegram_config")
      .select("bot_token, chat_id, updated_at")
      .eq("id", CONFIG_ID)
      .maybeSingle();

    const dbToken = (data?.bot_token || "").trim();
    const dbChat = (data?.chat_id || "").trim();
    const envFallback = Boolean(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
    );

    return {
      chat_id: dbChat || (envFallback ? "(من البيئة)" : ""),
      bot_token_masked: dbToken
        ? maskToken(dbToken)
        : envFallback
          ? maskToken(process.env.TELEGRAM_BOT_TOKEN)
          : "",
      has_token: Boolean(dbToken) || envFallback,
      has_chat_id: Boolean(dbChat) || envFallback,
      configured: Boolean(
        (dbToken && dbChat) ||
          (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
      ),
      source:
        dbToken && dbChat
          ? ("database" as const)
          : envFallback
            ? ("env" as const)
            : ("none" as const),
      updated_at: data?.updated_at ?? null,
      editable_chat_id: dbChat,
    };
  } catch (e) {
    console.error("getTelegramConfigPublic", e);
    const envFallback = Boolean(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
    );
    return {
      chat_id: envFallback ? "(من البيئة)" : "",
      bot_token_masked: envFallback
        ? maskToken(process.env.TELEGRAM_BOT_TOKEN)
        : "",
      has_token: envFallback,
      has_chat_id: envFallback,
      configured: envFallback,
      source: envFallback ? ("env" as const) : ("none" as const),
      updated_at: null,
      editable_chat_id: "",
    };
  }
}

export async function saveTelegramConfig(opts: {
  bot_token?: string | null;
  chat_id?: string | null;
  updated_by?: string | null;
  clear_token?: boolean;
}) {
  const client = createServiceClient();
  const { data: existing } = await client
    .from("telegram_config")
    .select("bot_token, chat_id")
    .eq("id", CONFIG_ID)
    .maybeSingle();

  let nextToken = existing?.bot_token ?? null;
  let nextChat = existing?.chat_id ?? null;

  if (opts.clear_token) {
    nextToken = null;
  } else if (typeof opts.bot_token === "string") {
    const t = opts.bot_token.trim();
    if (t && !t.includes("…") && !t.includes("•")) {
      nextToken = t;
    }
  }

  if (typeof opts.chat_id === "string") {
    nextChat = opts.chat_id.trim() || null;
  }

  const payload = {
    id: CONFIG_ID,
    bot_token: nextToken,
    chat_id: nextChat,
    updated_by: opts.updated_by ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client.from("telegram_config").upsert(payload);
  if (error) throw new Error(error.message);

  return getTelegramConfigPublic();
}

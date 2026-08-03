import { createServiceClient } from "@/lib/supabase-service";

const CONFIG_ID = "b0000000-0000-0000-0000-000000000001";

function maskKey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function looksLikeGeminiApiKey(value: string): boolean {
  const v = value.trim();
  if (v.length < 20 || v.length > 200) return false;
  // Google AI Studio / Gemini keys (AIza… or newer AQ.… forms)
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(v)) return true;
  if (/^AQ\.[0-9A-Za-z_-]{20,}$/.test(v)) return true;
  return false;
}

export async function loadGeminiApiKey(): Promise<{
  key: string;
  source: "database" | "env";
} | null> {
  try {
    const client = createServiceClient();
    const { data } = await client
      .from("telegram_config")
      .select("gemini_api_key")
      .eq("id", CONFIG_ID)
      .maybeSingle();
    const dbKey = (data?.gemini_api_key || "").trim();
    if (dbKey) return { key: dbKey, source: "database" };
  } catch (e) {
    console.error("loadGeminiApiKey db", e);
  }

  const envKey = (process.env.GEMINI_API_KEY || "").trim();
  if (envKey) return { key: envKey, source: "env" };
  return null;
}

export async function isGeminiConfigured(): Promise<boolean> {
  return Boolean(await loadGeminiApiKey());
}

export async function getGeminiConfigPublic() {
  const loaded = await loadGeminiApiKey();
  return {
    configured: Boolean(loaded),
    source: loaded?.source ?? ("none" as const),
    key_masked: loaded ? maskKey(loaded.key) : "",
  };
}

export async function saveGeminiApiKey(opts: {
  api_key: string;
  updated_by?: string | null;
}): Promise<{ ok: true; key_masked: string } | { ok: false; error: string }> {
  const key = opts.api_key.trim();
  if (!key || key.includes("…") || key.includes("•")) {
    return { ok: false, error: "مفتاح غير صالح" };
  }
  if (!looksLikeGeminiApiKey(key) && key.length < 20) {
    return { ok: false, error: "شكل مفتاح Gemini غير معروف" };
  }

  const client = createServiceClient();
  const { error } = await client.from("telegram_config").upsert({
    id: CONFIG_ID,
    gemini_api_key: key,
    updated_by: opts.updated_by ?? null,
    updated_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, key_masked: maskKey(key) };
}

export async function clearGeminiApiKey(updated_by?: string | null) {
  const client = createServiceClient();
  const { error } = await client
    .from("telegram_config")
    .update({
      gemini_api_key: null,
      updated_by: updated_by ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", CONFIG_ID);
  if (error) throw new Error(error.message);
}

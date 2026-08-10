import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MISSING_SERVICE_ENV_AR =
  "مفتاح خدمة Supabase غير مضبوط على السيرفر. من Vercel → Settings → Environment Variables أضف SUPABASE_SERVICE_ROLE_KEY (وأكد وجود NEXT_PUBLIC_SUPABASE_URL) ثم أعد النشر.";

let cachedClient: SupabaseClient | null = null;

function resolveUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) {
    throw new Error(`${MISSING_SERVICE_ENV_AR} (ناقص: NEXT_PUBLIC_SUPABASE_URL)`);
  }
  return url;
}

async function resolveServiceKey(): Promise<string> {
  const envKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (envKey) return envKey;
  // No DB/anon fallback — that path exposed service_role to the Data API.
  throw new Error(`${MISSING_SERVICE_ENV_AR} (ناقص: SUPABASE_SERVICE_ROLE_KEY)`);
}

/** Service-role client for privileged backup / user-admin / Jarvis operations. */
export async function createServiceClient(): Promise<SupabaseClient> {
  if (cachedClient) return cachedClient;

  const url = resolveUrl();
  const key = await resolveServiceKey();

  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/** Prefer service role; return null when the key is not configured. */
export async function tryCreateServiceClient(): Promise<SupabaseClient | null> {
  try {
    return await createServiceClient();
  } catch {
    return null;
  }
}

export { MISSING_SERVICE_ENV_AR };

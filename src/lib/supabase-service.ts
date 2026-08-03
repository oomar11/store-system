import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MISSING_SERVICE_ENV_AR =
  "مفتاح خدمة Supabase غير مضبوط على السيرفر. من Vercel → Settings → Environment Variables أضف SUPABASE_SERVICE_ROLE_KEY (وأكد وجود NEXT_PUBLIC_SUPABASE_URL) ثم أعد النشر.";

/** Service-role client for privileged backup / user-admin operations. */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url && !key) {
    throw new Error(
      `${MISSING_SERVICE_ENV_AR} (ناقص: NEXT_PUBLIC_SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY)`
    );
  }
  if (!url) {
    throw new Error(
      `${MISSING_SERVICE_ENV_AR} (ناقص: NEXT_PUBLIC_SUPABASE_URL)`
    );
  }
  if (!key) {
    throw new Error(
      `${MISSING_SERVICE_ENV_AR} (ناقص: SUPABASE_SERVICE_ROLE_KEY)`
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Prefer service role; return null when the env key is not configured. */
export function tryCreateServiceClient(): SupabaseClient | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

export { MISSING_SERVICE_ENV_AR };

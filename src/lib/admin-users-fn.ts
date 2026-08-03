import { createServerSupabaseClient } from "@/lib/supabase-server";

type AdminUsersResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/**
 * Call the Supabase Edge Function `admin-users`, which has access to the
 * project service role without needing SUPABASE_SERVICE_ROLE_KEY on Vercel.
 */
export async function callAdminUsersFunction<T = Record<string, unknown>>(
  payload: Record<string, unknown>
): Promise<AdminUsersResult<T>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return {
      ok: false,
      status: 503,
      error: "NEXT_PUBLIC_SUPABASE_URL أو NEXT_PUBLIC_SUPABASE_ANON_KEY غير مضبوط",
    };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    return { ok: false, status: 401, error: "يجب تسجيل الدخول" };
  }

  const res = await fetch(`${url}/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: String(body.error || "تعذر تنفيذ العملية"),
    };
  }

  return { ok: true, data: body as T };
}

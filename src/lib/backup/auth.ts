import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { NextRequest } from "next/server";
import {
  canAccess,
  type AppPermission,
  type PermissionSubject,
} from "@/lib/permissions";

export type OwnerAuth =
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string };

async function loadAuthProfile(): Promise<
  | { ok: true; userId: string; subject: PermissionSubject; role: string }
  | { ok: false; status: number; message: string }
> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, status: 401, message: "يجب تسجيل الدخول" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, permissions, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.is_active === false) {
    return { ok: false, status: 403, message: "الحساب غير مفعّل" };
  }

  return {
    ok: true,
    userId: user.id,
    role: profile.role,
    subject: {
      role: profile.role,
      permissions: profile.permissions ?? null,
    },
  };
}

export async function requirePermission(
  permission: AppPermission,
  deniedMessage = "ليس لديك صلاحية لهذه العملية"
): Promise<OwnerAuth> {
  const auth = await loadAuthProfile();
  if (!auth.ok) return auth;
  if (!canAccess(auth.subject, permission)) {
    return { ok: false, status: 403, message: deniedMessage };
  }
  return { ok: true, userId: auth.userId };
}

/** Owner role or elevated system permissions. */
export async function requireOwner(): Promise<OwnerAuth> {
  const auth = await loadAuthProfile();
  if (!auth.ok) return auth;
  if (
    auth.role === "owner" ||
    canAccess(auth.subject, "settings.backup") ||
    canAccess(auth.subject, "users.manage")
  ) {
    return { ok: true, userId: auth.userId };
  }
  return {
    ok: false,
    status: 403,
    message: "هذه العملية متاحة للمالك فقط",
  };
}

export function requireCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export type BackupRunSource =
  | "manual"
  | "cron"
  | "telegram"
  | "restore"
  | "factory_reset";

export async function logBackupRun(opts: {
  source: BackupRunSource;
  status: "success" | "failed";
  byteSize?: number;
  errorMessage?: string;
  createdBy?: string | null;
}) {
  try {
    const { createServiceClient } = await import("@/lib/supabase-service");
    const client = await createServiceClient();
    await client.from("backup_runs").insert({
      source: opts.source,
      status: opts.status,
      byte_size: opts.byteSize ?? null,
      error_message: opts.errorMessage ?? null,
      created_by: opts.createdBy ?? null,
    });
  } catch (e) {
    console.error("logBackupRun failed", e);
  }
}

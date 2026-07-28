import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/backup/auth";
import { createServiceClient } from "@/lib/supabase-service";
import {
  isUsingTemplate,
  normalizePermissions,
  templatePermissions,
} from "@/lib/permissions";
import type { UserRole } from "@/types";

export const runtime = "nodejs";

const ROLES: UserRole[] = ["owner", "manager", "employee"];

function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

function isValidUsername(username: string) {
  return /^[a-z0-9._-]{3,32}$/.test(username);
}

function resolvePermissionsPayload(
  role: UserRole,
  raw: unknown
): string[] | null {
  const custom = normalizePermissions(raw);
  if (custom == null) return null;
  if (isUsingTemplate(role, custom)) return null;
  return custom;
}

export async function GET() {
  const auth = await requirePermission(
    "users.manage",
    "إدارة المستخدمين متاحة لمن لديه صلاحية إدارة المستخدمين"
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const client = createServiceClient();
    const { data, error } = await client
      .from("profiles")
      .select("id, email, full_name, role, is_active, permissions, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: data || [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر تحميل المستخدمين";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePermission(
    "users.manage",
    "إدارة المستخدمين متاحة لمن لديه صلاحية إدارة المستخدمين"
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const username = normalizeUsername(String(body.username || ""));
    const password = String(body.password || "");
    const fullName = String(body.full_name || "").trim() || username;
    const role = String(body.role || "employee") as UserRole;
    const permissions = resolvePermissionsPayload(role, body.permissions);

    if (!isValidUsername(username)) {
      return NextResponse.json(
        {
          error:
            "اسم المستخدم يجب أن يكون 3–32 حرفًا (إنجليزي صغير، أرقام، . _ -)",
        },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "كلمة المرور يجب ألا تقل عن 6 أحرف" },
        { status: 400 }
      );
    }

    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: "الدور غير صالح" }, { status: 400 });
    }

    const email = `${username}@store.local`;
    const client = createServiceClient();

    const { data: created, error: createError } =
      await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    if (createError || !created.user) {
      const msg = createError?.message || "تعذر إنشاء المستخدم";
      const friendly = /already|exists|registered/i.test(msg)
        ? "اسم المستخدم مستخدم بالفعل"
        : msg;
      return NextResponse.json({ error: friendly }, { status: 400 });
    }

    const userId = created.user.id;

    const { error: profileError } = await client
      .from("profiles")
      .update({
        full_name: fullName,
        role,
        email,
        is_active: true,
        permissions,
      })
      .eq("id", userId);

    if (profileError) {
      return NextResponse.json(
        {
          error:
            "تم إنشاء الحساب لكن تعذر ضبط الصلاحيات: " + profileError.message,
          user_id: userId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: userId,
        email,
        full_name: fullName,
        role,
        is_active: true,
        permissions: permissions ?? templatePermissions(role),
        username,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر إنشاء المستخدم";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/backup/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  MISSING_SERVICE_ENV_AR,
  tryCreateServiceClient,
} from "@/lib/supabase-service";
import { callAdminUsersFunction } from "@/lib/admin-users-fn";
import {
  isUsingTemplate,
  normalizePermissions,
} from "@/lib/permissions";
import { logAuditEvent } from "@/lib/audit";
import type { UserRole } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const ROLES: UserRole[] = ["owner", "manager", "employee"];

type Params = { params: Promise<{ id: string }> };

function resolvePermissionsPayload(
  role: UserRole,
  raw: unknown,
  clearTemplate: boolean
): string[] | null | undefined {
  if (clearTemplate) return null;
  if (raw === undefined) return undefined;
  const custom = normalizePermissions(raw);
  if (custom == null) return null;
  if (isUsingTemplate(role, custom)) return null;
  return custom;
}

async function profilesClient(): Promise<SupabaseClient> {
  return tryCreateServiceClient() ?? (await createServerSupabaseClient());
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requirePermission(
    "users.manage",
    "إدارة المستخدمين متاحة لمن لديه صلاحية إدارة المستخدمين"
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "معرّف المستخدم مطلوب" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const service = tryCreateServiceClient();
    const client = service ?? (await createServerSupabaseClient());

    const { data: target, error: targetError } = await client
      .from("profiles")
      .select("id, role, is_active, email, full_name, permissions")
      .eq("id", id)
      .maybeSingle();

    if (targetError || !target) {
      return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    }

    const nextRole = (body.role !== undefined
      ? String(body.role)
      : target.role) as UserRole;

    const updates: {
      role?: UserRole;
      is_active?: boolean;
      full_name?: string;
      permissions?: string[] | null;
    } = {};

    if (body.role !== undefined) {
      if (!ROLES.includes(nextRole)) {
        return NextResponse.json({ error: "الدور غير صالح" }, { status: 400 });
      }
      updates.role = nextRole;
    }

    if (body.is_active !== undefined) {
      updates.is_active = Boolean(body.is_active);
    }

    if (body.full_name !== undefined) {
      const name = String(body.full_name || "").trim();
      if (!name) {
        return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });
      }
      updates.full_name = name;
    }

    if (body.permissions !== undefined || body.use_template === true) {
      const resolved = resolvePermissionsPayload(
        nextRole,
        body.permissions,
        body.use_template === true
      );
      if (resolved !== undefined) {
        updates.permissions = resolved;
      }
    } else if (body.role !== undefined && target.permissions == null) {
      updates.permissions = null;
    }

    if (id === auth.userId) {
      if (updates.is_active === false) {
        return NextResponse.json(
          { error: "لا يمكنك تعطيل حسابك أنت" },
          { status: 400 }
        );
      }
      if (updates.role && updates.role !== "owner") {
        const { count } = await client
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "owner")
          .eq("is_active", true);
        if ((count || 0) <= 1) {
          return NextResponse.json(
            { error: "لا يمكن إزالة دور المالك عن الحساب الوحيد النشط" },
            { status: 400 }
          );
        }
      }
    }

    const needsAdminAuth = body.password !== undefined;

    if (Object.keys(updates).length > 0) {
      const writer = service ?? client;
      const { error: updateError } = await writer
        .from("profiles")
        .update(updates)
        .eq("id", id);

      if (updateError) {
        const msg = updateError.message || "";
        if (
          !service &&
          /permission|policy|فقط المالك|row-level|rls/i.test(msg)
        ) {
          return NextResponse.json(
            { error: MISSING_SERVICE_ENV_AR },
            { status: 503 }
          );
        }
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    if (needsAdminAuth) {
      const password = String(body.password || "");
      if (password.length < 6) {
        return NextResponse.json(
          { error: "كلمة المرور يجب ألا تقل عن 6 أحرف" },
          { status: 400 }
        );
      }
      if (service) {
        const { error: passError } = await service.auth.admin.updateUserById(
          id,
          { password }
        );
        if (passError) {
          return NextResponse.json(
            { error: passError.message },
            { status: 500 }
          );
        }
      } else {
        const viaFn = await callAdminUsersFunction({
          action: "set_password",
          user_id: id,
          password,
        });
        if (!viaFn.ok) {
          return NextResponse.json(
            { error: viaFn.error },
            { status: viaFn.status }
          );
        }
      }
    }

    if (Object.keys(updates).length > 0 || body.password !== undefined) {
      const auditClient = service ?? client;
      await logAuditEvent(auditClient, {
        action: "user.update",
        entityType: "user",
        entityId: id,
        entityLabel: target.full_name || target.email,
        before: {
          role: target.role,
          is_active: target.is_active,
          permissions: target.permissions,
          full_name: target.full_name,
        },
        after: {
          role: updates.role ?? target.role,
          is_active: updates.is_active ?? target.is_active,
          permissions:
            updates.permissions !== undefined
              ? updates.permissions
              : target.permissions,
          full_name: updates.full_name ?? target.full_name,
        },
        meta: {
          password_changed: body.password !== undefined,
        },
        source: "api",
        actorId: auth.userId,
      });
    }

    const reader = await profilesClient();
    const { data: refreshed } = await reader
      .from("profiles")
      .select("id, email, full_name, role, is_active, permissions, created_at")
      .eq("id", id)
      .single();

    return NextResponse.json({ ok: true, user: refreshed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر تحديث المستخدم";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requirePermission(
    "users.manage",
    "إدارة المستخدمين متاحة لمن لديه صلاحية إدارة المستخدمين"
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "معرّف المستخدم مطلوب" }, { status: 400 });
  }

  if (id === auth.userId) {
    return NextResponse.json(
      { error: "لا يمكنك حذف حسابك أنت" },
      { status: 400 }
    );
  }

  try {
    const service = tryCreateServiceClient();
    const client = service ?? (await createServerSupabaseClient());

    const { data: target, error: targetError } = await client
      .from("profiles")
      .select("id, role, is_active, email, full_name")
      .eq("id", id)
      .maybeSingle();

    if (targetError || !target) {
      return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    }

    if (target.role === "owner" && target.is_active) {
      const { count } = await client
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "owner")
        .eq("is_active", true);
      if ((count || 0) <= 1) {
        return NextResponse.json(
          { error: "لا يمكن حذف المالك الوحيد النشط" },
          { status: 400 }
        );
      }
    }

    if (service) {
      const { error: deleteError } = await service.auth.admin.deleteUser(id);
      if (deleteError) {
        return NextResponse.json(
          { error: deleteError.message || "تعذر حذف المستخدم" },
          { status: 500 }
        );
      }
    } else {
      const viaFn = await callAdminUsersFunction({
        action: "delete",
        user_id: id,
      });
      if (!viaFn.ok) {
        return NextResponse.json(
          { error: viaFn.error },
          { status: viaFn.status }
        );
      }
    }

    await logAuditEvent(client, {
      action: "user.delete",
      entityType: "user",
      entityId: id,
      entityLabel: target.full_name || target.email,
      before: {
        role: target.role,
        is_active: target.is_active,
        email: target.email,
        full_name: target.full_name,
      },
      source: "api",
      actorId: auth.userId,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر حذف المستخدم";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

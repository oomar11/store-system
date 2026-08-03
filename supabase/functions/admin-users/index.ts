import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ROLES = new Set(["owner", "manager", "employee"]);

type Action =
  | {
      action: "create";
      email: string;
      password: string;
      full_name?: string;
      role?: string;
      permissions?: string[] | null;
    }
  | { action: "set_password"; user_id: string; password: string }
  | { action: "delete"; user_id: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "غير مصرح" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: "جلسة غير صالحة" }, 401);
    }

    const { data: canManage, error: permErr } = await userClient.rpc(
      "has_app_permission",
      { p_permission: "users.manage" }
    );
    if (permErr || !canManage) {
      return json({ error: "ليس لديك صلاحية إدارة المستخدمين" }, 403);
    }

    const body = (await req.json()) as Action;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (body.action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const fullName = String(body.full_name || "").trim() || email;
      const role = String(body.role || "employee");
      const permissions =
        body.permissions === undefined
          ? undefined
          : Array.isArray(body.permissions)
            ? body.permissions
            : null;

      if (!email || !password) {
        return json({ error: "البريد وكلمة المرور مطلوبان" }, 400);
      }
      if (password.length < 6) {
        return json(
          { error: "كلمة المرور قصيرة جداً (6 أحرف على الأقل)" },
          400
        );
      }
      if (!ROLES.has(role)) {
        return json({ error: "الدور غير صالح" }, 400);
      }

      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });
      if (createErr || !created.user) {
        const msg = createErr?.message || "فشل إنشاء المستخدم";
        const friendly = /already|exists|registered/i.test(msg)
          ? "اسم المستخدم مستخدم بالفعل"
          : msg;
        return json({ error: friendly }, 400);
      }

      const profileUpdate: Record<string, unknown> = {
        full_name: fullName,
        role,
        email,
        is_active: true,
      };
      if (permissions !== undefined) {
        profileUpdate.permissions = permissions;
      }

      const { error: upsertErr } = await admin
        .from("profiles")
        .update(profileUpdate)
        .eq("id", created.user.id);
      if (upsertErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: upsertErr.message }, 400);
      }

      return json({
        user: {
          id: created.user.id,
          email,
          full_name: fullName,
          role,
          is_active: true,
          permissions: permissions ?? null,
        },
      });
    }

    if (body.action === "set_password") {
      const userId = String(body.user_id || "");
      const password = String(body.password || "");
      if (!userId || password.length < 6) {
        return json({ error: "كلمة مرور غير صالحة" }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === "delete") {
      const userId = String(body.user_id || "");
      if (!userId) return json({ error: "معرّف مطلوب" }, 400);
      if (userId === user.id) {
        return json({ error: "لا يمكن حذف حسابك الحالي" }, 400);
      }

      const { data: target } = await admin
        .from("profiles")
        .select("id, role, is_active")
        .eq("id", userId)
        .maybeSingle();
      if (!target) {
        return json({ error: "المستخدم غير موجود" }, 404);
      }
      if (target.role === "owner" && target.is_active) {
        const { count } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "owner")
          .eq("is_active", true);
        if ((count || 0) <= 1) {
          return json({ error: "لا يمكن حذف المالك الوحيد النشط" }, 400);
        }
      }

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "خطأ غير متوقع" },
      500
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

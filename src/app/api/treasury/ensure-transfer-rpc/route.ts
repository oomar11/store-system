import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROJECT_REF = "qcvhddjvftpjczdxcfjz";

/**
 * Apply transfer RPC migrations (20260813 + 20260814) on production.
 * Tries Supabase Management API / database query with available tokens.
 * Owner-only. Safe to re-run (CREATE OR REPLACE).
 */
export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: isOwner } = await supabase.rpc("is_owner");
    if (!isOwner) {
      return NextResponse.json(
        { error: "تطبيق ترحيل الخزينة للمالك فقط" },
        { status: 403 }
      );
    }

    const migrations = [
      "20260813_transfer_revive_inactive_safes.sql",
      "20260814_transfer_resolve_by_safe_name.sql",
    ];
    const sqlParts: string[] = [];
    for (const name of migrations) {
      const filePath = path.join(
        process.cwd(),
        "supabase",
        "migrations",
        name
      );
      sqlParts.push(await readFile(filePath, "utf8"));
    }
    const query = sqlParts.join("\n\n");

    const tokens = [
      process.env.SUPABASE_ACCESS_TOKEN?.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ].filter(Boolean) as string[];

    const attempts: Array<{ via: string; status: number; body: string }> = [];

    for (const token of tokens) {
      for (const url of [
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/migrations`,
      ]) {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            url.endsWith("/migrations")
              ? { query, name: "transfer_resolve_by_safe_name" }
              : { query }
          ),
        });
        const body = await res.text();
        attempts.push({ via: url, status: res.status, body: body.slice(0, 500) });
        if (res.ok) {
          return NextResponse.json({
            ok: true,
            applied: true,
            via: url,
            attempts,
          });
        }
      }
    }

    // Probe whether 6-arg already exists (idempotent success).
    const service = await createServiceClient();
    const probe = await service.rpc("transfer_between_safes", {
      p_from_safe_id: "00000000-0000-0000-0000-000000000001",
      p_to_safe_id: "00000000-0000-0000-0000-000000000002",
      p_amount: 0.01,
      p_description: null,
      p_from_safe_name: "__probe_from__",
      p_to_safe_name: "__probe_to__",
    });
    const sixArgReady = !/Could not find the function|PGRST202/i.test(
      probe.error?.message || ""
    );

    return NextResponse.json(
      {
        ok: false,
        applied: false,
        sixArgReady,
        error:
          "تعذر تطبيق SQL من السيرفر — الصق الملفات 20260813 و 20260814 في SQL Editor",
        sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
        attempts,
        probe: probe.error?.message || null,
      },
      { status: sixArgReady ? 200 : 503 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر تطبيق ترحيل التحويل";
    console.error("[api/treasury/ensure-transfer-rpc]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const service = await createServiceClient();
    const probe = await service.rpc("transfer_between_safes", {
      p_from_safe_id: "00000000-0000-0000-0000-000000000001",
      p_to_safe_id: "00000000-0000-0000-0000-000000000002",
      p_amount: 0.01,
      p_description: null,
      p_from_safe_name: "__probe_from__",
      p_to_safe_name: "__probe_to__",
    });
    const sixArgReady = !/Could not find the function|PGRST202/i.test(
      probe.error?.message || ""
    );
    return NextResponse.json({
      sixArgReady,
      probe: probe.error?.message || "ok_or_business_error",
      sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "probe failed",
      },
      { status: 500 }
    );
  }
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import { requireWorkshopBridgeSecret } from "@/lib/workshop-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROJECT_REF = "qcvhddjvftpjczdxcfjz";
const MIGRATION_FILE = "20260816_customer_business_lines.sql";

type ProbeResult = {
  ready: boolean;
  probe: string | null;
};

async function probeBusinessLinesSchema(): Promise<ProbeResult> {
  const service = await createServiceClient();
  const colProbe = await service
    .from("customers")
    .select("business_lines, business_lines_manual, business_lines_locked")
    .limit(1);
  const message = colProbe.error?.message || null;
  const missing =
    /column ["']?business_lines["']? .* does not exist/i.test(message || "") ||
    /Could not find the ['"]?business_lines['"]? column/i.test(message || "");
  return {
    ready: !missing && !colProbe.error,
    probe: message,
  };
}

async function assertCanApply(
  request: NextRequest
): Promise<NextResponse | null> {
  if (await requireWorkshopBridgeSecret(request)) {
    return null;
  }

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
      { error: "تفعيل تصنيف العملاء للمالك فقط" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Apply customer business_lines migration on production.
 * Owner session OR workshop bridge secret. Safe to re-run.
 */
export async function POST(request: NextRequest) {
  try {
    const denied = await assertCanApply(request);
    if (denied) return denied;

    const before = await probeBusinessLinesSchema();
    if (before.ready) {
      return NextResponse.json({
        ok: true,
        applied: false,
        ready: true,
        message: "تصنيف العملاء جاهز مسبقاً",
        sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
        migration: MIGRATION_FILE,
      });
    }

    const filePath = path.join(
      process.cwd(),
      "supabase",
      "migrations",
      MIGRATION_FILE
    );
    const query = await readFile(filePath, "utf8");

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
              ? { query, name: "customer_business_lines" }
              : { query }
          ),
        });
        const body = await res.text();
        attempts.push({
          via: url,
          status: res.status,
          body: body.slice(0, 500),
        });
        if (res.ok) {
          const after = await probeBusinessLinesSchema();
          return NextResponse.json({
            ok: after.ready,
            applied: true,
            via: url,
            attempts,
            ...after,
            sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
            migration: MIGRATION_FILE,
          });
        }
      }
    }

    const after = await probeBusinessLinesSchema();
    return NextResponse.json(
      {
        ok: after.ready,
        applied: false,
        error: after.ready
          ? null
          : "تعذر تطبيق SQL من السيرفر — افتح SQL Editor وشغّل ملف الترحيل",
        sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
        migration: MIGRATION_FILE,
        sql: query,
        attempts,
        ...after,
      },
      { status: after.ready ? 200 : 503 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر تفعيل تصنيف العملاء";
    console.error("[api/customers/ensure-business-lines]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await probeBusinessLinesSchema();
    return NextResponse.json({
      ...result,
      sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
      migration: MIGRATION_FILE,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ready: false,
        error: err instanceof Error ? err.message : "probe failed",
        sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
        migration: MIGRATION_FILE,
      },
      { status: 500 }
    );
  }
}

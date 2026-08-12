import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROJECT_REF = "qcvhddjvftpjczdxcfjz";
const MIGRATION_FILE =
  "20260815_fix_cross_app_ledger_details_and_wipe.sql";

type ProbeResult = {
  ready: boolean;
  detailsColumnOk: boolean;
  singleRpcOk: boolean;
  probe: string | null;
};

async function probeLedgerSchema(): Promise<ProbeResult> {
  const service = await createServiceClient();
  const probe = await service.rpc("apply_cross_app_ledger_entry", {
    p_source_system: "plisse",
    p_source_ref: "__probe_ledger_schema__",
    p_party_type: "customer",
    p_party_id: "00000000-0000-0000-0000-000000000001",
    p_entry_type: "workshop_void",
    p_amount: 0,
    p_direction: "debit",
    p_occurred_at: null,
    p_notes: null,
    p_project_label: null,
    p_details: { probe: true },
  });

  const message = probe.error?.message || null;
  const ambiguous = /Could not choose the best candidate function/i.test(
    message || ""
  );
  const missingFn = /Could not find the function|PGRST202/i.test(message || "");
  const missingCol =
    /column ["']?details["']? of relation ["']?cross_app_ledger_entries["']? does not exist/i.test(
      message || ""
    ) ||
    /Could not find the ['"]?details['"]? column of ['"]?cross_app_ledger_entries['"]?/i.test(
      message || ""
    );
  // Missing customer is expected for the probe UUID — schema is healthy.
  const businessOk =
    !message ||
    /العميل غير موجود|party_id|customer/i.test(message) ||
    /voided|ok/i.test(message);

  return {
    ready: !ambiguous && !missingFn && !missingCol && businessOk,
    detailsColumnOk: !missingCol,
    singleRpcOk: !ambiguous && !missingFn,
    probe: message,
  };
}

/**
 * Apply 20260815 ledger fix on production (details column + single RPC + wipe).
 * Owner-only. Safe to re-run.
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
        { error: "إصلاح جسر الحساب للمالك فقط" },
        { status: 403 }
      );
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
              ? { query, name: "fix_cross_app_ledger_details_and_wipe" }
              : { query }
          ),
        });
        const body = await res.text();
        attempts.push({ via: url, status: res.status, body: body.slice(0, 500) });
        if (res.ok) {
          const after = await probeLedgerSchema();
          return NextResponse.json({
            ok: true,
            applied: true,
            via: url,
            attempts,
            ...after,
          });
        }
      }
    }

    const after = await probeLedgerSchema();
    return NextResponse.json(
      {
        ok: after.ready,
        applied: false,
        error: after.ready
          ? null
          : "تعذر تطبيق SQL من السيرفر — الصق ملف 20260815 في SQL Editor",
        sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
        migration: MIGRATION_FILE,
        attempts,
        ...after,
      },
      { status: after.ready ? 200 : 503 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر إصلاح دفتر جسر الورشة";
    console.error("[api/workshop/ensure-ledger-rpc]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await probeLedgerSchema();
    return NextResponse.json({
      ...result,
      sqlEditor: `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`,
      migration: MIGRATION_FILE,
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

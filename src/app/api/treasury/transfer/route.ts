import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { tryCreateServiceClient } from "@/lib/supabase-service";
import {
  transferBetweenSafes,
  transferBetweenSafesDirect,
} from "@/lib/safe-transactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mobile-safe transfer endpoint.
 * 1) Auth + treasury permission via user session
 * 2) Prefer service-role direct transfer (works even when the 6-arg RPC
 *    migration is not applied yet on production)
 * 3) Fall back to user-scoped RPC path
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: canTreasury, error: permErr } = await supabase.rpc(
      "has_app_permission",
      { p_permission: "treasury" }
    );
    if (permErr) {
      return NextResponse.json(
        { error: permErr.message || "تعذر التحقق من الصلاحيات" },
        { status: 400 }
      );
    }
    if (!canTreasury) {
      return NextResponse.json(
        { error: "تحويلات الخزينة غير مسموحة لصلاحياتك" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      fromSafeId?: string;
      toSafeId?: string;
      fromSafeName?: string;
      toSafeName?: string;
      amount?: number;
      description?: string;
      notes?: string;
    };

    const amount = Number(body.amount) || 0;
    if (amount <= 0) {
      return NextResponse.json(
        { error: "أدخل مبلغاً صحيحاً" },
        { status: 400 }
      );
    }

    const params = {
      fromSafeId: String(body.fromSafeId || ""),
      toSafeId: String(body.toSafeId || ""),
      fromSafeName: body.fromSafeName || null,
      toSafeName: body.toSafeName || null,
      amount,
      description: body.description || "تحويل بين الخزائن",
      notes: body.notes || null,
    };

    const service = await tryCreateServiceClient();
    if (service) {
      await transferBetweenSafesDirect(service, params);
      return NextResponse.json({ ok: true, path: "service_direct" });
    }

    // No service role on this host — use session RPC (needs live ids).
    await transferBetweenSafes(supabase, params);
    return NextResponse.json({ ok: true, path: "rpc" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر إتمام التحويل بين الخزائن";
    console.error("[api/treasury/transfer]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

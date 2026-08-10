import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { transferBetweenSafes } from "@/lib/safe-transactions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mobile-safe transfer endpoint.
 * Resolves stale/empty client ids using safe names before calling the RPC,
 * which fixes «الخزنة الرئيسية» ↔ «خزنة المحل» failures on phone selects.
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

    await transferBetweenSafes(supabase, {
      fromSafeId: String(body.fromSafeId || ""),
      toSafeId: String(body.toSafeId || ""),
      fromSafeName: body.fromSafeName || null,
      toSafeName: body.toSafeName || null,
      amount,
      description: body.description || "تحويل بين الخزائن",
      notes: body.notes || null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "تعذر إتمام التحويل بين الخزائن";
    console.error("[api/treasury/transfer]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

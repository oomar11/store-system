import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import {
  forceAbandonOpenShift,
  type ShiftAbandonReason,
} from "@/lib/shift-abandon";

export const runtime = "nodejs";

const GRACE_MS = 18_000;

type Action = "request" | "cancel" | "force";

async function parseBody(request: NextRequest): Promise<{
  action: Action;
  reason?: ShiftAbandonReason;
  shiftId?: string;
}> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = (await request.json()) as Record<string, unknown>;
    return {
      action: (json.action as Action) || "request",
      reason: json.reason as ShiftAbandonReason | undefined,
      shiftId: typeof json.shiftId === "string" ? json.shiftId : undefined,
    };
  }

  // sendBeacon often sends text/plain or FormData
  const text = await request.text();
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return {
      action: (json.action as Action) || "request",
      reason: json.reason as ShiftAbandonReason | undefined,
      shiftId: typeof json.shiftId === "string" ? json.shiftId : undefined,
    };
  } catch {
    const params = new URLSearchParams(text);
    return {
      action: (params.get("action") as Action) || "request",
      reason: (params.get("reason") as ShiftAbandonReason) || undefined,
      shiftId: params.get("shiftId") || undefined,
    };
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const body = await parseBody(request);
  const service = await createServiceClient();

  const { data: openShift } = await service
    .from("shifts")
    .select("id, opened_by, status, abandon_requested_at")
    .eq("status", "open")
    .maybeSingle();

  if (!openShift) {
    return NextResponse.json({ ok: true, closed: false, message: "no_open_shift" });
  }

  // Employees can only abandon the shift they opened (or any if manager)
  const { data: profile } = await service
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const isElevated =
    profile?.role === "owner" || profile?.role === "manager";
  if (
    !isElevated &&
    openShift.opened_by &&
    openShift.opened_by !== user.id
  ) {
    return NextResponse.json({ error: "وردية مستخدم آخر" }, { status: 403 });
  }

  if (body.shiftId && body.shiftId !== openShift.id) {
    return NextResponse.json({ error: "وردية غير مطابقة" }, { status: 400 });
  }

  if (body.action === "cancel") {
    await service
      .from("shifts")
      .update({ abandon_requested_at: null })
      .eq("id", openShift.id)
      .eq("status", "open");
    return NextResponse.json({ ok: true, cancelled: true });
  }

  if (body.action === "force") {
    const reason: ShiftAbandonReason =
      body.reason === "abandoned_logout"
        ? "abandoned_logout"
        : "abandoned_unload";
    const result = await forceAbandonOpenShift(service, {
      shiftId: openShift.id,
      userId: user.id,
      reason,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  // action === request (page unload): grace period then finalize
  const requestedAt = new Date().toISOString();
  await service
    .from("shifts")
    .update({ abandon_requested_at: requestedAt })
    .eq("id", openShift.id)
    .eq("status", "open");

  const shiftId = openShift.id;
  const userId = user.id;

  after(async () => {
    await new Promise((r) => setTimeout(r, GRACE_MS));
    try {
      const client = await createServiceClient();
      const { data: still } = await client
        .from("shifts")
        .select("id, status, abandon_requested_at")
        .eq("id", shiftId)
        .maybeSingle();

      if (!still || still.status !== "open") return;
      if (!still.abandon_requested_at) return;
      // Only finalize if this request (or a later one) is still pending
      const requestedMs = new Date(still.abandon_requested_at).getTime();
      if (Date.now() - requestedMs < GRACE_MS - 1000) return;

      await forceAbandonOpenShift(client, {
        shiftId,
        userId,
        reason: "abandoned_unload",
      });
    } catch (e) {
      console.error("shift abandon finalize failed", e);
    }
  });

  return NextResponse.json({ ok: true, scheduled: true });
}

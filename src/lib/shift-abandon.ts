import type { SupabaseClient } from "@supabase/supabase-js";
import { computeShiftTotals } from "@/lib/shifts";

export type ShiftAbandonReason = "abandoned_unload" | "abandoned_logout";

export async function notifyManagersShiftAbandoned(
  service: SupabaseClient,
  opts: {
    shiftId: string;
    employeeName: string;
    reason: ShiftAbandonReason;
    drawerName?: string | null;
  }
) {
  const reasonLabel =
    opts.reason === "abandoned_logout"
      ? "تسجيل خروج بدون إقفال الوردية"
      : "إغلاق البرنامج/الصفحة بدون إقفال الوردية";

  const title = "وردية اتقفلت بدون تسليم الدرج";
  const body = `${opts.employeeName} — ${reasonLabel}${
    opts.drawerName ? ` (الدرج: ${opts.drawerName})` : ""
  }. راجع الوردية وعدّ الدرج.`;

  const { data: managers } = await service
    .from("profiles")
    .select("id, role")
    .eq("is_active", true)
    .in("role", ["owner", "manager"]);

  const rows = (managers || []).map((m) => ({
    user_id: m.id,
    type: "shift_abandoned",
    title,
    body,
    link: `/shifts/${opts.shiftId}`,
    meta: {
      shift_id: opts.shiftId,
      reason: opts.reason,
    },
  }));

  if (rows.length) {
    await service.from("app_notifications").insert(rows);
  }

  try {
    const { sendTelegramMessage } = await import("@/lib/backup/telegram");
    await sendTelegramMessage(`⚠️ ويندور\n${title}\n${body}`);
  } catch {
    // Telegram optional
  }
}

/** Force-close an open shift without a proper cash hand-over count. */
export async function forceAbandonOpenShift(
  service: SupabaseClient,
  opts: {
    shiftId: string;
    userId: string;
    reason: ShiftAbandonReason;
  }
) {
  const { data: shift, error: fetchErr } = await service
    .from("shifts")
    .select("*, safe:safes!shifts_safe_id_fkey(id, name, balance)")
    .eq("id", opts.shiftId)
    .eq("status", "open")
    .maybeSingle();

  if (fetchErr) throw new Error(fetchErr.message);
  if (!shift) return { closed: false as const };

  let expected = Number(shift.opening_cash) || 0;
  try {
    const totals = await computeShiftTotals(service, {
      safeId: shift.safe_id,
      openedAt: shift.opened_at,
      openingCash: Number(shift.opening_cash) || 0,
    });
    expected = totals.expectedCash;
  } catch {
    // keep opening as fallback
  }

  const noteLine =
    opts.reason === "abandoned_logout"
      ? "إقفال تلقائي — خروج بدون تسليم الدرج"
      : "إقفال تلقائي — البرنامج/الصفحة اتقفلت بدون تسليم الدرج";

  const prevNotes = (shift.notes || "").trim();
  const notes = prevNotes ? `${prevNotes}\n${noteLine}` : noteLine;

  const { error: updErr } = await service
    .from("shifts")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: opts.userId,
      close_reason: opts.reason,
      abandon_requested_at: null,
      expected_cash: expected,
      counted_cash: null,
      variance: null,
      notes,
    })
    .eq("id", opts.shiftId)
    .eq("status", "open");

  if (updErr) throw new Error(updErr.message);

  const { data: profile } = await service
    .from("profiles")
    .select("full_name")
    .eq("id", opts.userId)
    .maybeSingle();

  await notifyManagersShiftAbandoned(service, {
    shiftId: opts.shiftId,
    employeeName: profile?.full_name || "موظف",
    reason: opts.reason,
    drawerName: shift.safe?.name || null,
  });

  return { closed: true as const, shiftId: opts.shiftId };
}

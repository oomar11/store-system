import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySafeMovement,
  transferBetweenSafes,
} from "@/lib/safe-transactions";

export type ShiftVarianceClass =
  | "transfer"
  | "withdrawal"
  | "deposit"
  | "shortage"
  | "surplus"
  | "other";

export const SHIFT_VARIANCE_CLASS_LABELS: Record<ShiftVarianceClass, string> = {
  transfer: "نقل بين خزائن",
  withdrawal: "سحب نقدي",
  deposit: "إضافة نقدية",
  shortage: "عجز غير مفسر",
  surplus: "زيادة غير مفسرة",
  other: "سبب آخر",
};

export type ShiftRow = {
  id: string;
  status: "open" | "closed";
  safe_id: string;
  opened_by: string | null;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
  sales_total: number | null;
  purchases_total: number | null;
  cash_in: number | null;
  cash_out: number | null;
  notes: string | null;
  close_reason?: "normal" | "abandoned_unload" | "abandoned_logout" | null;
  abandon_requested_at?: string | null;
  variance_class: ShiftVarianceClass | null;
  variance_reason: string | null;
  variance_related_safe_id: string | null;
  variance_classified_by: string | null;
  variance_classified_at: string | null;
  safe?: { id: string; name: string; balance: number } | null;
  opener?: { full_name: string } | null;
  closer?: { full_name: string } | null;
};

export type ClassifyShiftVarianceParams = {
  shift: ShiftRow;
  class: ShiftVarianceClass;
  reason?: string;
  relatedSafeId?: string | null;
  classifiedBy?: string | null;
};

export type ShiftTotals = {
  salesTotal: number;
  purchasesTotal: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
};

export async function fetchOpenShift(supabase: SupabaseClient) {
  // Hint safe_id FK — shifts also references safes via variance_related_safe_id
  const withSafe = await supabase
    .from("shifts")
    .select("*, safe:safes!shifts_safe_id_fkey(id, name, balance)")
    .eq("status", "open")
    .maybeSingle();

  if (!withSafe.error) {
    return (withSafe.data as ShiftRow | null) || null;
  }

  const plain = await supabase
    .from("shifts")
    .select("*")
    .eq("status", "open")
    .maybeSingle();

  if (plain.error) throw new Error(plain.error.message);

  const row = plain.data as ShiftRow | null;
  if (!row) return null;

  const { data: safe } = await supabase
    .from("safes")
    .select("id, name, balance")
    .eq("id", row.safe_id)
    .maybeSingle();

  return { ...row, safe: safe || null } as ShiftRow;
}

export type ShiftInvoiceActivity = {
  id: string;
  invoice_number: string;
  type: string;
  total: number;
  paid_amount: number;
  payment_method: string | null;
  created_at: string;
};

export type ShiftSafeTxnActivity = {
  id: string;
  type: string;
  amount: number;
  reference_type: string | null;
  description: string | null;
  created_at: string;
};

export type ShiftActivity = {
  invoices: ShiftInvoiceActivity[];
  safeTransactions: ShiftSafeTxnActivity[];
  totals: ShiftTotals;
};

export async function computeShiftTotals(
  supabase: SupabaseClient,
  params: {
    safeId: string;
    openedAt: string;
    openingCash: number;
    closedAt?: string | null;
  }
): Promise<ShiftTotals> {
  const since = params.openedAt;

  let invQuery = supabase
    .from("invoices")
    .select("type, total, paid_amount, payment_method, safe_id, created_at")
    .gte("created_at", since)
    .eq("status", "completed");
  if (params.closedAt) {
    invQuery = invQuery.lt("created_at", params.closedAt);
  }

  const { data: invoices } = await invQuery;

  let salesTotal = 0;
  let purchasesTotal = 0;

  for (const inv of invoices || []) {
    const total = Number(inv.total) || 0;
    if (inv.type === "sale") salesTotal += total;
    if (inv.type === "purchase") purchasesTotal += total;
  }

  let txnQuery = supabase
    .from("safe_transactions")
    .select("type, amount, safe_id, reference_type, created_at")
    .eq("safe_id", params.safeId)
    .gte("created_at", since);
  if (params.closedAt) {
    txnQuery = txnQuery.lt("created_at", params.closedAt);
  }

  const { data: txns } = await txnQuery;

  let cashIn = 0;
  let cashOut = 0;

  for (const t of txns || []) {
    const amount = Number(t.amount) || 0;
    if (t.type === "deposit") cashIn += amount;
    else if (t.type === "withdrawal") cashOut += amount;
    else if (t.type === "transfer") {
      if (t.reference_type === "transfer_in") cashIn += amount;
      if (t.reference_type === "transfer_out") cashOut += amount;
    }
  }

  const expectedCash = Number(params.openingCash) + cashIn - cashOut;

  return { salesTotal, purchasesTotal, cashIn, cashOut, expectedCash };
}

async function attachOpenerCloser(
  supabase: SupabaseClient,
  row: ShiftRow
): Promise<ShiftRow> {
  const ids = [row.opened_by, row.closed_by].filter(Boolean) as string[];
  if (!ids.length) return row;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);

  const byId = new Map((profiles || []).map((p) => [p.id, p.full_name]));
  return {
    ...row,
    opener: row.opened_by
      ? { full_name: byId.get(row.opened_by) || "—" }
      : null,
    closer: row.closed_by
      ? { full_name: byId.get(row.closed_by) || "—" }
      : null,
  };
}

export async function fetchShiftById(
  supabase: SupabaseClient,
  shiftId: string
): Promise<ShiftRow | null> {
  const withSafe = await supabase
    .from("shifts")
    .select("*, safe:safes!shifts_safe_id_fkey(id, name, balance)")
    .eq("id", shiftId)
    .maybeSingle();

  let row: ShiftRow | null = null;

  if (!withSafe.error) {
    row = (withSafe.data as ShiftRow | null) || null;
  } else {
    const plain = await supabase
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .maybeSingle();
    if (plain.error) throw new Error(plain.error.message);
    row = (plain.data as ShiftRow | null) || null;
    if (row) {
      const { data: safe } = await supabase
        .from("safes")
        .select("id, name, balance")
        .eq("id", row.safe_id)
        .maybeSingle();
      row = { ...row, safe: safe || null };
    }
  }

  if (!row) return null;
  return attachOpenerCloser(supabase, row);
}

export async function fetchShiftActivity(
  supabase: SupabaseClient,
  params: {
    safeId: string;
    openedAt: string;
    openingCash: number;
    closedAt?: string | null;
  }
): Promise<ShiftActivity> {
  const since = params.openedAt;

  let invQuery = supabase
    .from("invoices")
    .select(
      "id, invoice_number, type, total, paid_amount, payment_method, created_at"
    )
    .gte("created_at", since)
    .eq("status", "completed")
    .order("created_at", { ascending: true });
  if (params.closedAt) {
    invQuery = invQuery.lt("created_at", params.closedAt);
  }

  let txnQuery = supabase
    .from("safe_transactions")
    .select("id, type, amount, reference_type, description, created_at")
    .eq("safe_id", params.safeId)
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (params.closedAt) {
    txnQuery = txnQuery.lt("created_at", params.closedAt);
  }

  const [{ data: invoices, error: invErr }, { data: txns, error: txnErr }] =
    await Promise.all([invQuery, txnQuery]);

  if (invErr) throw new Error(invErr.message);
  if (txnErr) throw new Error(txnErr.message);

  const invoiceRows = (invoices || []) as ShiftInvoiceActivity[];
  const txnRows = (txns || []) as ShiftSafeTxnActivity[];

  let salesTotal = 0;
  let purchasesTotal = 0;
  for (const inv of invoiceRows) {
    const total = Number(inv.total) || 0;
    if (inv.type === "sale") salesTotal += total;
    if (inv.type === "purchase") purchasesTotal += total;
  }

  let cashIn = 0;
  let cashOut = 0;
  for (const t of txnRows) {
    const amount = Number(t.amount) || 0;
    if (t.type === "deposit") cashIn += amount;
    else if (t.type === "withdrawal") cashOut += amount;
    else if (t.type === "transfer") {
      if (t.reference_type === "transfer_in") cashIn += amount;
      if (t.reference_type === "transfer_out") cashOut += amount;
    }
  }

  return {
    invoices: invoiceRows,
    safeTransactions: txnRows,
    totals: {
      salesTotal,
      purchasesTotal,
      cashIn,
      cashOut,
      expectedCash: Number(params.openingCash) + cashIn - cashOut,
    },
  };
}

/** Late cash count for shifts closed without hand-over. */
export async function finalizeAbandonedShiftCount(
  supabase: SupabaseClient,
  params: {
    shift: ShiftRow;
    countedCash: number;
  }
): Promise<ShiftRow> {
  const { shift } = params;
  if (shift.status !== "closed") {
    throw new Error("العدّ اللاحق للورديات المقفلة فقط");
  }
  if (shift.counted_cash != null) {
    throw new Error("الوردية اتعدّت قبل كده");
  }
  if (
    shift.close_reason !== "abandoned_unload" &&
    shift.close_reason !== "abandoned_logout"
  ) {
    throw new Error("العدّ اللاحق لورديات الخروج بدون تسليم فقط");
  }

  const counted = Number(params.countedCash);
  if (!Number.isFinite(counted)) {
    throw new Error("أدخل مبلغ النقدية المعدودة");
  }

  const expected =
    shift.expected_cash != null
      ? Number(shift.expected_cash)
      : (
          await computeShiftTotals(supabase, {
            safeId: shift.safe_id,
            openedAt: shift.opened_at,
            openingCash: Number(shift.opening_cash) || 0,
            closedAt: shift.closed_at,
          })
        ).expectedCash;

  const variance = counted - expected;

  const { data, error } = await supabase
    .from("shifts")
    .update({
      expected_cash: expected,
      counted_cash: counted,
      variance,
    })
    .eq("id", shift.id)
    .is("counted_cash", null)
    .select("*, safe:safes!shifts_safe_id_fkey(id, name, balance)")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("تعذر حفظ العدّ — حدّث الصفحة وحاول تاني");

  return attachOpenerCloser(supabase, data as ShiftRow);
}

/** Fired after shift_abandoned notifications are marked read — bell listens to refresh. */
export const APP_NOTIFICATIONS_REFRESH_EVENT = "app-notifications-refresh";

export function notifyAppNotificationsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(APP_NOTIFICATIONS_REFRESH_EVENT));
}

function noteMatchesShiftId(
  note: { meta?: unknown; link?: string | null },
  shiftId: string
): boolean {
  const meta = note.meta as { shift_id?: string } | null;
  if (meta?.shift_id === shiftId) return true;
  const link = note.link || "";
  return (
    link === `/shifts/${shiftId}` || link.endsWith(`/shifts/${shiftId}`)
  );
}

/** Mark shift_abandoned notifications for this shift as read for the current user. */
export async function acknowledgeShiftAbandonedNotification(
  supabase: SupabaseClient,
  shiftId: string
): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("لازم تسجّل دخول");

  const { data: notes, error: fetchErr } = await supabase
    .from("app_notifications")
    .select("id, meta, link")
    .eq("user_id", user.id)
    .eq("type", "shift_abandoned")
    .is("read_at", null);

  if (fetchErr) throw new Error(fetchErr.message);

  const ids = (notes || [])
    .filter((n) => noteMatchesShiftId(n, shiftId))
    .map((n) => n.id);

  if (!ids.length) {
    notifyAppNotificationsChanged();
    return 0;
  }

  const { error } = await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);

  if (error) throw new Error(error.message);
  notifyAppNotificationsChanged();
  return ids.length;
}

export async function hasUnreadShiftAbandonedNotification(
  supabase: SupabaseClient,
  shiftId: string
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: notes } = await supabase
    .from("app_notifications")
    .select("id, meta, link")
    .eq("user_id", user.id)
    .eq("type", "shift_abandoned")
    .is("read_at", null);

  return (notes || []).some((n) => noteMatchesShiftId(n, shiftId));
}

export function isAbandonedCloseReason(
  reason: ShiftRow["close_reason"]
): boolean {
  return reason === "abandoned_unload" || reason === "abandoned_logout";
}

/** Abandoned shift is done when counted and variance is 0 or classified. */
export function isAbandonedShiftResolved(shift: ShiftRow): boolean {
  if (!isAbandonedCloseReason(shift.close_reason)) return false;
  if (shift.status !== "closed") return false;
  if (shift.counted_cash == null) return false;
  const v = Number(shift.variance);
  if (!Number.isFinite(v) || v === 0) return true;
  return !!shift.variance_class;
}

export function needsLateCount(shift: ShiftRow): boolean {
  return (
    shift.status === "closed" &&
    shift.counted_cash == null &&
    isAbandonedCloseReason(shift.close_reason)
  );
}

export function needsVarianceClassification(shift: ShiftRow): boolean {
  if (shift.status !== "closed") return false;
  if (shift.counted_cash == null) return false;
  if (shift.variance_class) return false;
  const v = Number(shift.variance);
  return Number.isFinite(v) && v !== 0;
}

export async function attachOpenersToShifts(
  supabase: SupabaseClient,
  rows: ShiftRow[]
): Promise<ShiftRow[]> {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.opened_by, r.closed_by].filter(Boolean) as string[])
    ),
  ];
  if (!ids.length) return rows;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);

  const byId = new Map((profiles || []).map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({
    ...r,
    opener: r.opened_by
      ? { full_name: byId.get(r.opened_by) || "—" }
      : null,
    closer: r.closed_by
      ? { full_name: byId.get(r.closed_by) || "—" }
      : null,
  }));
}

/**
 * Manager reconciles a closed shift's drawer variance into the ledger.
 * Aligns book balance toward counted cash by recording transfer / deposit / withdrawal.
 */
export async function classifyShiftVariance(
  supabase: SupabaseClient,
  params: ClassifyShiftVarianceParams
) {
  const { shift } = params;
  if (shift.status !== "closed") {
    throw new Error("التصنيف للورديات المقفلة فقط");
  }
  if (shift.variance_class) {
    throw new Error("الفرق متسجل ومتصنّف قبل كده");
  }

  const variance = Number(shift.variance);
  if (!Number.isFinite(variance) || variance === 0) {
    throw new Error("مفيش فرق يحتاج تصنيفاً");
  }

  const amount = Math.abs(variance);
  const drawerId = shift.safe_id;
  const cls = params.class;
  const reason = (params.reason || "").trim();
  const label = SHIFT_VARIANCE_CLASS_LABELS[cls];
  const descBase = `فرق وردية (${label})${reason ? ` — ${reason}` : ""}`;

  if (cls === "transfer") {
    const otherId = params.relatedSafeId || "";
    if (!otherId || otherId === drawerId) {
      throw new Error("اختَر الخزنة التانية للنقل");
    }
    if (variance > 0) {
      // Physical drawer had more → money came from other safe
      await transferBetweenSafes(supabase, {
        fromSafeId: otherId,
        toSafeId: drawerId,
        amount,
        description: descBase,
      });
    } else {
      // Physical drawer had less → money left to other safe
      await transferBetweenSafes(supabase, {
        fromSafeId: drawerId,
        toSafeId: otherId,
        amount,
        description: descBase,
      });
    }
  } else if (cls === "withdrawal" || cls === "shortage") {
    if (variance >= 0) {
      throw new Error("السحب/العجز للفرق الناقص فقط (معدود أقل من المتوقع)");
    }
    await applySafeMovement(supabase, {
      safeId: drawerId,
      type: "withdrawal",
      amount,
      description: descBase,
      referenceType: "shift_variance",
      referenceId: shift.id,
    });
  } else if (cls === "deposit" || cls === "surplus") {
    if (variance <= 0) {
      throw new Error("الإضافة/الزيادة للفرق الزائد فقط (معدود أكبر من المتوقع)");
    }
    await applySafeMovement(supabase, {
      safeId: drawerId,
      type: "deposit",
      amount,
      description: descBase,
      referenceType: "shift_variance",
      referenceId: shift.id,
    });
  } else if (cls === "other") {
    // Sync book to counted so balances stay honest
    if (variance > 0) {
      await applySafeMovement(supabase, {
        safeId: drawerId,
        type: "deposit",
        amount,
        description: descBase,
        referenceType: "shift_variance",
        referenceId: shift.id,
      });
    } else {
      await applySafeMovement(supabase, {
        safeId: drawerId,
        type: "withdrawal",
        amount,
        description: descBase,
        referenceType: "shift_variance",
        referenceId: shift.id,
      });
    }
  } else {
    throw new Error("تصنيف غير معروف");
  }

  const { error } = await supabase
    .from("shifts")
    .update({
      variance_class: cls,
      variance_reason: reason || null,
      variance_related_safe_id: cls === "transfer" ? params.relatedSafeId : null,
      variance_classified_by: params.classifiedBy || null,
      variance_classified_at: new Date().toISOString(),
    })
    .eq("id", shift.id)
    .is("variance_class", null);

  if (error) throw new Error(error.message);
}


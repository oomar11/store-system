import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit";
import { safesOrderQuery } from "@/lib/safes-order";
import {
  resolveTransferPair,
  type TransferSafeRow,
} from "@/lib/safe-transfer-resolve";

export type SafeMovementType = "deposit" | "withdrawal";

export type ApplySafeMovementParams = {
  safeId: string;
  type: SafeMovementType;
  amount: number;
  description: string;
  notes?: string | null;
  referenceType?: string;
  referenceId?: string;
  createdAt?: string | null;
};

async function attachNotesToLatestMovement(
  supabase: SupabaseClient,
  params: {
    safeId: string;
    type: SafeMovementType | "transfer";
    amount: number;
    referenceType?: string;
    referenceId?: string;
    notes?: string | null;
  }
) {
  const trimmed = params.notes?.trim();
  if (!trimmed) return;
  let q = supabase
    .from("safe_transactions")
    .select("id")
    .eq("safe_id", params.safeId)
    .eq("type", params.type)
    .eq("amount", params.amount)
    .order("created_at", { ascending: false })
    .limit(1);
  if (params.referenceType) q = q.eq("reference_type", params.referenceType);
  if (params.referenceId) q = q.eq("reference_id", params.referenceId);
  const { data } = await q.maybeSingle();
  if (!data?.id) return;
  await supabase.from("safe_transactions").update({ notes: trimmed }).eq("id", data.id);
}

/** Apply a single deposit/withdrawal to a safe and record the ledger row (atomic RPC). */
export async function applySafeMovement(
  supabase: SupabaseClient,
  params: ApplySafeMovementParams
) {
  const amount = Number(params.amount) || 0;
  if (amount <= 0 || !params.safeId) return;

  const { error } = await supabase.rpc("apply_safe_movement", {
    p_safe_id: params.safeId,
    p_type: params.type,
    p_amount: amount,
    p_description: params.description || null,
    p_reference_type: params.referenceType || null,
    p_reference_id: params.referenceId || null,
    p_created_at: params.createdAt || null,
  });

  if (error) {
    throw new Error(error.message || "تعذر تحديث رصيد الخزنة");
  }

  await attachNotesToLatestMovement(supabase, {
    safeId: params.safeId,
    type: params.type,
    amount,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    notes: params.notes,
  });
}

export type TransferBetweenSafesParams = {
  fromSafeId: string;
  toSafeId: string;
  amount: number;
  description?: string;
  notes?: string | null;
  /** Optional labels — used to recover when offline/ghost ids went stale. */
  fromSafeName?: string | null;
  toSafeName?: string | null;
};

type LiveSafeRow = TransferSafeRow & {
  is_active: boolean;
  balance: number;
};

/** Fetch safes for transfer resolution (includes soft-deleted for recovery). */
export async function fetchSafesForTransfer(
  supabase: SupabaseClient
): Promise<LiveSafeRow[]> {
  const selectCols = "id, name, is_active, balance, deleted_at, sort_order";
  const res = await safesOrderQuery(
    supabase.from("safes").select(selectCols)
  );
  if (res.error) {
    throw new Error(res.error.message || "تعذر تحميل الخزائن");
  }

  // Keep every distinct id — including soft-deleted — so we can revive/remap.
  const byId = new Map<string, LiveSafeRow>();
  for (const raw of res.data || []) {
    const id = String(raw.id || "").trim();
    if (!id) continue;
    byId.set(id.toLowerCase(), {
      id,
      name: String(raw.name || ""),
      is_active: (raw as { is_active?: boolean }).is_active !== false,
      balance: Number((raw as { balance?: number }).balance) || 0,
      deleted_at:
        (raw as { deleted_at?: string | null }).deleted_at ?? null,
    });
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ar")
  );
}

async function ensureSafeUsable(
  supabase: SupabaseClient,
  row: LiveSafeRow
): Promise<LiveSafeRow> {
  // RPC is SECURITY DEFINER and only checks row existence — same as desktop.
  // Soft-deleted / inactive vaults must still transfer (common for الرئيسية/المحل).
  if (row.deleted_at || row.is_active === false) {
    const { error } = await supabase
      .from("safes")
      .update({ deleted_at: null, is_active: true })
      .eq("id", row.id);
    if (!error) {
      return { ...row, deleted_at: null, is_active: true };
    }
    // Non-managers may lack UPDATE — still proceed; RPC can move cash / migration revives.
  }
  return row;
}

export async function transferBetweenSafes(
  supabase: SupabaseClient,
  params: TransferBetweenSafesParams
) {
  const amount = Number(params.amount) || 0;
  if (amount <= 0) return;

  const live = await fetchSafesForTransfer(supabase);
  if (live.filter((s) => !s.deleted_at).length < 2 && live.length < 2) {
    throw new Error("يلزم خزنتان على الأقل للتحويل");
  }

  const resolved = resolveTransferPair(live, {
    fromSafeId: params.fromSafeId,
    toSafeId: params.toSafeId,
    fromSafeName: params.fromSafeName,
    toSafeName: params.toSafeName,
  });
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const fromRow = await ensureSafeUsable(supabase, {
    ...resolved.from,
    is_active: resolved.from.is_active !== false,
    balance: Number(resolved.from.balance) || 0,
  });
  const toRow = await ensureSafeUsable(supabase, {
    ...resolved.to,
    is_active: resolved.to.is_active !== false,
    balance: Number(resolved.to.balance) || 0,
  });

  const fromSafeId = fromRow.id;
  const toSafeId = toRow.id;

  const { error } = await supabase.rpc("transfer_between_safes", {
    p_from_safe_id: fromSafeId,
    p_to_safe_id: toSafeId,
    p_amount: amount,
    p_description: params.description || null,
  });

  if (error) {
    throw new Error(error.message || "تعذر إتمام التحويل بين الخزائن");
  }

  const trimmed = params.notes?.trim();
  if (trimmed) {
    const { data: rows } = await supabase
      .from("safe_transactions")
      .select("id, safe_id, related_safe_id")
      .eq("type", "transfer")
      .eq("amount", amount)
      .or(
        `and(safe_id.eq.${fromSafeId},related_safe_id.eq.${toSafeId}),and(safe_id.eq.${toSafeId},related_safe_id.eq.${fromSafeId})`
      )
      .order("created_at", { ascending: false })
      .limit(2);
    if (rows?.length) {
      await supabase
        .from("safe_transactions")
        .update({ notes: trimmed })
        .in(
          "id",
          rows.map((r) => r.id)
        );
    }
  }
}

export type InvoiceSafeDirection = "sale" | "purchase" | "sale_return" | "purchase_return";

/** Sale / purchase_return put cash into the safe; purchase / sale_return take cash out. */
export function invoicePaymentMovementType(
  invoiceType: InvoiceSafeDirection
): SafeMovementType {
  if (invoiceType === "sale" || invoiceType === "purchase_return") return "deposit";
  return "withdrawal";
}

function reverseMovementType(type: SafeMovementType): SafeMovementType {
  return type === "deposit" ? "withdrawal" : "deposit";
}

export type SyncInvoiceSafePaymentParams = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: InvoiceSafeDirection;
  oldPaidAmount: number;
  oldSafeId?: string | null;
  newPaidAmount: number;
  newSafeId?: string | null;
};

/**
 * Reconcile safe impact when creating or editing an invoice payment.
 * Reverses the previous paid amount (if any), then applies the new one.
 */
export async function syncInvoiceSafePayment(
  supabase: SupabaseClient,
  params: SyncInvoiceSafePaymentParams
) {
  const oldPaid = Number(params.oldPaidAmount) || 0;
  const newPaid = Number(params.newPaidAmount) || 0;
  let oldSafeId = params.oldSafeId || null;
  const newSafeId = params.newSafeId || null;
  const movementType = invoicePaymentMovementType(params.invoiceType);

  if (oldPaid > 0 && !oldSafeId) {
    const { data: linked } = await supabase
      .from("safe_transactions")
      .select("safe_id")
      .eq("reference_id", params.invoiceId)
      .eq("reference_type", "invoice")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    oldSafeId = linked?.safe_id || null;
  }

  const typeLabel =
    params.invoiceType === "sale"
      ? "بيع"
      : params.invoiceType === "purchase"
        ? "شراء"
        : params.invoiceType === "sale_return"
          ? "مرتجع مبيعات"
          : "مرتجع مشتريات";

  if (oldPaid > 0 && oldSafeId) {
    await applySafeMovement(supabase, {
      safeId: oldSafeId,
      type: reverseMovementType(movementType),
      amount: oldPaid,
      description: `عكس دفع ${typeLabel} رقم ${params.invoiceNumber}`,
      referenceType: "invoice_reversal",
      referenceId: params.invoiceId,
    });
  }

  if (newPaid > 0) {
    if (!newSafeId) {
      throw new Error("الرجاء تحديد الخزنة للمدفوعات");
    }
    await applySafeMovement(supabase, {
      safeId: newSafeId,
      type: movementType,
      amount: newPaid,
      description: `دفع ${typeLabel} رقم ${params.invoiceNumber}`,
      referenceType: "invoice",
      referenceId: params.invoiceId,
    });
  }
}

/** Prefer a safe whose name mentions bank when payment is bank_transfer. */
export function pickDefaultSafeId(
  safes: { id: string; name: string }[],
  paymentMethod?: string,
  preferredId?: string | null
): string {
  if (preferredId && safes.some((s) => s.id === preferredId)) {
    return preferredId;
  }
  if (paymentMethod === "bank_transfer") {
    const bankSafe = safes.find((s) => /بنك|bank/i.test(s.name));
    if (bankSafe) return bankSafe.id;
  }
  return safes[0]?.id || "";
}

let invoicesSafeColumnCache: boolean | null = null;

/** Detect whether invoices.safe_id exists (migration applied). */
export async function invoicesHaveSafeIdColumn(
  supabase: SupabaseClient
): Promise<boolean> {
  if (invoicesSafeColumnCache !== null) return invoicesSafeColumnCache;
  const { error } = await supabase.from("invoices").select("safe_id").limit(1);
  invoicesSafeColumnCache = !error;
  return invoicesSafeColumnCache;
}

/** Build invoice payment fields including safe_id only when the column exists. */
export async function withInvoiceSafeId(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  safeId: string | null
): Promise<Record<string, unknown>> {
  if (await invoicesHaveSafeIdColumn(supabase)) {
    return { ...payload, safe_id: safeId };
  }
  return payload;
}

export function isManualSafeMovement(tx: {
  type: string;
  reference_type?: string | null;
}): boolean {
  if (tx.type === "deposit" || tx.type === "withdrawal") {
    return (
      !tx.reference_type ||
      tx.reference_type === "manual" ||
      tx.reference_type === ""
    );
  }
  if (tx.type === "transfer") {
    return (
      tx.reference_type === "transfer_out" ||
      tx.reference_type === "transfer_in"
    );
  }
  return false;
}

/** تعديل إيداع/سحب يدوي: عكس القديم ثم تطبيق القيم الجديدة */
export async function updateManualSafeMovement(
  supabase: SupabaseClient,
  input: {
    transactionId: string;
    safeId: string;
    type: SafeMovementType;
    amount: number;
    description: string;
    notes?: string;
  }
): Promise<void> {
  const { data: old, error } = await supabase
    .from("safe_transactions")
    .select("*")
    .eq("id", input.transactionId)
    .maybeSingle();

  if (error || !old) throw new Error("الحركة غير موجودة");
  if (old.type !== "deposit" && old.type !== "withdrawal") {
    throw new Error("هذه الحركة ليست إيداعاً أو سحباً");
  }
  if (!isManualSafeMovement(old)) {
    throw new Error("لا يمكن تعديل حركة مرتبطة بفاتورة أو مصروف من هنا");
  }

  const oldType = old.type as SafeMovementType;
  const oldAmount = Number(old.amount) || 0;

  await applySafeMovement(supabase, {
    safeId: old.safe_id,
    type: reverseMovementType(oldType),
    amount: oldAmount,
    description: `عكس تعديل: ${old.description || ""}`.trim(),
    referenceType: "manual_edit_reversal",
    referenceId: old.id,
  });

  await applySafeMovement(supabase, {
    safeId: input.safeId,
    type: input.type,
    amount: input.amount,
    description: input.description,
    notes: input.notes,
    referenceType: "manual",
  });

  await supabase.from("safe_transactions").delete().eq("id", old.id);

  await logAuditEvent(supabase, {
    action: "safe.movement.edit",
    entityType: "safe",
    entityId: input.safeId,
    entityLabel: input.description || `${input.type} ${input.amount}`,
    before: {
      type: oldType,
      amount: oldAmount,
      safe_id: old.safe_id,
      description: old.description,
    },
    after: {
      type: input.type,
      amount: input.amount,
      safe_id: input.safeId,
      description: input.description,
      notes: input.notes?.trim() || null,
    },
    source: "app",
  });
}

/** تعديل تحويل: عكس الزوج ثم تحويل جديد */
export async function updateSafeTransfer(
  supabase: SupabaseClient,
  input: {
    transactionId: string;
    fromSafeId: string;
    toSafeId: string;
    amount: number;
    description?: string;
    notes?: string;
  }
): Promise<void> {
  const { data: row, error } = await supabase
    .from("safe_transactions")
    .select("*")
    .eq("id", input.transactionId)
    .maybeSingle();

  if (error || !row) throw new Error("التحويل غير موجود");
  if (row.type !== "transfer") throw new Error("ليست حركة تحويل");

  let outRow = row;
  if (row.reference_type === "transfer_in" && row.transfer_group_id) {
    const { data: pair } = await supabase
      .from("safe_transactions")
      .select("*")
      .eq("transfer_group_id", row.transfer_group_id)
      .eq("reference_type", "transfer_out")
      .maybeSingle();
    if (pair) outRow = pair;
  }

  const oldFrom = outRow.safe_id;
  const oldTo = outRow.related_safe_id;
  const oldAmount = Number(outRow.amount) || 0;
  if (!oldFrom || !oldTo) throw new Error("بيانات التحويل ناقصة");

  await transferBetweenSafes(supabase, {
    fromSafeId: oldTo,
    toSafeId: oldFrom,
    amount: oldAmount,
    description: `عكس تعديل تحويل: ${outRow.description || ""}`.trim(),
  });

  if (outRow.transfer_group_id) {
    await supabase
      .from("safe_transactions")
      .delete()
      .eq("transfer_group_id", outRow.transfer_group_id);
  } else {
    await supabase.from("safe_transactions").delete().eq("id", outRow.id);
  }

  await transferBetweenSafes(supabase, {
    fromSafeId: input.fromSafeId,
    toSafeId: input.toSafeId,
    amount: input.amount,
    description: input.description,
    notes: input.notes,
  });

  await logAuditEvent(supabase, {
    action: "safe.transfer.edit",
    entityType: "safe",
    entityId: input.fromSafeId,
    entityLabel: input.description || `تحويل ${input.amount}`,
    before: {
      from: oldFrom,
      to: oldTo,
      amount: oldAmount,
    },
    after: {
      from: input.fromSafeId,
      to: input.toSafeId,
      amount: input.amount,
    },
    source: "app",
  });
}

/** حذف إيداع/سحب يدوي: عكس الرصيد ثم حذف الصف */
export async function deleteManualSafeMovement(
  supabase: SupabaseClient,
  transactionId: string
): Promise<void> {
  const { data: old, error } = await supabase
    .from("safe_transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();

  if (error || !old) throw new Error("الحركة غير موجودة");
  if (old.type !== "deposit" && old.type !== "withdrawal") {
    throw new Error("استخدم حذف التحويل لهذه الحركة");
  }
  if (!isManualSafeMovement(old)) {
    throw new Error("لا يمكن حذف حركة مرتبطة بفاتورة أو مصروف من هنا");
  }

  const oldType = old.type as SafeMovementType;
  const oldAmount = Number(old.amount) || 0;

  await applySafeMovement(supabase, {
    safeId: old.safe_id,
    type: reverseMovementType(oldType),
    amount: oldAmount,
    description: `عكس حذف: ${old.description || ""}`.trim(),
    referenceType: "manual_delete_reversal",
    referenceId: old.id,
  });

  await supabase.from("safe_transactions").delete().eq("id", old.id);

  await logAuditEvent(supabase, {
    action: "safe.movement.delete",
    entityType: "safe",
    entityId: old.safe_id,
    entityLabel: old.description || `${oldType} ${oldAmount}`,
    before: {
      type: oldType,
      amount: oldAmount,
      safe_id: old.safe_id,
      description: old.description,
    },
    source: "app",
  });
}

/** حذف تحويل يدوي: عكس ثم حذف صفوف المجموعة */
export async function deleteSafeTransfer(
  supabase: SupabaseClient,
  transactionId: string
): Promise<void> {
  const { data: row, error } = await supabase
    .from("safe_transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();

  if (error || !row) throw new Error("التحويل غير موجود");
  if (row.type !== "transfer") throw new Error("ليست حركة تحويل");
  if (!isManualSafeMovement(row)) {
    throw new Error("لا يمكن حذف هذا التحويل");
  }

  let outRow = row;
  if (row.reference_type === "transfer_in" && row.transfer_group_id) {
    const { data: pair } = await supabase
      .from("safe_transactions")
      .select("*")
      .eq("transfer_group_id", row.transfer_group_id)
      .eq("reference_type", "transfer_out")
      .maybeSingle();
    if (pair) outRow = pair;
  }

  const oldFrom = outRow.safe_id;
  const oldTo = outRow.related_safe_id;
  const oldAmount = Number(outRow.amount) || 0;
  if (!oldFrom || !oldTo) throw new Error("بيانات التحويل ناقصة");

  await transferBetweenSafes(supabase, {
    fromSafeId: oldTo,
    toSafeId: oldFrom,
    amount: oldAmount,
    description: `عكس حذف تحويل: ${outRow.description || ""}`.trim(),
  });

  if (outRow.transfer_group_id) {
    await supabase
      .from("safe_transactions")
      .delete()
      .eq("transfer_group_id", outRow.transfer_group_id);
  } else {
    await supabase.from("safe_transactions").delete().eq("id", outRow.id);
  }

  await logAuditEvent(supabase, {
    action: "safe.transfer.delete",
    entityType: "safe",
    entityId: oldFrom,
    entityLabel: outRow.description || `تحويل ${oldAmount}`,
    before: { from: oldFrom, to: oldTo, amount: oldAmount },
    source: "app",
  });
}


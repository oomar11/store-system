import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adjustCustomerBalance,
  adjustSupplierBalance,
} from "@/lib/party-balance";
import { deletePartySettlement } from "@/lib/party-link";
import { applySafeMovement } from "@/lib/safe-transactions";

export type PartyPaymentKind = "customer" | "supplier";

const RLS_DENIED_AR = "تحصيل/سداد الأطراف غير مسموح لصلاحياتك";

function mapDbError(message: string | undefined, fallback: string): string {
  const msg = (message || "").trim();
  if (!msg) return fallback;
  if (/row-level security|violates row-level|permission denied|RLS/i.test(msg)) {
    return RLS_DENIED_AR;
  }
  return msg;
}

export type OpenInvoiceForPayment = {
  id: string;
  invoice_number: string;
  total: number;
  paid_amount: number;
  remaining: number;
  created_at: string;
};

export type AllocationPreview = {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  remainingAfter: number;
};

export type PartyPaymentAllocationDetail = {
  id: string;
  invoice_id: string;
  amount: number;
  invoice_number?: string;
  invoice_type?: string;
  invoice_total?: number;
  invoice_paid_amount?: number;
  invoice_created_at?: string;
  invoice_status?: string;
};

export type PartyPaymentRow = {
  id: string;
  party_type: PartyPaymentKind;
  party_id: string;
  amount: number;
  safe_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  is_settlement?: boolean;
  settlement_group_id?: string | null;
  safe_name?: string;
  created_by_name?: string | null;
  allocations?: PartyPaymentAllocationDetail[];
};

export function partyPaymentDocNumber(
  paymentId: string,
  kind: PartyPaymentKind
): string {
  const prefix = kind === "customer" ? "تحص" : "سداد";
  const shortId = paymentId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${shortId}`;
}

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Open sale/purchase invoices for a party, oldest first (FIFO). */
export async function fetchOpenInvoicesForParty(
  supabase: SupabaseClient,
  kind: PartyPaymentKind,
  partyId: string,
  options?: {
    /** When editing a payment, treat its allocations as still available */
    creditAllocations?: { invoice_id: string; amount: number }[];
  }
): Promise<OpenInvoiceForPayment[]> {
  const invoiceType = kind === "customer" ? "sale" : "purchase";
  const partyCol = kind === "customer" ? "customer_id" : "supplier_id";

  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, total, paid_amount, created_at, status")
    .eq("type", invoiceType)
    .eq(partyCol, partyId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message || "تعذر جلب الفواتير");

  const credit = new Map<string, number>();
  for (const a of options?.creditAllocations || []) {
    credit.set(
      a.invoice_id,
      money((credit.get(a.invoice_id) || 0) + Number(a.amount))
    );
  }

  return (data || [])
    .filter((row) => (row.status as string) !== "cancelled")
    .map((row) => {
      const total = money(row.total);
      const paid = money(row.paid_amount);
      const credited = credit.get(row.id as string) || 0;
      const remaining = money(Math.max(0, total - paid + credited));
      return {
        id: row.id as string,
        invoice_number: row.invoice_number as string,
        total,
        paid_amount: money(Math.max(0, paid - credited)),
        remaining,
        created_at: row.created_at as string,
      };
    })
    .filter((row) => row.remaining > 0.001);
}

/** Preview FIFO allocation without writing. */
export function previewFifoAllocation(
  invoices: OpenInvoiceForPayment[],
  amount: number
): { allocations: AllocationPreview[]; totalOpen: number; leftover: number } {
  const pay = money(amount);
  const totalOpen = money(
    invoices.reduce((sum, inv) => sum + inv.remaining, 0)
  );
  let left = pay;
  const allocations: AllocationPreview[] = [];

  for (const inv of invoices) {
    if (left <= 0.001) break;
    const slice = money(Math.min(left, inv.remaining));
    if (slice <= 0) continue;
    allocations.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      amount: slice,
      remainingAfter: money(inv.remaining - slice),
    });
    left = money(left - slice);
  }

  return { allocations, totalOpen, leftover: left };
}

/**
 * Allocate a party payment without closing invoices before covering
 * non-invoice debt (opening balance, linked debts, etc.).
 *
 * Order: (1) cover max(0, partyBalance - openInvoices), (2) FIFO on invoices,
 * (3) anything left is account credit/advance.
 */
export function previewPartyPaymentAllocation(
  invoices: OpenInvoiceForPayment[],
  amount: number,
  partyBalance: number
): {
  allocations: AllocationPreview[];
  totalOpen: number;
  leftover: number;
  nonInvoiceCover: number;
  towardInvoices: number;
} {
  const pay = money(amount);
  const totalOpen = money(
    invoices.reduce((sum, inv) => sum + inv.remaining, 0)
  );
  const bal = money(partyBalance);
  const nonInvoiceDebt = money(Math.max(0, bal - totalOpen));
  const nonInvoiceCover = money(Math.min(pay, nonInvoiceDebt));
  const towardInvoices = money(Math.max(0, pay - nonInvoiceCover));
  const fifo = previewFifoAllocation(invoices, towardInvoices);
  const leftover = money(nonInvoiceCover + fifo.leftover);

  return {
    allocations: fifo.allocations,
    totalOpen,
    leftover,
    nonInvoiceCover,
    towardInvoices: money(towardInvoices - fifo.leftover),
  };
}

async function fetchPartyBalance(
  supabase: SupabaseClient,
  kind: PartyPaymentKind,
  partyId: string
): Promise<number> {
  const table = kind === "customer" ? "customers" : "suppliers";
  const { data, error } = await supabase
    .from(table)
    .select("balance")
    .eq("id", partyId)
    .maybeSingle();
  if (error) throw new Error(error.message || "تعذر جلب رصيد الطرف");
  return money(Number(data?.balance) || 0);
}

export type ApplyPartyPaymentParams = {
  kind: PartyPaymentKind;
  partyId: string;
  partyName?: string;
  amount: number;
  safeId: string;
  notes?: string;
  /** Business time (device clock) for offline ordering */
  createdAt?: string;
};

/**
 * Collect from customer / pay supplier: one payment row, allocations when
 * open invoices exist (after covering non-invoice account debt), one safe
 * movement, and balance decrease.
 * Any unallocated amount (no invoices / opening debt / amount above open
 * total) stays on the party account (balance decreases by the full amount).
 */
export async function applyPartyPayment(
  supabase: SupabaseClient,
  params: ApplyPartyPaymentParams
): Promise<{ paymentId: string; allocations: AllocationPreview[] }> {
  const amount = money(params.amount);
  if (amount <= 0) throw new Error("أدخل مبلغاً أكبر من صفر.");
  if (!params.safeId) throw new Error("الرجاء تحديد الخزنة.");

  const [open, partyBalance] = await Promise.all([
    fetchOpenInvoicesForParty(supabase, params.kind, params.partyId),
    fetchPartyBalance(supabase, params.kind, params.partyId),
  ]);
  const { allocations } = previewPartyPaymentAllocation(
    open,
    amount,
    partyBalance
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const paymentInsert: Record<string, unknown> = {
    party_type: params.kind,
    party_id: params.partyId,
    amount,
    safe_id: params.safeId,
    notes: params.notes?.trim() || null,
    created_by: user?.id || null,
  };
  if (params.createdAt) {
    paymentInsert.created_at = params.createdAt;
  }

  const { data: payment, error: payErr } = await supabase
    .from("party_payments")
    .insert(paymentInsert)
    .select("id")
    .single();

  if (payErr || !payment) {
    throw new Error(mapDbError(payErr?.message, "تعذر تسجيل الدفعة"));
  }

  const paymentId = payment.id as string;

  if (allocations.length > 0) {
    const { error: allocErr } = await supabase
      .from("party_payment_allocations")
      .insert(
        allocations.map((a) => ({
          payment_id: paymentId,
          invoice_id: a.invoiceId,
          amount: a.amount,
        }))
      );

    if (allocErr) {
      await supabase.from("party_payments").delete().eq("id", paymentId);
      throw new Error(mapDbError(allocErr.message, "تعذر تسجيل توزيع الدفعة"));
    }
  }

  for (const a of allocations) {
    const inv = open.find((o) => o.id === a.invoiceId);
    if (!inv) continue;
    const slice = money(Math.min(a.amount, inv.remaining));
    if (slice <= 0.001) continue;
    const newPaid = money(Math.min(inv.total, inv.paid_amount + slice));
    const { data: updated, error: updErr } = await supabase
      .from("invoices")
      .update({ paid_amount: newPaid })
      .eq("id", a.invoiceId)
      .lte("paid_amount", money(inv.paid_amount) + 0.001)
      .select("id")
      .maybeSingle();
    if (updErr) {
      await supabase.from("party_payments").delete().eq("id", paymentId);
      throw new Error(mapDbError(updErr.message, "تعذر تحديث الفاتورة"));
    }
    if (!updated) {
      await supabase.from("party_payments").delete().eq("id", paymentId);
      throw new Error(
        "تم تحديث الفاتورة من عملية أخرى. أعد المحاولة."
      );
    }
  }

  const isCustomer = params.kind === "customer";
  const partyLabel = params.partyName || (isCustomer ? "عميل" : "مورد");
  try {
    await applySafeMovement(supabase, {
      safeId: params.safeId,
      type: isCustomer ? "deposit" : "withdrawal",
      amount,
      description: isCustomer
        ? `تحصيل من ${partyLabel}`
        : `سداد لـ ${partyLabel}`,
      referenceType: "party_payment",
      referenceId: paymentId,
      createdAt: params.createdAt || null,
    });
  } catch (safeErr) {
    // Reverse invoice paid bumps then delete payment (cascades allocations)
    for (const a of allocations) {
      const inv = open.find((o) => o.id === a.invoiceId);
      if (!inv) continue;
      await supabase
        .from("invoices")
        .update({ paid_amount: money(inv.paid_amount) })
        .eq("id", a.invoiceId);
    }
    await supabase.from("party_payments").delete().eq("id", paymentId);
    throw safeErr;
  }

  try {
    if (isCustomer) {
      await adjustCustomerBalance(supabase, params.partyId, -amount);
    } else {
      await adjustSupplierBalance(supabase, params.partyId, -amount);
    }
  } catch (balErr) {
    await applySafeMovement(supabase, {
      safeId: params.safeId,
      type: isCustomer ? "withdrawal" : "deposit",
      amount,
      description: `عكس دفعة فاشلة - ${params.partyName}`,
      referenceType: "party_payment",
      referenceId: paymentId,
    });
    for (const a of allocations) {
      const inv = open.find((o) => o.id === a.invoiceId);
      if (!inv) continue;
      await supabase
        .from("invoices")
        .update({ paid_amount: money(inv.paid_amount) })
        .eq("id", a.invoiceId);
    }
    await supabase.from("party_payments").delete().eq("id", paymentId);
    throw balErr;
  }

  return { paymentId, allocations };
}

/** Reverse a party payment: invoices, safe, balance, then delete row. */
export async function deletePartyPayment(
  supabase: SupabaseClient,
  paymentId: string
): Promise<void> {
  const { data: payment, error: payErr } = await supabase
    .from("party_payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  if (payErr) throw new Error(payErr.message);
  if (!payment) throw new Error("الدفعة غير موجودة");

  if (payment.is_settlement) {
    await deletePartySettlement(supabase, paymentId);
    return;
  }

  const { data: allocations, error: allocErr } = await supabase
    .from("party_payment_allocations")
    .select("id, invoice_id, amount")
    .eq("payment_id", paymentId);

  if (allocErr) throw new Error(allocErr.message);

  for (const a of allocations || []) {
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select("id, paid_amount")
      .eq("id", a.invoice_id)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) continue;
    const newPaid = money(Math.max(0, money(inv.paid_amount) - money(a.amount)));
    const { error: updErr } = await supabase
      .from("invoices")
      .update({ paid_amount: newPaid })
      .eq("id", a.invoice_id);
    if (updErr) throw new Error(updErr.message);
  }

  const amount = money(payment.amount);
  const isCustomer = payment.party_type === "customer";

  if (payment.safe_id) {
    await applySafeMovement(supabase, {
      safeId: payment.safe_id,
      type: isCustomer ? "withdrawal" : "deposit",
      amount,
      description: isCustomer
        ? "عكس تحصيل دفعة مجمّعة"
        : "عكس سداد دفعة مجمّعة",
      referenceType: "party_payment_reversal",
      referenceId: paymentId,
    });
  }

  if (isCustomer) {
    await adjustCustomerBalance(supabase, payment.party_id, amount);
  } else {
    await adjustSupplierBalance(supabase, payment.party_id, amount);
  }

  const { error: delErr } = await supabase
    .from("party_payments")
    .delete()
    .eq("id", paymentId);

  if (delErr) throw new Error(mapDbError(delErr.message, "تعذر حذف الدفعة"));
}

export type UpdatePartyPaymentParams = {
  paymentId: string;
  partyName: string;
  amount: number;
  safeId: string;
  notes?: string;
};

/**
 * Edit an existing party payment: reverse old effects, re-allocate FIFO, apply new.
 */
export async function updatePartyPayment(
  supabase: SupabaseClient,
  params: UpdatePartyPaymentParams
): Promise<{ allocations: AllocationPreview[] }> {
  const newAmount = money(params.amount);
  if (newAmount <= 0) throw new Error("أدخل مبلغاً أكبر من صفر.");
  if (!params.safeId) throw new Error("الرجاء تحديد الخزنة.");

  const { data: payment, error: payErr } = await supabase
    .from("party_payments")
    .select("*")
    .eq("id", params.paymentId)
    .maybeSingle();

  if (payErr) throw new Error(payErr.message);
  if (!payment) throw new Error("الدفعة غير موجودة");

  const kind = payment.party_type as PartyPaymentKind;
  const oldAmount = money(payment.amount);
  const isCustomer = kind === "customer";

  const { data: oldAllocations, error: allocErr } = await supabase
    .from("party_payment_allocations")
    .select("id, invoice_id, amount")
    .eq("payment_id", params.paymentId);

  if (allocErr) throw new Error(allocErr.message);

  const creditAllocations = (oldAllocations || []).map((a) => ({
    invoice_id: a.invoice_id as string,
    amount: money(a.amount),
  }));

  const [open, currentBalance] = await Promise.all([
    fetchOpenInvoicesForParty(supabase, kind, payment.party_id as string, {
      creditAllocations,
    }),
    fetchPartyBalance(supabase, kind, payment.party_id as string),
  ]);
  // Balance as if this payment were reversed, so non-invoice debt is correct.
  const balanceBeforePayment = money(currentBalance + oldAmount);
  const { allocations } = previewPartyPaymentAllocation(
    open,
    newAmount,
    balanceBeforePayment
  );

  // Reverse old invoice paid amounts
  for (const a of oldAllocations || []) {
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select("id, paid_amount")
      .eq("id", a.invoice_id)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) continue;
    const newPaid = money(
      Math.max(0, money(inv.paid_amount) - money(a.amount))
    );
    const { error: updErr } = await supabase
      .from("invoices")
      .update({ paid_amount: newPaid })
      .eq("id", a.invoice_id);
    if (updErr) throw new Error(updErr.message);
  }

  // Reverse old safe + balance
  await applySafeMovement(supabase, {
    safeId: payment.safe_id as string,
    type: isCustomer ? "withdrawal" : "deposit",
    amount: oldAmount,
    description: isCustomer
      ? "عكس تحصيل قبل التعديل"
      : "عكس سداد قبل التعديل",
    referenceType: "party_payment_reversal",
    referenceId: params.paymentId,
  });

  if (isCustomer) {
    await adjustCustomerBalance(supabase, payment.party_id as string, oldAmount);
  } else {
    await adjustSupplierBalance(supabase, payment.party_id as string, oldAmount);
  }

  // Replace allocations
  const { error: delAllocErr } = await supabase
    .from("party_payment_allocations")
    .delete()
    .eq("payment_id", params.paymentId);
  if (delAllocErr) throw new Error(mapDbError(delAllocErr.message, "تعذر حذف التوزيع"));

  const { error: updPayErr } = await supabase
    .from("party_payments")
    .update({
      amount: newAmount,
      safe_id: params.safeId,
      notes: params.notes?.trim() || null,
    })
    .eq("id", params.paymentId);
  if (updPayErr) throw new Error(mapDbError(updPayErr.message, "تعذر تحديث الدفعة"));

  if (allocations.length > 0) {
    const { error: insAllocErr } = await supabase
      .from("party_payment_allocations")
      .insert(
        allocations.map((a) => ({
          payment_id: params.paymentId,
          invoice_id: a.invoiceId,
          amount: a.amount,
        }))
      );
    if (insAllocErr) {
      throw new Error(mapDbError(insAllocErr.message, "تعذر تسجيل التوزيع الجديد"));
    }
  }

  for (const a of allocations) {
    const inv = open.find((o) => o.id === a.invoiceId);
    if (!inv) continue;
    // paid_amount was reversed; apply against the credited baseline
    const { data: current, error: curErr } = await supabase
      .from("invoices")
      .select("paid_amount, total")
      .eq("id", a.invoiceId)
      .maybeSingle();
    if (curErr) throw new Error(curErr.message);
    const slice = money(Math.min(a.amount, inv.remaining));
    if (slice <= 0.001) continue;
    const basePaid = money(Number(current?.paid_amount) || 0);
    const invTotal = money(Number(current?.total) || inv.total);
    const newPaid = money(Math.min(invTotal, basePaid + slice));
    const { error: updErr } = await supabase
      .from("invoices")
      .update({ paid_amount: newPaid })
      .eq("id", a.invoiceId);
    if (updErr) throw new Error(updErr.message || "تعذر تحديث الفاتورة");
  }

  await applySafeMovement(supabase, {
    safeId: params.safeId,
    type: isCustomer ? "deposit" : "withdrawal",
    amount: newAmount,
    description: isCustomer
      ? `تعديل تحصيل من ${params.partyName}`
      : `تعديل سداد لـ ${params.partyName}`,
    referenceType: "party_payment",
    referenceId: params.paymentId,
  });

  if (isCustomer) {
    await adjustCustomerBalance(
      supabase,
      payment.party_id as string,
      -newAmount
    );
  } else {
    await adjustSupplierBalance(
      supabase,
      payment.party_id as string,
      -newAmount
    );
  }

  return { allocations };
}

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

type AllocEmbed = {
  id: string;
  invoice_id: string;
  amount: number;
  invoices?:
    | {
        invoice_number?: string;
        type?: string;
        total?: number;
        paid_amount?: number;
        created_at?: string;
        status?: string;
      }
    | {
        invoice_number?: string;
        type?: string;
        total?: number;
        paid_amount?: number;
        created_at?: string;
        status?: string;
      }[]
    | null;
};

function mapAllocations(allocs: AllocEmbed[]): PartyPaymentAllocationDetail[] {
  return allocs.map((a) => {
    const inv = asOne(a.invoices);
    return {
      id: a.id,
      invoice_id: a.invoice_id,
      amount: money(a.amount),
      invoice_number: inv?.invoice_number,
      invoice_type: inv?.type,
      invoice_total: inv?.total != null ? money(inv.total) : undefined,
      invoice_paid_amount:
        inv?.paid_amount != null ? money(inv.paid_amount) : undefined,
      invoice_created_at: inv?.created_at,
      invoice_status: inv?.status,
    };
  });
}

const PAYMENT_DETAIL_SELECT =
  "id, party_type, party_id, amount, safe_id, notes, created_by, created_at, is_settlement, settlement_group_id, safes(name), party_payment_allocations(id, invoice_id, amount, invoices(invoice_number, type, total, paid_amount, created_at, status))";

export async function getPartyPayment(
  supabase: SupabaseClient,
  paymentId: string
): Promise<PartyPaymentRow | null> {
  const { data, error } = await supabase
    .from("party_payments")
    .select(PAYMENT_DETAIL_SELECT)
    .eq("id", paymentId)
    .maybeSingle();

  if (error) throw new Error(error.message || "تعذر جلب الدفعة");
  if (!data) return null;

  const safe = asOne(
    data.safes as { name?: string } | { name?: string }[] | null
  );
  let createdByName: string | null = null;
  if (data.created_by) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", data.created_by)
      .maybeSingle();
    createdByName = profile?.full_name || null;
  }

  return {
    id: data.id as string,
    party_type: data.party_type as PartyPaymentKind,
    party_id: data.party_id as string,
    amount: money(data.amount),
    safe_id: (data.safe_id as string | null) || null,
    notes: (data.notes as string | null) || null,
    created_by: (data.created_by as string | null) || null,
    created_at: data.created_at as string,
    is_settlement: Boolean(data.is_settlement),
    settlement_group_id: (data.settlement_group_id as string | null) || null,
    safe_name: safe?.name,
    created_by_name: createdByName,
    allocations: mapAllocations(
      (data.party_payment_allocations || []) as AllocEmbed[]
    ),
  };
}

export async function listPartyPayments(
  supabase: SupabaseClient,
  kind: PartyPaymentKind,
  partyId: string
): Promise<PartyPaymentRow[]> {
  const { data, error } = await supabase
    .from("party_payments")
    .select(PAYMENT_DETAIL_SELECT)
    .eq("party_type", kind)
    .eq("party_id", partyId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message || "تعذر جلب الدفعات");

  const creatorIds = [
    ...new Set(
      (data || [])
        .map((row) => row.created_by as string | null)
        .filter((id): id is string => !!id)
    ),
  ];
  const nameById = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds);
    for (const p of profiles || []) {
      nameById.set(p.id as string, (p.full_name as string) || "");
    }
  }

  return (data || []).map((row) => {
    const safe = asOne(
      row.safes as { name?: string } | { name?: string }[] | null
    );
    return {
      id: row.id as string,
      party_type: row.party_type as PartyPaymentKind,
      party_id: row.party_id as string,
      amount: money(row.amount),
      safe_id: (row.safe_id as string | null) || null,
      notes: (row.notes as string | null) || null,
      created_by: (row.created_by as string | null) || null,
      created_at: row.created_at as string,
      is_settlement: Boolean(row.is_settlement),
      settlement_group_id: (row.settlement_group_id as string | null) || null,
      safe_name: safe?.name,
      created_by_name: row.created_by
        ? nameById.get(row.created_by as string) || null
        : null,
      allocations: mapAllocations(
        (row.party_payment_allocations || []) as AllocEmbed[]
      ),
    };
  });
}

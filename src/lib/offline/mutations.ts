import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCompletedInvoice,
  type CreateCompletedInvoiceInput,
  type CreateCompletedInvoiceResult,
} from "@/lib/create-invoice";
import { createExpense, type CreateExpenseInput } from "@/lib/expenses";
import {
  applyPartyPayment,
  type ApplyPartyPaymentParams,
} from "@/lib/party-payments";
import { isLikelyNetworkError } from "@/lib/offline/network";
import { isLikelyOnline } from "@/lib/offline/local-first";
import { scheduleBackgroundSync } from "@/lib/offline/background-sync";
import {
  enqueueOutbox,
  makeTempNumber,
} from "@/lib/offline/outbox";
import {
  applyOptimisticInvoiceToSnapshot,
  applyOptimisticPartyPaymentToSnapshot,
  applyOptimisticExpenseToSnapshot,
} from "@/lib/offline/snapshot";
import type {
  OutboxInvoicePayload,
  OutboxPartyPaymentPayload,
} from "@/lib/offline/types";

export async function createInvoiceOnlineOrQueue(
  supabase: SupabaseClient,
  input: CreateCompletedInvoiceInput
): Promise<CreateCompletedInvoiceResult> {
  const occurredAt = input.createdAt || new Date().toISOString();
  const clientOpId = input.clientOpId || crypto.randomUUID();

  if (isLikelyOnline()) {
    try {
      const result = await createCompletedInvoice(supabase, {
        ...input,
        createdAt: occurredAt,
        clientOpId,
      });
      try {
        await applyOptimisticInvoiceToSnapshot({
          type: input.type,
          items: input.items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
          customerId: input.customerId,
          supplierId: input.supplierId,
          remaining: Math.max(0, input.total - input.paidAmount),
          paidAmount: input.paidAmount,
          safeId: input.safeId,
        });
      } catch {
        /* local mirror best-effort */
      }
      scheduleBackgroundSync();
      return result;
    } catch (err) {
      if (!isLikelyNetworkError(err)) throw err;
    }
  }

  const tempNumber = makeTempNumber("invoice");
  const payload: OutboxInvoicePayload = {
    type: input.type,
    items: input.items.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit_cost: item.unit_cost,
      discount: item.discount ?? 0,
      total: item.total,
    })),
    subtotal: input.subtotal,
    taxAmount: input.taxAmount ?? 0,
    discountAmount: input.discountAmount ?? 0,
    total: input.total,
    paidAmount: input.paidAmount,
    paymentMethod: input.paymentMethod,
    customerId: input.customerId,
    supplierId: input.supplierId,
    safeId: input.safeId,
    notes: input.notes,
    originalInvoiceId: input.originalInvoiceId,
    tempNumber,
    label:
      input.type === "sale"
        ? "بيع"
        : input.type === "purchase"
          ? "شراء"
          : input.type === "sale_return"
            ? "مرتجع مبيعات"
            : "مرتجع مشتريات",
  };

  await enqueueOutbox({
    id: clientOpId,
    type: "invoice",
    payload,
    occurredAt,
  });

  await applyOptimisticInvoiceToSnapshot({
    type: input.type,
    items: payload.items,
    customerId: input.customerId,
    supplierId: input.supplierId,
    remaining: Math.max(0, input.total - input.paidAmount),
    paidAmount: input.paidAmount,
    safeId: input.safeId,
  });

  return {
    id: clientOpId,
    invoice_number: tempNumber,
    offline: true,
  };
}

export async function applyPartyPaymentOnlineOrQueue(
  supabase: SupabaseClient,
  params: ApplyPartyPaymentParams & { createdAt?: string }
): Promise<{ paymentId: string; offline?: boolean; tempNumber?: string }> {
  const occurredAt = params.createdAt || new Date().toISOString();
  const clientOpId = crypto.randomUUID();

  if (isLikelyOnline()) {
    try {
      // Idempotency claim so retries don't double-apply while "online"
      const { data: claim, error: claimErr } = await supabase.rpc(
        "claim_client_operation",
        {
          p_client_op_id: clientOpId,
          p_op_type: "party_payment",
          p_occurred_at: occurredAt,
        }
      );
      if (claimErr) throw new Error(claimErr.message);
      const claimRow = claim as {
        status?: string;
        result?: { paymentId?: string; number?: string };
      } | null;
      if (claimRow?.status === "done" && claimRow.result?.paymentId) {
        return {
          paymentId: String(claimRow.result.paymentId),
        };
      }

      const result = await applyPartyPayment(supabase, {
        ...params,
        createdAt: occurredAt,
      });
      await supabase.rpc("complete_client_operation", {
        p_client_op_id: clientOpId,
        p_entity_id: result.paymentId,
        p_entity_number: null,
        p_result: { paymentId: result.paymentId },
      });
      try {
        await applyOptimisticPartyPaymentToSnapshot({
          kind: params.kind,
          partyId: params.partyId,
          amount: params.amount,
          safeId: params.safeId,
        });
      } catch {
        /* local mirror best-effort */
      }
      scheduleBackgroundSync();
      return result;
    } catch (err) {
      if (!isLikelyNetworkError(err)) throw err;
    }
  }

  const tempNumber = makeTempNumber("party_payment");
  const payload: OutboxPartyPaymentPayload = {
    kind: params.kind,
    partyId: params.partyId,
    amount: params.amount,
    safeId: params.safeId,
    notes: params.notes,
    partyName: params.partyName,
    tempNumber,
  };

  await enqueueOutbox({
    id: clientOpId,
    type: "party_payment",
    payload,
    occurredAt,
  });

  await applyOptimisticPartyPaymentToSnapshot({
    kind: params.kind,
    partyId: params.partyId,
    amount: params.amount,
    safeId: params.safeId,
  });

  return { paymentId: clientOpId, offline: true, tempNumber };
}

export async function createExpenseOnlineOrQueue(
  supabase: SupabaseClient,
  input: CreateExpenseInput & { accountName?: string }
): Promise<{
  data: { entry_id: string; entry_number: string } | null;
  error: string | null;
  offline?: boolean;
  pending?: boolean;
}> {
  const { writeExpenseLocal, enqueueExpenseCreate } = await import(
    "@/lib/offline/expenses-local"
  );
  const occurredAt = input.createdAt || new Date().toISOString();

  if (isLikelyOnline()) {
    try {
      const clientOpId = crypto.randomUUID();
      const { data: claim, error: claimErr } = await supabase.rpc(
        "claim_client_operation",
        {
          p_client_op_id: clientOpId,
          p_op_type: "expense",
          p_occurred_at: occurredAt,
        }
      );
      if (claimErr) throw new Error(claimErr.message);
      const claimRow = claim as {
        status?: string;
        result?: { entry_id?: string; entry_number?: string };
      } | null;
      if (claimRow?.status === "done" && claimRow.result?.entry_id) {
        return {
          data: {
            entry_id: String(claimRow.result.entry_id),
            entry_number: String(claimRow.result.entry_number || ""),
          },
          error: null,
        };
      }

      const result = await createExpense(supabase, {
        ...input,
        createdAt: occurredAt,
      });
      if (!result.error && result.data) {
        await supabase.rpc("complete_client_operation", {
          p_client_op_id: clientOpId,
          p_entity_id: result.data.entry_id,
          p_entity_number: result.data.entry_number,
          p_result: {
            entry_id: result.data.entry_id,
            entry_number: result.data.entry_number,
          },
        });
        try {
          // Mirror into local stores for offline list
          await writeExpenseLocal({
            ...input,
            localEntryId: result.data.entry_id,
            tempNumber: result.data.entry_number,
            createdAt: result.data.created_at || occurredAt,
            mirrorOnly: true,
          });
        } catch {
          /* local mirror best-effort; sync will fill */
        }
        try {
          await applyOptimisticExpenseToSnapshot({
            amount: input.amount,
            safeId: input.safeId,
          });
        } catch {
          /* ignore */
        }
        scheduleBackgroundSync();
      }
      if (!result.error) return result;
      if (result.error && !isLikelyNetworkError(new Error(result.error))) {
        return result;
      }
    } catch (err) {
      if (!isLikelyNetworkError(err)) {
        return {
          data: null,
          error: err instanceof Error ? err.message : "تعذر حفظ المصروف",
        };
      }
    }
  }

  try {
    const local = await writeExpenseLocal({
      ...input,
      createdAt: occurredAt,
    });
    await enqueueExpenseCreate(local, { ...input, createdAt: occurredAt });
    return {
      data: { entry_id: local.entry_id, entry_number: local.entry_number },
      error: null,
      offline: true,
      pending: true,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "تعذر حفظ المصروف على الجهاز",
    };
  }
}

export async function updateExpenseOnlineOrQueue(
  supabase: SupabaseClient,
  entryId: string,
  input: CreateExpenseInput,
  before?: import("@/lib/expenses").ExpenseListItem
): Promise<{
  data: { entry_id: string; entry_number: string } | null;
  error: string | null;
  offline?: boolean;
  pending?: boolean;
}> {
  const { updateExpense } = await import("@/lib/expenses");
  const { writeExpenseLocal, enqueueExpenseUpdate, deleteExpenseLocal } =
    await import("@/lib/offline/expenses-local");

  if (isLikelyOnline()) {
    try {
      const result = await updateExpense(supabase, entryId, input, before);
      if (!result.error && result.data) {
        try {
          // Soft-remove old local rows without reversing balances (server already did)
          const { softDeleteEntity, listActiveEntities } = await import(
            "@/lib/offline/db"
          );
          const { getOrCreateDeviceId } = await import("@/lib/offline/device");
          const { tickHlc } = await import("@/lib/offline/hlc");
          const deviceId = await getOrCreateDeviceId();
          const hlc = tickHlc(deviceId);
          const lines = (await listActiveEntities("journal_lines")).filter(
            (l) => String(l.entry_id) === entryId
          );
          const txs = (await listActiveEntities("safe_transactions")).filter(
            (t) => String(t.reference_id) === entryId
          );
          for (const line of lines) {
            await softDeleteEntity("journal_lines", String(line.id), hlc);
          }
          for (const t of txs) {
            await softDeleteEntity("safe_transactions", String(t.id), hlc);
          }
          await softDeleteEntity("journal_entries", entryId, hlc);
        } catch {
          /* ignore */
        }
        try {
          await writeExpenseLocal({
            ...input,
            localEntryId: result.data.entry_id,
            tempNumber: result.data.entry_number,
            createdAt: result.data.created_at,
            mirrorOnly: true,
          });
        } catch {
          /* ignore */
        }
        scheduleBackgroundSync();
        return {
          data: {
            entry_id: result.data.entry_id,
            entry_number: result.data.entry_number,
          },
          error: null,
        };
      }
      if (result.error && !isLikelyNetworkError(new Error(result.error))) {
        return { data: null, error: result.error };
      }
    } catch (err) {
      if (!isLikelyNetworkError(err)) {
        return {
          data: null,
          error: err instanceof Error ? err.message : "تعذر تعديل المصروف",
        };
      }
    }
  }

  try {
    await deleteExpenseLocal(entryId);
    const local = await writeExpenseLocal({
      ...input,
      localEntryId: entryId,
      tempNumber: before?.entry_number,
      createdAt: input.createdAt || new Date().toISOString(),
    });
    await enqueueExpenseUpdate(entryId, input, before);
    return {
      data: { entry_id: local.entry_id, entry_number: local.entry_number },
      error: null,
      offline: true,
      pending: true,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "تعذر تعديل المصروف على الجهاز",
    };
  }
}

export async function deleteExpenseOnlineOrQueue(
  supabase: SupabaseClient,
  entryId: string
): Promise<{ error: string | null; offline?: boolean; pending?: boolean }> {
  const { deleteExpense } = await import("@/lib/expenses");
  const { deleteExpenseLocal, enqueueExpenseDelete } = await import(
    "@/lib/offline/expenses-local"
  );

  if (isLikelyOnline()) {
    try {
      const result = await deleteExpense(supabase, entryId);
      if (!result.error) {
        try {
          await deleteExpenseLocal(entryId);
        } catch {
          /* ignore */
        }
        scheduleBackgroundSync();
        return { error: null };
      }
      if (!isLikelyNetworkError(new Error(result.error))) {
        return result;
      }
    } catch (err) {
      if (!isLikelyNetworkError(err)) {
        return {
          error: err instanceof Error ? err.message : "تعذر حذف المصروف",
        };
      }
    }
  }

  try {
    await deleteExpenseLocal(entryId);
    await enqueueExpenseDelete(entryId);
    return { error: null, offline: true, pending: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "تعذر حذف المصروف على الجهاز",
    };
  }
}

export async function createExpenseAccountOnlineOrQueue(
  supabase: SupabaseClient,
  name: string
): Promise<{
  data: import("@/types").Account | null;
  error: string | null;
  offline?: boolean;
}> {
  const { createExpenseAccount } = await import("@/lib/expenses");
  const { createExpenseAccountLocal } = await import(
    "@/lib/offline/expenses-local"
  );

  if (isLikelyOnline()) {
    try {
      const result = await createExpenseAccount(supabase, name);
      if (!result.error && result.data) {
        try {
          const { putEntity } = await import("@/lib/offline/db");
          await putEntity(
            "accounts",
            result.data as unknown as Record<string, unknown>
          );
        } catch {
          /* ignore */
        }
        scheduleBackgroundSync();
        return result;
      }
      if (result.error && !isLikelyNetworkError(new Error(result.error))) {
        return result;
      }
    } catch (err) {
      if (!isLikelyNetworkError(err)) {
        return {
          data: null,
          error: err instanceof Error ? err.message : "تعذر إنشاء الحساب",
        };
      }
    }
  }

  try {
    const row = await createExpenseAccountLocal(name);
    return {
      data: row as unknown as import("@/types").Account,
      error: null,
      offline: true,
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "تعذر إنشاء الحساب على الجهاز",
    };
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { adjustProductStock } from "@/lib/inventory";
import {
  adjustCustomerBalance,
  adjustSupplierBalance,
} from "@/lib/party-balance";
import { syncInvoiceSafePayment } from "@/lib/safe-transactions";
import { logAuditEvent } from "@/lib/audit";
import { insertInvoiceItems } from "@/lib/invoice-cost";

async function resolveInvoiceSafeId(
  supabase: SupabaseClient,
  invoiceId: string,
  preferred?: string | null
): Promise<string | null> {
  if (preferred) return preferred;
  const { data } = await supabase
    .from("safe_transactions")
    .select("safe_id")
    .eq("reference_id", invoiceId)
    .eq("reference_type", "invoice")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.safe_id || null;
}

export type ReturnInvoiceRef = {
  id: string;
  invoice_number: string;
  type: "sale_return" | "purchase_return";
  customer_id?: string | null;
  supplier_id?: string | null;
  total: number;
  paid_amount: number;
  safe_id?: string | null;
  original_invoice_id?: string | null;
};

export type ReturnLineInput = {
  product_id: string;
  quantity: number;
  unit_price: number;
  unit_cost?: number | null;
  discount?: number;
  total: number;
};

/**
 * Delete a return invoice and reverse stock / party balance / safe cash.
 * sale_return: stock was +qty → remove; balance was -remaining → restore +remaining
 * purchase_return: stock was -qty → restore; balance was -remaining → restore +remaining
 */
export async function deleteReturnInvoiceFully(
  supabase: SupabaseClient,
  inv: ReturnInvoiceRef
): Promise<void> {
  if (inv.type !== "sale_return" && inv.type !== "purchase_return") {
    throw new Error("الفاتورة ليست مرتجعاً");
  }

  const { count: allocCount } = await supabase
    .from("party_payment_allocations")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", inv.id);
  if ((allocCount || 0) > 0) {
    throw new Error(
      `لا يمكن حذف المرتجع ${inv.invoice_number} لأنه مرتبط بدفعات. احذف الدفعة أولاً.`
    );
  }

  const paid = Number(inv.paid_amount) || 0;
  const remaining = Math.max(0, Number(inv.total) - paid);
  const safeId = await resolveInvoiceSafeId(supabase, inv.id, inv.safe_id);

  const { data: lines } = await supabase
    .from("invoice_items")
    .select("product_id, quantity")
    .eq("invoice_id", inv.id);

  if (paid > 0) {
    await syncInvoiceSafePayment(supabase, {
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      invoiceType: inv.type,
      oldPaidAmount: paid,
      oldSafeId: safeId,
      newPaidAmount: 0,
      newSafeId: null,
    });
  }

  // Create applied -remaining; undo with +remaining
  if (remaining > 0) {
    if (inv.type === "sale_return" && inv.customer_id) {
      await adjustCustomerBalance(supabase, inv.customer_id, remaining);
    }
    if (inv.type === "purchase_return" && inv.supplier_id) {
      await adjustSupplierBalance(supabase, inv.supplier_id, remaining);
    }
  }

  const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
  if (error) {
    if (remaining > 0) {
      if (inv.type === "sale_return" && inv.customer_id) {
        await adjustCustomerBalance(supabase, inv.customer_id, -remaining);
      }
      if (inv.type === "purchase_return" && inv.supplier_id) {
        await adjustSupplierBalance(supabase, inv.supplier_id, -remaining);
      }
    }
    if (paid > 0 && safeId) {
      await syncInvoiceSafePayment(supabase, {
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        invoiceType: inv.type,
        oldPaidAmount: 0,
        oldSafeId: null,
        newPaidAmount: paid,
        newSafeId: safeId,
      });
    }
    throw new Error(error.message);
  }

  const stockLines = (lines || []).map((l) => ({
    product_id: l.product_id,
    quantity: Number(l.quantity),
  }));

  try {
    // Reverse create directions: sale_return +1 → -1; purchase_return -1 → +1
    await adjustProductStock(
      supabase,
      stockLines,
      inv.type === "sale_return" ? -1 : 1,
      { allowNegative: true }
    );
  } catch (stockErr) {
    const detail =
      stockErr instanceof Error ? stockErr.message : "خطأ غير معروف";
    throw new Error(
      `تم حذف المرتجع ${inv.invoice_number} وعكس الحسابات، لكن فشل عكس المخزون: ${detail}. راجع كميات الأصناف يدوياً.`
    );
  }

  await logAuditEvent(supabase, {
    action: "invoice.delete",
    entityType: "invoice",
    entityId: inv.id,
    entityLabel: inv.invoice_number,
    before: {
      type: inv.type,
      total: inv.total,
      paid_amount: inv.paid_amount,
      customer_id: inv.customer_id,
      supplier_id: inv.supplier_id,
      original_invoice_id: inv.original_invoice_id,
    },
    source: "app",
  });
}

async function assertReturnLinesAgainstOriginal(
  supabase: SupabaseClient,
  params: {
    originalInvoiceId: string;
    returnType: "sale_return" | "purchase_return";
    excludeReturnId: string;
    items: ReturnLineInput[];
  }
) {
  const { data: origLines, error: origErr } = await supabase
    .from("invoice_items")
    .select("product_id, quantity, unit_price")
    .eq("invoice_id", params.originalInvoiceId);
  if (origErr) throw new Error(origErr.message);

  const origAgg = new Map<string, number>();
  for (const line of origLines || []) {
    const key = `${line.product_id}|${Number(line.unit_price).toFixed(4)}`;
    origAgg.set(key, (origAgg.get(key) || 0) + Number(line.quantity));
  }

  const { data: otherReturns, error: retErr } = await supabase
    .from("invoices")
    .select("id, invoice_items(product_id, quantity, unit_price)")
    .eq("original_invoice_id", params.originalInvoiceId)
    .eq("type", params.returnType)
    .eq("status", "completed")
    .neq("id", params.excludeReturnId);
  if (retErr) throw new Error(retErr.message);

  const returnedAgg = new Map<string, number>();
  for (const ret of otherReturns || []) {
    const items = (
      ret as {
        invoice_items?: {
          product_id: string;
          quantity: number;
          unit_price: number;
        }[];
      }
    ).invoice_items;
    for (const item of items || []) {
      const key = `${item.product_id}|${Number(item.unit_price).toFixed(4)}`;
      returnedAgg.set(key, (returnedAgg.get(key) || 0) + Number(item.quantity));
    }
  }

  for (const item of params.items) {
    const key = `${item.product_id}|${Number(item.unit_price).toFixed(4)}`;
    const origQty = origAgg.get(key) || 0;
    if (origQty <= 0) {
      throw new Error("صنف غير موجود في الفاتورة الأصلية بهذا السعر");
    }
    const remaining = origQty - (returnedAgg.get(key) || 0);
    if (Number(item.quantity) > remaining + 0.001) {
      throw new Error("كمية الإرجاع أكبر من الكمية المتبقية في الفاتورة الأصلية");
    }
  }
}

/**
 * Update an existing return: reverse old impacts, write new lines, apply new impacts.
 * Prices must still match the original invoice; original invoice cannot change.
 */
export async function updateReturnInvoiceFully(
  supabase: SupabaseClient,
  existing: ReturnInvoiceRef,
  next: {
    items: ReturnLineInput[];
    total: number;
    paidAmount: number;
    paymentMethod: "cash" | "credit";
    safeId?: string | null;
    notes?: string | null;
    customerId?: string | null;
    supplierId?: string | null;
  }
): Promise<void> {
  if (!existing.original_invoice_id) {
    throw new Error("المرتجع غير مربوط بفاتورة أصلية");
  }
  if (!next.items.length) {
    throw new Error("بنود المرتجع مطلوبة");
  }

  await assertReturnLinesAgainstOriginal(supabase, {
    originalInvoiceId: existing.original_invoice_id,
    returnType: existing.type,
    excludeReturnId: existing.id,
    items: next.items,
  });

  const { data: oldLines } = await supabase
    .from("invoice_items")
    .select("product_id, quantity")
    .eq("invoice_id", existing.id);

  const oldPaid = Number(existing.paid_amount) || 0;
  const oldRemaining = Math.max(0, Number(existing.total) - oldPaid);
  const newPaid = Number(next.paidAmount) || 0;
  const newRemaining = Math.max(0, Number(next.total) - newPaid);
  const oldSafeId = await resolveInvoiceSafeId(
    supabase,
    existing.id,
    existing.safe_id
  );
  const newSafeId = newPaid > 0 ? next.safeId || null : null;

  if (newPaid > 0 && !newSafeId) {
    throw new Error("الرجاء تحديد الخزنة للمدفوعات النقدية");
  }

  if (existing.type === "sale_return" && next.paymentMethod === "credit" && !next.customerId) {
    throw new Error("العميل مطلوب لمرتجعات المبيعات الآجلة");
  }
  if (
    existing.type === "purchase_return" &&
    next.paymentMethod === "credit" &&
    !next.supplierId
  ) {
    throw new Error("المورد مطلوب لمرتجعات المشتريات الآجلة");
  }

  // Money first
  await syncInvoiceSafePayment(supabase, {
    invoiceId: existing.id,
    invoiceNumber: existing.invoice_number,
    invoiceType: existing.type,
    oldPaidAmount: oldPaid,
    oldSafeId,
    newPaidAmount: newPaid,
    newSafeId,
  });

  // Undo old credit impact (+oldRemaining), apply new (-newRemaining)
  if (existing.type === "sale_return") {
    if (oldRemaining > 0 && existing.customer_id) {
      await adjustCustomerBalance(supabase, existing.customer_id, oldRemaining);
    }
    if (newRemaining > 0 && next.customerId) {
      await adjustCustomerBalance(supabase, next.customerId, -newRemaining);
    }
  } else {
    if (oldRemaining > 0 && existing.supplier_id) {
      await adjustSupplierBalance(supabase, existing.supplier_id, oldRemaining);
    }
    if (newRemaining > 0 && next.supplierId) {
      await adjustSupplierBalance(supabase, next.supplierId, -newRemaining);
    }
  }

  const { error: updErr } = await supabase
    .from("invoices")
    .update({
      subtotal: next.total,
      tax_amount: 0,
      discount_amount: 0,
      total: next.total,
      paid_amount: newPaid,
      payment_method: next.paymentMethod,
      safe_id: newSafeId,
      notes: next.notes || null,
      customer_id:
        existing.type === "sale_return" ? next.customerId || null : null,
      supplier_id:
        existing.type === "purchase_return" ? next.supplierId || null : null,
    })
    .eq("id", existing.id);

  if (updErr) {
    // Best-effort rollback of money
    await syncInvoiceSafePayment(supabase, {
      invoiceId: existing.id,
      invoiceNumber: existing.invoice_number,
      invoiceType: existing.type,
      oldPaidAmount: newPaid,
      oldSafeId: newSafeId,
      newPaidAmount: oldPaid,
      newSafeId: oldSafeId,
    });
    if (existing.type === "sale_return") {
      if (newRemaining > 0 && next.customerId) {
        await adjustCustomerBalance(supabase, next.customerId, newRemaining);
      }
      if (oldRemaining > 0 && existing.customer_id) {
        await adjustCustomerBalance(supabase, existing.customer_id, -oldRemaining);
      }
    } else {
      if (newRemaining > 0 && next.supplierId) {
        await adjustSupplierBalance(supabase, next.supplierId, newRemaining);
      }
      if (oldRemaining > 0 && existing.supplier_id) {
        await adjustSupplierBalance(supabase, existing.supplier_id, -oldRemaining);
      }
    }
    throw new Error(updErr.message);
  }

  await supabase.from("invoice_items").delete().eq("invoice_id", existing.id);

  const insertRows = next.items.map((item) => ({
    invoice_id: existing.id,
    product_id: item.product_id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    unit_cost:
      item.unit_cost != null
        ? Number(item.unit_cost)
        : existing.type === "purchase_return"
          ? Number(item.unit_price)
          : 0,
    discount: item.discount ?? 0,
    total: item.total,
  }));

  const { error: itemsErr } = await insertInvoiceItems(supabase, insertRows);
  if (itemsErr) {
    throw new Error(itemsErr.message || "تعذر حفظ بنود المرتجع");
  }

  const oldStock = (oldLines || []).map((l) => ({
    product_id: l.product_id,
    quantity: Number(l.quantity),
  }));
  const newStock = next.items.map((l) => ({
    product_id: l.product_id,
    quantity: Number(l.quantity),
  }));

  // sale_return create direction +1; purchase_return -1
  const applyDir: 1 | -1 = existing.type === "sale_return" ? 1 : -1;
  await adjustProductStock(
    supabase,
    oldStock,
    (applyDir === 1 ? -1 : 1) as 1 | -1,
    { silent: true, allowNegative: true }
  );
  await adjustProductStock(supabase, newStock, applyDir, {
    silent: true,
    allowNegative: true,
  });

  await logAuditEvent(supabase, {
    action: "invoice.update",
    entityType: "invoice",
    entityId: existing.id,
    entityLabel: existing.invoice_number,
    before: {
      type: existing.type,
      total: existing.total,
      paid_amount: existing.paid_amount,
    },
    after: {
      type: existing.type,
      total: next.total,
      paid_amount: newPaid,
    },
    source: "app",
  });
}

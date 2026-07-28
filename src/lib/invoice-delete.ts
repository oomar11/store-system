import type { SupabaseClient } from "@supabase/supabase-js";
import { adjustProductStock } from "@/lib/inventory";
import {
  adjustCustomerBalance,
  adjustSupplierBalance,
} from "@/lib/party-balance";
import { syncInvoiceSafePayment } from "@/lib/safe-transactions";
import { cancelDocumentsLinkedToInvoice } from "@/lib/documents-link";
import { logAuditEvent } from "@/lib/audit";
import { guardInvoiceDelete } from "@/lib/delete-guards";

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

export type DeletableSaleInvoice = {
  id: string;
  invoice_number: string;
  customer_id?: string | null;
  total: number;
  paid_amount: number;
  safe_id?: string | null;
};

export type DeletablePurchaseInvoice = {
  id: string;
  invoice_number: string;
  supplier_id?: string | null;
  total: number;
  paid_amount: number;
  safe_id?: string | null;
};

/**
 * Delete a sale invoice and reverse stock, customer credit, and safe cash.
 * Money is reversed before delete; stock after successful delete.
 * On delete failure, money side-effects are restored.
 */
export async function deleteSaleInvoiceFully(
  supabase: SupabaseClient,
  inv: DeletableSaleInvoice
): Promise<{ cancelledDocs: number }> {
  const guard = await guardInvoiceDelete(supabase, inv.id, inv.invoice_number);
  if (!guard.ok) throw new Error(guard.message);

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
      invoiceType: "sale",
      oldPaidAmount: paid,
      oldSafeId: safeId,
      newPaidAmount: 0,
      newSafeId: null,
    });
  }

  if (remaining > 0 && inv.customer_id) {
    await adjustCustomerBalance(supabase, inv.customer_id, -remaining);
  }

  const cancelledDocs = await cancelDocumentsLinkedToInvoice(
    supabase,
    inv.id,
    inv.invoice_number
  );

  const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
  if (error) {
    if (remaining > 0 && inv.customer_id) {
      await adjustCustomerBalance(supabase, inv.customer_id, remaining);
    }
    if (paid > 0 && safeId) {
      await syncInvoiceSafePayment(supabase, {
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        invoiceType: "sale",
        oldPaidAmount: 0,
        oldSafeId: null,
        newPaidAmount: paid,
        newSafeId: safeId,
      });
    }
    throw new Error(error.message);
  }

  try {
    await adjustProductStock(
      supabase,
      (lines || []).map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity),
      })),
      1
    );
  } catch (stockErr) {
    const detail =
      stockErr instanceof Error ? stockErr.message : "خطأ غير معروف";
    throw new Error(
      `تم حذف الفاتورة ${inv.invoice_number} وعكس الحسابات، لكن فشل إرجاع المخزون: ${detail}. راجع كميات الأصناف يدوياً.`
    );
  }

  await logAuditEvent(supabase, {
    action: "invoice.delete",
    entityType: "invoice",
    entityId: inv.id,
    entityLabel: inv.invoice_number,
    before: {
      type: "sale",
      total: inv.total,
      paid_amount: inv.paid_amount,
      customer_id: inv.customer_id,
    },
    meta: { cancelled_docs: cancelledDocs },
    source: "app",
  });

  // Local tombstone so offline peers never resurrect this invoice
  if (typeof window !== "undefined") {
    try {
      const { markDeletedLocalOnly } = await import(
        "@/lib/offline/repositories"
      );
      await markDeletedLocalOnly("invoices", inv.id);
    } catch {
      /* best-effort */
    }
  }

  return { cancelledDocs };
}

/**
 * Delete a purchase invoice and reverse stock, supplier credit, and safe cash.
 */
export async function deletePurchaseInvoiceFully(
  supabase: SupabaseClient,
  inv: DeletablePurchaseInvoice
): Promise<{ cancelledDocs: number }> {
  const guard = await guardInvoiceDelete(supabase, inv.id, inv.invoice_number);
  if (!guard.ok) throw new Error(guard.message);

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
      invoiceType: "purchase",
      oldPaidAmount: paid,
      oldSafeId: safeId,
      newPaidAmount: 0,
      newSafeId: null,
    });
  }

  if (remaining > 0 && inv.supplier_id) {
    await adjustSupplierBalance(supabase, inv.supplier_id, -remaining);
  }

  const cancelledDocs = await cancelDocumentsLinkedToInvoice(
    supabase,
    inv.id,
    inv.invoice_number
  );

  const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
  if (error) {
    if (remaining > 0 && inv.supplier_id) {
      await adjustSupplierBalance(supabase, inv.supplier_id, remaining);
    }
    if (paid > 0 && safeId) {
      await syncInvoiceSafePayment(supabase, {
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        invoiceType: "purchase",
        oldPaidAmount: 0,
        oldSafeId: null,
        newPaidAmount: paid,
        newSafeId: safeId,
      });
    }
    throw new Error(error.message);
  }

  try {
    await adjustProductStock(
      supabase,
      (lines || []).map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity),
      })),
      -1
    );
  } catch (stockErr) {
    const detail =
      stockErr instanceof Error ? stockErr.message : "خطأ غير معروف";
    throw new Error(
      `تم حذف الفاتورة ${inv.invoice_number} وعكس الحسابات، لكن فشل عكس المخزون: ${detail}. راجع كميات الأصناف يدوياً.`
    );
  }

  await logAuditEvent(supabase, {
    action: "invoice.delete",
    entityType: "invoice",
    entityId: inv.id,
    entityLabel: inv.invoice_number,
    before: {
      type: "purchase",
      total: inv.total,
      paid_amount: inv.paid_amount,
      supplier_id: inv.supplier_id,
    },
    meta: { cancelled_docs: cancelledDocs },
    source: "app",
  });

  if (typeof window !== "undefined") {
    try {
      const { markDeletedLocalOnly } = await import(
        "@/lib/offline/repositories"
      );
      await markDeletedLocalOnly("invoices", inv.id);
    } catch {
      /* best-effort */
    }
  }

  return { cancelledDocs };
}

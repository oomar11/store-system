import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceItemInsert } from "@/lib/invoice-cost";
import { formatRpcError } from "@/lib/rpc-error";

export type CreateCompletedInvoiceInput = {
  type: "sale" | "purchase" | "sale_return" | "purchase_return";
  items: Array<
    Pick<
      InvoiceItemInsert,
      | "product_id"
      | "quantity"
      | "unit_price"
      | "unit_cost"
      | "discount"
      | "total"
      | "list_unit_price"
    >
  >;
  subtotal: number;
  taxAmount?: number;
  discountAmount?: number;
  total: number;
  paidAmount: number;
  paymentMethod: "cash" | "credit";
  customerId?: string | null;
  supplierId?: string | null;
  safeId?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  /** Required for sale_return / purchase_return */
  originalInvoiceId?: string | null;
  /** Idempotency key for offline sync / retries */
  clientOpId?: string | null;
};

export type CreateCompletedInvoiceResult = {
  id: string;
  invoice_number: string;
  offline?: boolean;
};

/** Create sale/purchase invoice atomically (invoice + items + stock + balance + safe). */
export async function createCompletedInvoice(
  supabase: SupabaseClient,
  input: CreateCompletedInvoiceInput
): Promise<CreateCompletedInvoiceResult> {
  if (!input.items.length) {
    throw new Error("بنود الفاتورة مطلوبة");
  }

  if (
    (input.type === "sale_return" || input.type === "purchase_return") &&
    !input.originalInvoiceId
  ) {
    throw new Error("الفاتورة الأصلية مطلوبة للمرتجع");
  }

  const occurredAt = input.createdAt || new Date().toISOString();

  const { data, error } = await supabase.rpc("create_completed_invoice", {
    p_type: input.type,
    p_items: input.items.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit_cost: item.unit_cost,
      discount: item.discount ?? 0,
      total: item.total,
      list_unit_price:
        item.list_unit_price != null ? item.list_unit_price : null,
    })),
    p_subtotal: input.subtotal,
    p_tax_amount: input.taxAmount ?? 0,
    p_discount_amount: input.discountAmount ?? 0,
    p_total: input.total,
    p_paid_amount: input.paidAmount,
    p_payment_method: input.paymentMethod,
    p_customer_id: input.customerId || null,
    p_supplier_id: input.supplierId || null,
    p_safe_id: input.safeId || null,
    p_notes: input.notes || null,
    p_created_at: occurredAt,
    p_original_invoice_id: input.originalInvoiceId || null,
    p_client_op_id: input.clientOpId || null,
  });

  if (error) {
    throw new Error(formatRpcError(error.message, "تعذر حفظ الفاتورة"));
  }

  const row = data as CreateCompletedInvoiceResult | null;
  if (!row?.id || !row?.invoice_number) {
    throw new Error("تعذر حفظ الفاتورة");
  }

  // Persist tier list prices (RPC may not know the column yet on older DBs)
  const listRows = input.items.filter(
    (item) =>
      item.list_unit_price != null &&
      Number(item.list_unit_price) > Number(item.unit_price) + 0.001
  );
  if (listRows.length > 0) {
    await Promise.all(
      listRows.map((item) =>
        supabase
          .from("invoice_items")
          .update({ list_unit_price: item.list_unit_price })
          .eq("invoice_id", row.id)
          .eq("product_id", item.product_id)
          .eq("unit_price", item.unit_price)
      )
    );
  }

  return {
    id: String(row.id),
    invoice_number: String(row.invoice_number),
  };
}

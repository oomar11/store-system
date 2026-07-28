import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteGuardResult =
  | { ok: true }
  | { ok: false; message: string };

async function countRows(
  supabase: SupabaseClient,
  table: string,
  column: string,
  id: string
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, id);
  if (error) {
    // جدول قد لا يكون موجوداً في بعض البيئات
    return 0;
  }
  return count || 0;
}

/** يمنع حذف فاتورة عليها مرتجعات أو تخصيصات دفع */
export async function guardInvoiceDelete(
  supabase: SupabaseClient,
  invoiceId: string,
  invoiceNumber: string
): Promise<DeleteGuardResult> {
  const { count: allocCount } = await supabase
    .from("party_payment_allocations")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId);
  if ((allocCount || 0) > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف الفاتورة ${invoiceNumber} لأنها مرتبطة بدفعات. احذف الدفعة أولاً.`,
    };
  }

  const { count: returnCount } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("original_invoice_id", invoiceId);
  if ((returnCount || 0) > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف الفاتورة ${invoiceNumber} لأن عليها مرتجعات. احذف المرتجعات أولاً.`,
    };
  }

  return { ok: true };
}

/** يمنع حذف صنف له سجل عمليات */
export async function guardProductDelete(
  supabase: SupabaseClient,
  productId: string,
  productName?: string
): Promise<DeleteGuardResult> {
  const label = productName ? `«${productName}»` : "هذا الصنف";

  const invoiceItems = await countRows(
    supabase,
    "invoice_items",
    "product_id",
    productId
  );
  if (invoiceItems > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأنه مستخدم في فواتير (${invoiceItems}).`,
    };
  }

  const docItems = await countRows(
    supabase,
    "document_items",
    "product_id",
    productId
  );
  if (docItems > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأنه مستخدم في عروض/طلبات شراء (${docItems}).`,
    };
  }

  const countLines = await countRows(
    supabase,
    "inventory_count_lines",
    "product_id",
    productId
  );
  if (countLines > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأنه ظهر في جرد مخزون.`,
    };
  }

  return { ok: true };
}

/** يمنع حذف عميل له فواتير أو مدفوعات أو رصيد */
export async function guardCustomerDelete(
  supabase: SupabaseClient,
  customerId: string,
  customerName?: string
): Promise<DeleteGuardResult> {
  const label = customerName ? `«${customerName}»` : "هذا العميل";

  const { data: customer } = await supabase
    .from("customers")
    .select("balance")
    .eq("id", customerId)
    .maybeSingle();
  if (customer && Math.abs(Number(customer.balance) || 0) > 0.001) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن رصيده غير صفري.`,
    };
  }

  const invoices = await countRows(
    supabase,
    "invoices",
    "customer_id",
    customerId
  );
  if (invoices > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن له عمليات سابقة (فواتير: ${invoices}) حتى لو الرصيد صفراً.`,
    };
  }

  const payments = await countRows(
    supabase,
    "party_payments",
    "customer_id",
    customerId
  );
  if (payments > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن له عمليات سابقة (مدفوعات).`,
    };
  }

  const docs = await countRows(supabase, "documents", "customer_id", customerId);
  if (docs > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن له عمليات سابقة (عروض أسعار).`,
    };
  }

  return { ok: true };
}

/** يمنع حذف مورد له فواتير أو مدفوعات أو رصيد */
export async function guardSupplierDelete(
  supabase: SupabaseClient,
  supplierId: string,
  supplierName?: string
): Promise<DeleteGuardResult> {
  const label = supplierName ? `«${supplierName}»` : "هذا المورد";

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("balance")
    .eq("id", supplierId)
    .maybeSingle();
  if (supplier && Math.abs(Number(supplier.balance) || 0) > 0.001) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن رصيده غير صفري.`,
    };
  }

  const invoices = await countRows(
    supabase,
    "invoices",
    "supplier_id",
    supplierId
  );
  if (invoices > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن له عمليات سابقة (فواتير: ${invoices}) حتى لو الرصيد صفراً.`,
    };
  }

  const payments = await countRows(
    supabase,
    "party_payments",
    "supplier_id",
    supplierId
  );
  if (payments > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن له عمليات سابقة (مدفوعات).`,
    };
  }

  const docs = await countRows(supabase, "documents", "supplier_id", supplierId);
  if (docs > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن له عمليات سابقة (طلبات شراء).`,
    };
  }

  return { ok: true };
}

/** يمنع حذف خزنة عليها حركات أو رصيد أو مستخدمة كدرج كاشير */
export async function guardSafeDelete(
  supabase: SupabaseClient,
  safeId: string,
  safeName?: string
): Promise<DeleteGuardResult> {
  const label = safeName ? `«${safeName}»` : "هذه الخزنة";

  const { data: safe } = await supabase
    .from("safes")
    .select("balance, name")
    .eq("id", safeId)
    .maybeSingle();
  if (!safe) {
    return { ok: false, message: "الخزنة غير موجودة" };
  }
  if (Math.abs(Number(safe.balance) || 0) > 0.001) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن رصيدها غير صفري.`,
    };
  }

  const txs = await countRows(supabase, "safe_transactions", "safe_id", safeId);
  if (txs > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأن لها حركات مالية سابقة (${txs}).`,
    };
  }

  const related = await countRows(
    supabase,
    "safe_transactions",
    "related_safe_id",
    safeId
  );
  if (related > 0) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأنها ظهرت في تحويلات سابقة.`,
    };
  }

  const { data: settings } = await supabase
    .from("settings")
    .select("drawer_safe_id")
    .limit(1)
    .maybeSingle();
  if (settings?.drawer_safe_id === safeId) {
    return {
      ok: false,
      message: `لا يمكن حذف ${label} لأنها خزنة درج الكاشير في الإعدادات.`,
    };
  }

  return { ok: true };
}

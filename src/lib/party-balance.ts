import type { SupabaseClient } from "@supabase/supabase-js";

export async function adjustCustomerBalance(
  supabase: SupabaseClient,
  customerId: string,
  delta: number
) {
  const amount = Number(delta) || 0;
  if (!customerId || amount === 0) return;

  const { error } = await supabase.rpc("adjust_customer_balance", {
    p_id: customerId,
    p_delta: amount,
  });

  if (error) {
    throw new Error(error.message || "تعذر تحديث رصيد العميل");
  }
}

export async function adjustSupplierBalance(
  supabase: SupabaseClient,
  supplierId: string,
  delta: number
) {
  const amount = Number(delta) || 0;
  if (!supplierId || amount === 0) return;

  const { error } = await supabase.rpc("adjust_supplier_balance", {
    p_id: supplierId,
    p_delta: amount,
  });

  if (error) {
    throw new Error(error.message || "تعذر تحديث رصيد المورد");
  }
}

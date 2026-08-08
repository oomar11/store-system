import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency } from "@/lib/utils";

export type NetBalanceSide = "us" | "them" | "zero";

export type NetBalance = {
  /** Signed: positive = ليّا (them owe us), negative = عليّا */
  net: number;
  amount: number;
  side: NetBalanceSide;
  label: string;
  shortLabel: "ليّا" | "عليّا" | "متصفّر";
};

/** net = customer.balance - supplier.balance */
export function computeNetBalance(
  customerBalance: number,
  supplierBalance: number
): NetBalance {
  const net =
    Math.round(((Number(customerBalance) || 0) - (Number(supplierBalance) || 0)) * 100) /
    100;
  const amount = Math.abs(net);
  if (net > 0) {
    return {
      net,
      amount,
      side: "them",
      shortLabel: "ليّا",
      label: `${formatCurrency(amount)} (ليّا)`,
    };
  }
  if (net < 0) {
    return {
      net,
      amount,
      side: "us",
      shortLabel: "عليّا",
      label: `${formatCurrency(amount)} (عليّا)`,
    };
  }
  return {
    net: 0,
    amount: 0,
    side: "zero",
    shortLabel: "متصفّر",
    label: formatCurrency(0),
  };
}

/** Overlapping positive AR and AP that can be settled */
export function computeNettingOffset(
  customerBalance: number,
  supplierBalance: number
): number {
  const c = Math.max(Number(customerBalance) || 0, 0);
  const s = Math.max(Number(supplierBalance) || 0, 0);
  return Math.round(Math.min(c, s) * 100) / 100;
}

export async function linkPartyAccounts(
  supabase: SupabaseClient,
  customerId: string,
  supplierId: string
): Promise<void> {
  const { error } = await supabase.rpc("link_party_accounts", {
    p_customer_id: customerId,
    p_supplier_id: supplierId,
  });
  if (error) throw new Error(error.message || "تعذر ربط الحسابات");
}

export async function unlinkPartyAccounts(
  supabase: SupabaseClient,
  params: { customerId?: string | null; supplierId?: string | null }
): Promise<void> {
  const { error } = await supabase.rpc("unlink_party_accounts", {
    p_customer_id: params.customerId || null,
    p_supplier_id: params.supplierId || null,
  });
  if (error) throw new Error(error.message || "تعذر فك ربط الحسابات");
}

export async function ensureCustomerForSupplier(
  supabase: SupabaseClient,
  supplierId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_customer_for_supplier", {
    p_supplier_id: supplierId,
  });
  if (error) throw new Error(error.message || "تعذر تفعيل المورد كعميل");
  if (!data) throw new Error("تعذر تفعيل المورد كعميل");
  return String(data);
}

export async function ensureSupplierForCustomer(
  supabase: SupabaseClient,
  customerId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_supplier_for_customer", {
    p_customer_id: customerId,
  });
  if (error) throw new Error(error.message || "تعذر تفعيل العميل كمورد");
  if (!data) throw new Error("تعذر تفعيل العميل كمورد");
  return String(data);
}

export type SettleNettingResult = {
  offset: number;
  customer_id: string;
  supplier_id: string;
  settlement_group_id: string;
  customer_payment_id: string;
  supplier_payment_id: string;
  customer_balance_after: number;
  supplier_balance_after: number;
};

export async function settlePartyNetting(
  supabase: SupabaseClient,
  params: { customerId?: string | null; supplierId?: string | null }
): Promise<SettleNettingResult> {
  const { data, error } = await supabase.rpc("settle_party_netting", {
    p_customer_id: params.customerId || null,
    p_supplier_id: params.supplierId || null,
  });
  if (error) throw new Error(error.message || "تعذر إجراء المقاصة");
  const row = data as SettleNettingResult;
  if (!row?.offset) throw new Error("تعذر إجراء المقاصة");
  return row;
}

export async function deletePartySettlement(
  supabase: SupabaseClient,
  paymentId: string
): Promise<void> {
  const { error } = await supabase.rpc("delete_party_settlement", {
    p_payment_id: paymentId,
  });
  if (error) throw new Error(error.message || "تعذر حذف المقاصة");
}

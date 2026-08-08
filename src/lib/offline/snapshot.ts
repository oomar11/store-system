import type { SupabaseClient } from "@supabase/supabase-js";
import { isLowStockAlert } from "@/lib/low-stock";
import {
  getOfflineDb,
  listActiveEntities,
  putEntity,
  setMeta,
} from "@/lib/offline/db";
import { getDeviceState } from "@/lib/offline/device";
import type {
  SnapshotBundle,
  SnapshotInvoiceStats,
  SnapshotParty,
  SnapshotProduct,
  SnapshotRecentInvoice,
  SnapshotSafe,
  SnapshotTierPricing,
} from "@/lib/offline/types";
import {
  buildTierCategoryDiscountMap,
  buildTierPriceMap,
  buildTierProductDiscountMap,
  type TierPricingContext,
} from "@/lib/price-tiers";

function localYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildInvoiceStats(
  invoices: Array<{ total: number | null; created_at: string }>
): SnapshotInvoiceStats {
  const todayKey = localYmd(new Date());
  const todayInvoices = invoices.filter(
    (invoice) => localYmd(new Date(invoice.created_at)) === todayKey
  );
  const todayRevenue = todayInvoices.reduce(
    (sum, invoice) => sum + (Number(invoice.total) || 0),
    0
  );
  const weeklySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = localYmd(date);
    const value = invoices
      .filter((invoice) => localYmd(new Date(invoice.created_at)) === key)
      .reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0);

    return {
      key,
      label: new Intl.DateTimeFormat("ar-EG", {
        weekday: "short",
      }).format(date),
      value,
    };
  });

  return {
    todayKey,
    todayCount: todayInvoices.length,
    todayRevenue,
    weeklySales,
  };
}

/** Build compat SnapshotBundle from normalized Dexie stores */
export async function rebuildCompatSnapshot(): Promise<SnapshotBundle> {
  const productsRaw = await listActiveEntities("products");
  const customersRaw = await listActiveEntities("customers");
  const suppliersRaw = await listActiveEntities("suppliers");
  const safesRaw = await listActiveEntities("safes");
  const settingsRows = await listActiveEntities("settings");
  const invoicesRaw = await listActiveEntities("invoices");
  const tiersRaw = await listActiveEntities("price_tiers");
  const tierPricesRaw = await listActiveEntities("product_tier_prices");
  const tierCatRaw = await listActiveEntities("tier_category_discounts");
  const tierProdRaw = await listActiveEntities("tier_product_discounts");

  const products: SnapshotProduct[] = productsRaw.map((p) => ({
    id: String(p.id),
    name: String(p.name || ""),
    sku: (p.sku as string | null) ?? null,
    quantity: Number(p.quantity) || 0,
    buy_price: Number(p.buy_price) || 0,
    sell_price: Number(p.sell_price) || 0,
    unit: (p.unit as string | null) ?? null,
    category_id: (p.category_id as string | null) ?? null,
    is_active: p.is_active !== false,
    pack_size: (p.pack_size as number | null) ?? null,
    notify_low_stock: (p.notify_low_stock as boolean | null) ?? null,
    min_quantity: (p.min_quantity as number | null) ?? null,
  }));

  const tierMetaById = new Map(
    tiersRaw.map((t) => [
      String(t.id),
      {
        id: String(t.id),
        name: String(t.name || ""),
        is_default: t.is_default === true,
      },
    ])
  );

  const customers: SnapshotParty[] = customersRaw.map((c) => {
    const priceTierId = (c.price_tier_id as string | null) ?? null;
    const priceTier = priceTierId
      ? tierMetaById.get(priceTierId) ?? null
      : null;
    return {
      id: String(c.id),
      name: String(c.name || ""),
      phone: (c.phone as string | null) ?? null,
      balance: Number(c.balance) || 0,
      kind: "customer" as const,
      price_tier_id: priceTierId,
      price_tier: priceTier,
      linked_supplier_id: (c.linked_supplier_id as string | null) ?? null,
      is_active: c.is_active !== false,
      last_activity_at: (c.last_activity_at as string | null) ?? null,
    };
  });

  const suppliers: SnapshotParty[] = suppliersRaw.map((s) => ({
    id: String(s.id),
    name: String(s.name || ""),
    phone: (s.phone as string | null) ?? null,
    balance: Number(s.balance) || 0,
    kind: "supplier" as const,
    linked_customer_id: (s.linked_customer_id as string | null) ?? null,
    is_active: s.is_active !== false,
    last_activity_at: (s.last_activity_at as string | null) ?? null,
  }));

  const safes: SnapshotSafe[] = safesRaw.map((s) => ({
    id: String(s.id),
    name: String(s.name || ""),
    balance: Number(s.balance) || 0,
    is_active: s.is_active !== false,
    sort_order: (s.sort_order as number | null) ?? null,
  }));

  const completed = invoicesRaw
    .filter((i) => String(i.status || "") === "completed")
    .sort(
      (a, b) =>
        new Date(String(b.created_at)).getTime() -
        new Date(String(a.created_at)).getTime()
    );

  const recentInvoices: SnapshotRecentInvoice[] = completed.slice(0, 50).map((row) => ({
    id: String(row.id),
    invoice_number: String(row.invoice_number || ""),
    type: String(row.type || "sale"),
    status: String(row.status || "completed"),
    total: Number(row.total) || 0,
    paid_amount: Number(row.paid_amount) || 0,
    created_at: String(row.created_at),
    customer_id: (row.customer_id as string | null) ?? null,
    supplier_id: (row.supplier_id as string | null) ?? null,
    customer_name:
      customers.find((c) => c.id === row.customer_id)?.name ?? null,
    supplier_name:
      suppliers.find((s) => s.id === row.supplier_id)?.name ?? null,
    payment_method: (row.payment_method as string | null) ?? null,
  }));

  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekSales = completed
    .filter(
      (i) =>
        String(i.type) === "sale" &&
        new Date(String(i.created_at)) >= weekStart
    )
    .map((i) => ({
      total: Number(i.total) || 0,
      created_at: String(i.created_at),
    }));

  let tierPricing: SnapshotTierPricing | null = null;
  if (tiersRaw.length || tierPricesRaw.length) {
    tierPricing = {
      tiers: tiersRaw.map((t) => ({
        id: String(t.id),
        name: String(t.name || ""),
        is_default: t.is_default === true,
      })),
      tierPrices: tierPricesRaw.map((r) => ({
        product_id: String(r.product_id),
        tier_id: String(r.tier_id),
        sell_price: Number(r.sell_price) || 0,
      })),
      categoryDiscounts: tierCatRaw.map((r) => ({
        tier_id: String(r.tier_id),
        category_id: String(r.category_id),
        discount_percent: Number(r.discount_percent) || 0,
      })),
      productDiscounts: tierProdRaw.map((r) => ({
        tier_id: String(r.tier_id),
        product_id: String(r.product_id),
        discount_percent: Number(r.discount_percent) || 0,
      })),
      defaultTierIds: tiersRaw
        .filter((t) => t.is_default)
        .map((t) => String(t.id)),
    };
  }

  const bundle: SnapshotBundle = {
    id: "main",
    products,
    customers,
    suppliers,
    safes,
    settings: (settingsRows[0] as Record<string, unknown>) || null,
    recentInvoices,
    invoiceStats: buildInvoiceStats(weekSales),
    tierPricing,
    pulled_at: new Date().toISOString(),
  };

  await getOfflineDb().snapshots.put(bundle);
  await setMeta("last_snapshot_at", bundle.pulled_at);
  return bundle;
}

export async function getSnapshot(): Promise<SnapshotBundle | null> {
  if (typeof window === "undefined") return null;
  const row = (await getOfflineDb().snapshots.get("main")) ?? null;
  if (row) {
    return {
      ...row,
      recentInvoices: row.recentInvoices || [],
      invoiceStats: row.invoiceStats || null,
      tierPricing: row.tierPricing ?? null,
    };
  }
  // Try rebuild from entity stores
  const products = await listActiveEntities("products");
  if (!products.length) return null;
  return rebuildCompatSnapshot();
}

export function tierPricingFromSnapshot(
  snap: SnapshotBundle | null | undefined
): TierPricingContext {
  const raw = snap?.tierPricing;
  if (!raw) return {};
  return {
    tierPrices: buildTierPriceMap(raw.tierPrices || []),
    categoryDiscounts: buildTierCategoryDiscountMap(raw.categoryDiscounts || []),
    productDiscounts: buildTierProductDiscountMap(raw.productDiscounts || []),
    defaultTierIds: new Set(raw.defaultTierIds || []),
  };
}

/** Bootstrap (first install) or incremental sync, then return local snapshot.
 * Prefer OfflineProvider.runSync / scheduleBackgroundSync for routine refresh —
 * this is for callers that must await a fresh local bundle (e.g. dashboard warm).
 */
export async function pullSnapshot(
  supabase: SupabaseClient
): Promise<SnapshotBundle> {
  const state = await getDeviceState();
  const { bootstrapLocalData, syncOutbox } = await import("@/lib/offline/sync");
  if (!state?.bootstrapped_at) {
    await bootstrapLocalData(supabase);
  } else {
    await syncOutbox(supabase);
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();
      if (profile) {
        const { saveCachedProfile } = await import("@/lib/offline/auth-session");
        await saveCachedProfile(profile as import("@/types").Profile);
      }
    }
  } catch {
    /* profile cache best-effort */
  }

  // syncOutbox / bootstrap already rebuild; only rebuild if snapshot missing
  return (await getSnapshot()) || (await rebuildCompatSnapshot())!;
}

export function dashboardFromSnapshot(snap: SnapshotBundle): {
  totalProducts: number;
  totalCustomers: number;
  totalSafes: number;
  lowStockCount: number;
  totalSalesToday: number;
  totalRevenue: number;
  weeklySales: Array<{ label: string; value: number }>;
  recentInvoices: Array<{
    id: string;
    invoice_number: string;
    total: number;
    created_at: string;
    customer: { name: string } | null;
  }>;
} {
  const activeProducts = snap.products.filter((p) => p.is_active !== false);
  const lowStockCount = activeProducts.filter((p) =>
    isLowStockAlert(p.quantity, p.min_quantity ?? 0, p.notify_low_stock)
  ).length;

  const stats = snap.invoiceStats;
  const recent = (snap.recentInvoices || [])
    .filter((inv) => inv.type === "sale")
    .slice(0, 5)
    .map((inv) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      total: inv.total,
      created_at: inv.created_at,
      customer: inv.customer_name ? { name: inv.customer_name } : null,
    }));

  return {
    totalProducts: activeProducts.length,
    totalCustomers: snap.customers.filter((c) => c.is_active !== false).length,
    totalSafes: snap.safes.filter((s) => s.is_active).length,
    lowStockCount,
    totalSalesToday: stats?.todayCount ?? 0,
    totalRevenue: stats?.todayRevenue ?? 0,
    weeklySales: (stats?.weeklySales || []).map((d) => ({
      label: d.label,
      value: d.value,
    })),
    recentInvoices: recent,
  };
}

export async function applyOptimisticInvoiceToSnapshot(input: {
  type: "sale" | "purchase" | "sale_return" | "purchase_return";
  items: Array<{ product_id: string; quantity: number }>;
  customerId?: string | null;
  supplierId?: string | null;
  remaining: number;
  paidAmount: number;
  safeId?: string | null;
}): Promise<void> {
  const stockDir =
    input.type === "sale" || input.type === "purchase_return" ? -1 : 1;
  const balanceSign =
    input.type === "sale" || input.type === "purchase" ? 1 : -1;

  for (const line of input.items) {
    const products = await listActiveEntities("products");
    const p = products.find((x) => x.id === line.product_id);
    if (!p) continue;
    await putEntity("products", {
      ...p,
      quantity: Number(p.quantity) + stockDir * Number(line.quantity),
    });
  }

  if (input.remaining > 0 && input.customerId) {
    const customers = await listActiveEntities("customers");
    const c = customers.find((x) => x.id === input.customerId);
    if (c) {
      await putEntity("customers", {
        ...c,
        balance: Number(c.balance) + balanceSign * input.remaining,
      });
    }
  }
  if (input.remaining > 0 && input.supplierId) {
    const suppliers = await listActiveEntities("suppliers");
    const s = suppliers.find((x) => x.id === input.supplierId);
    if (s) {
      await putEntity("suppliers", {
        ...s,
        balance: Number(s.balance) + balanceSign * input.remaining,
      });
    }
  }
  if (input.paidAmount > 0 && input.safeId) {
    const safes = await listActiveEntities("safes");
    const s = safes.find((x) => x.id === input.safeId);
    if (s) {
      const safeDelta =
        input.type === "sale" || input.type === "purchase_return"
          ? input.paidAmount
          : -input.paidAmount;
      await putEntity("safes", {
        ...s,
        balance: Number(s.balance) + safeDelta,
      });
    }
  }
  await rebuildCompatSnapshot();
}

export async function applyOptimisticPartyPaymentToSnapshot(input: {
  kind: "customer" | "supplier";
  partyId: string;
  amount: number;
  safeId: string;
}): Promise<void> {
  const amount = Number(input.amount) || 0;
  if (amount === 0) return;

  if (input.kind === "customer") {
    const customers = await listActiveEntities("customers");
    const c = customers.find((x) => x.id === input.partyId);
    if (c) {
      await putEntity("customers", {
        ...c,
        balance: Number(c.balance) - amount,
      });
    }
  } else {
    const suppliers = await listActiveEntities("suppliers");
    const s = suppliers.find((x) => x.id === input.partyId);
    if (s) {
      await putEntity("suppliers", {
        ...s,
        balance: Number(s.balance) - amount,
      });
    }
  }

  const safes = await listActiveEntities("safes");
  const safe = safes.find((x) => x.id === input.safeId);
  if (safe) {
    const safeDelta = input.kind === "customer" ? amount : -amount;
    await putEntity("safes", {
      ...safe,
      balance: Number(safe.balance) + safeDelta,
    });
  }
  await rebuildCompatSnapshot();
}

export async function applyOptimisticExpenseToSnapshot(input: {
  amount: number;
  safeId: string;
}): Promise<void> {
  const amount = Number(input.amount) || 0;
  if (amount === 0 || !input.safeId) return;
  const safes = await listActiveEntities("safes");
  const s = safes.find((x) => x.id === input.safeId);
  if (s) {
    await putEntity("safes", {
      ...s,
      balance: Number(s.balance) - amount,
    });
  }
  await rebuildCompatSnapshot();
}

export async function revertOptimisticInvoiceFromSnapshot(input: {
  type: "sale" | "purchase" | "sale_return" | "purchase_return";
  items: Array<{ product_id: string; quantity: number }>;
  customerId?: string | null;
  supplierId?: string | null;
  remaining: number;
  paidAmount: number;
  safeId?: string | null;
}): Promise<void> {
  await applyOptimisticInvoiceToSnapshot({
    ...input,
    type:
      input.type === "sale"
        ? "sale_return"
        : input.type === "sale_return"
          ? "sale"
          : input.type === "purchase"
            ? "purchase_return"
            : "purchase",
  });
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit";
import { notifyLowStockChanged } from "@/lib/inventory";

export type ActiveEntityTable =
  | "products"
  | "customers"
  | "suppliers"
  | "safes";

const ENTITY_TYPE: Record<ActiveEntityTable, string> = {
  products: "product",
  customers: "customer",
  suppliers: "supplier",
  safes: "safe",
};

/** تفعيل أو إيقاف مجموعة عناصر دفعة واحدة */
export async function setEntitiesActive(
  supabase: SupabaseClient,
  table: ActiveEntityTable,
  ids: string[],
  active: boolean,
  labels?: Record<string, string>
): Promise<{ error: string | null; updated: number }> {
  if (ids.length === 0) return { error: null, updated: 0 };

  const { error } = await supabase
    .from(table)
    .update({ is_active: active })
    .in("id", ids);

  if (error) {
    return { error: error.message, updated: 0 };
  }

  const action = `${ENTITY_TYPE[table]}.${active ? "activate" : "deactivate"}`;
  await Promise.all(
    ids.map((id) =>
      logAuditEvent(supabase, {
        action,
        entityType: ENTITY_TYPE[table],
        entityId: id,
        entityLabel: labels?.[id] || id,
        after: { is_active: active },
        source: "app",
      })
    )
  );

  if (table === "products") {
    notifyLowStockChanged();
  }

  // Keep local Dexie in sync when repos are available
  try {
    const offline = await import("@/lib/offline");
    const repo =
      table === "products"
        ? offline.productsRepo
        : table === "customers"
          ? offline.customersRepo
          : table === "suppliers"
            ? offline.suppliersRepo
            : offline.safesRepo;
    for (const id of ids) {
      const row = await repo.get(id);
      if (row) {
        await repo.save({ ...row, is_active: active });
      }
    }
  } catch {
    /* offline sync best-effort */
  }

  return { error: null, updated: ids.length };
}

/** تفعيل/إيقاف إشعارات النواقص لعدة أصناف */
export async function setProductsLowStockNotify(
  supabase: SupabaseClient,
  ids: string[],
  notify: boolean
): Promise<{ error: string | null; updated: number }> {
  if (ids.length === 0) return { error: null, updated: 0 };

  const { error } = await supabase
    .from("products")
    .update({ notify_low_stock: notify })
    .in("id", ids);

  if (error) {
    return { error: error.message, updated: 0 };
  }

  notifyLowStockChanged();

  try {
    const { productsRepo } = await import("@/lib/offline");
    for (const id of ids) {
      const row = await productsRepo.get(id);
      if (row) {
        await productsRepo.save({ ...row, notify_low_stock: notify });
      }
    }
  } catch {
    /* offline sync best-effort */
  }

  return { error: null, updated: ids.length };
}

/** Consistent ordering for safe dropdowns across the app. */
export const SAFES_ORDER_COLUMNS = "sort_order" as const;

export function safesOrderQuery<
  T extends { order: (column: string, options?: { ascending?: boolean }) => T },
>(query: T): T {
  return query.order("sort_order", { ascending: true }).order("name", {
    ascending: true,
  });
}

type SafeLike = {
  id: string;
  name: string;
  is_active?: boolean;
  balance?: number;
  sort_order?: number | null;
};

/**
 * Active safes only, unique by id (and by name for stale offline ghosts),
 * sorted by sort_order then Arabic name.
 */
export function normalizeActiveSafes<T extends SafeLike>(
  rows: T[] | null | undefined
): T[] {
  const byId = new Map<string, T>();
  for (const row of rows || []) {
    if (!row?.id) continue;
    if (row.is_active === false) continue;
    byId.set(String(row.id), row);
  }

  // Collapse sync ghosts that kept the same display name under a dead id.
  const byName = new Map<string, T>();
  for (const row of byId.values()) {
    const key = String(row.name || "")
      .trim()
      .toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, row);
      continue;
    }
    const prevBal = Math.abs(Number(prev.balance) || 0);
    const nextBal = Math.abs(Number(row.balance) || 0);
    if (nextBal >= prevBal) byName.set(key, row);
  }

  return Array.from(byName.values()).sort((a, b) => {
    const ao = a.sort_order ?? 9999;
    const bo = b.sort_order ?? 9999;
    if (ao !== bo) return ao - bo;
    return String(a.name).localeCompare(String(b.name), "ar");
  });
}

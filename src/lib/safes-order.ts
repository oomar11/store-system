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

/** Normalize Arabic/English safe names for ghost dedupe. */
export function normalizeSafeNameKey(name: string): string {
  return String(name || "")
    .trim()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // harakat + tatweel
    .replace(/\s+/g, " ")
    .toLowerCase();
}

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
    // Treat only explicit false as inactive; missing means active for older rows.
    if (row.is_active === false) continue;
    // Soft-deleted rows from local-first sync must not appear in pickers.
    const deletedAt = (row as { deleted_at?: string | null }).deleted_at;
    if (deletedAt) continue;
    byId.set(String(row.id), row);
  }

  // Collapse sync ghosts that kept the same display name under a dead id.
  // Prefer the newest row (updated_at/created_at) — NOT higher balance —
  // because offline ghosts often keep a stale inflated balance.
  const byName = new Map<string, T>();
  for (const row of byId.values()) {
    const key = normalizeSafeNameKey(row.name);
    if (!key) {
      byName.set(`__id:${row.id}`, row);
      continue;
    }
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, row);
      continue;
    }
    const prevTs =
      Date.parse(
        String(
          (prev as { updated_at?: string; created_at?: string }).updated_at ||
            (prev as { created_at?: string }).created_at ||
            ""
        )
      ) || 0;
    const nextTs =
      Date.parse(
        String(
          (row as { updated_at?: string; created_at?: string }).updated_at ||
            (row as { created_at?: string }).created_at ||
            ""
        )
      ) || 0;
    if (nextTs > prevTs) {
      byName.set(key, row);
      continue;
    }
    if (
      nextTs === prevTs &&
      row.is_active === true &&
      prev.is_active !== true
    ) {
      byName.set(key, row);
    }
  }

  return Array.from(byName.values()).sort((a, b) => {
    const ao = a.sort_order ?? 9999;
    const bo = b.sort_order ?? 9999;
    if (ao !== bo) return ao - bo;
    return String(a.name).localeCompare(String(b.name), "ar");
  });
}

/**
 * Keep from/to safe picks aligned with the current active list.
 * Drops stale offline/ghost ids that no longer exist after a refresh,
 * and ensures transfer never keeps the same vault in both sides.
 */
export function resolveTransferSafeIds(
  safes: { id: string }[],
  fromId?: string | null,
  toId?: string | null
): { fromId: string; toId: string } {
  const ids = safes.map((s) => String(s.id)).filter(Boolean);
  const from =
    fromId && ids.includes(String(fromId)) ? String(fromId) : ids[0] || "";
  const destinations = ids.filter((id) => id !== from);
  const to =
    toId && destinations.includes(String(toId))
      ? String(toId)
      : destinations[0] || "";
  return { fromId: from, toId: to };
}

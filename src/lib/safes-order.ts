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
  deleted_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type NormalizeActiveSafesOptions = {
  /**
   * Collapse duplicate display names (offline ghosts).
   * Keep OFF for authoritative server lists so every real vault stays selectable.
   */
  dedupeByName?: boolean;
  /** When true, keep rows with is_active === false (for clearer transfer errors). */
  includeInactive?: boolean;
};

/** Normalize Arabic/English safe names for ghost dedupe / fuzzy match. */
export function normalizeSafeNameKey(name: string): string {
  return String(name || "")
    .trim()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // harakat + tatweel
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function rowTimestamp(row: {
  updated_at?: string | null;
  created_at?: string | null;
}): number {
  return (
    Date.parse(String(row.updated_at || row.created_at || "")) || 0
  );
}

/**
 * Active safes only, unique by id (optionally by name for stale offline ghosts),
 * sorted by sort_order then Arabic name.
 */
export function normalizeActiveSafes<T extends SafeLike>(
  rows: T[] | null | undefined,
  options?: NormalizeActiveSafesOptions
): T[] {
  const dedupeByName = options?.dedupeByName === true;
  const includeInactive = options?.includeInactive === true;
  const byId = new Map<string, T>();
  for (const row of rows || []) {
    if (!row?.id) continue;
    // Treat only explicit false as inactive; missing means active for older rows.
    if (!includeInactive && row.is_active === false) continue;
    // Soft-deleted rows from local-first sync must not appear in pickers.
    if (row.deleted_at) continue;
    byId.set(String(row.id), row);
  }

  let list = Array.from(byId.values());

  // Only collapse names for dirty offline snapshots. Server lists must keep
  // every distinct id — otherwise some vaults become unselectable/untransferable.
  if (dedupeByName) {
    const byName = new Map<string, T>();
    for (const row of list) {
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
      const prevTs = rowTimestamp(prev);
      const nextTs = rowTimestamp(row);
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
    list = Array.from(byName.values());
  }

  return list.sort((a, b) => {
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

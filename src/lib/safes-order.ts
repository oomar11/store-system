/** Consistent ordering for safe dropdowns across the app. */
export const SAFES_ORDER_COLUMNS = "sort_order" as const;

export function safesOrderQuery<
  T extends { order: (column: string, options?: { ascending?: boolean }) => T },
>(query: T): T {
  return query.order("sort_order", { ascending: true }).order("name", {
    ascending: true,
  });
}

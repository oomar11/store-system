/** Shared helpers for copying invoices/documents into a new POS cart. */

export type PosMode = "sale" | "quote" | "purchase" | "purchase_order";

export type PosCopySourceKind = "invoice" | "document";

export function parsePosMode(value: string | null | undefined): PosMode {
  if (value === "quote") return "quote";
  if (value === "purchase") return "purchase";
  if (value === "purchase_order") return "purchase_order";
  return "sale";
}

export function modeToPosUrl(mode: PosMode, base = "/pos"): string {
  return mode === "sale" ? base : `${base}?mode=${mode}`;
}

/** True when `pathname` is the desktop or embedded POS route (not `/possess` etc.). */
export function isPosPathname(pathname: string, embedded = false): boolean {
  const base = embedded ? "/m/pos" : "/pos";
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Build URL that opens POS with a prefilled cart from an existing doc/invoice. */
export function posCopyUrl(
  sourceId: string,
  as: PosMode,
  options?: { base?: string; sourceKind?: PosCopySourceKind }
): string {
  const base = options?.base ?? "/pos";
  const params = new URLSearchParams();
  if (as !== "sale") params.set("mode", as);
  params.set("copyFrom", sourceId);
  if (options?.sourceKind === "document") params.set("copyKind", "document");
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function isSellSideMode(mode: PosMode): boolean {
  return mode === "sale" || mode === "quote";
}

export function isPurchaseSideMode(mode: PosMode): boolean {
  return mode === "purchase" || mode === "purchase_order";
}

/** Same commercial side (customer vs supplier) — keep party when copying. */
export function samePartySide(from: PosMode, to: PosMode): boolean {
  return isSellSideMode(from) === isSellSideMode(to);
}

export function copyAsLabel(as: PosMode): string {
  switch (as) {
    case "sale":
      return "نسخ كمبيعات";
    case "purchase":
      return "نسخ كمشتريات";
    case "quote":
      return "نسخ كعرض سعر";
    case "purchase_order":
      return "نسخ كأمر شراء";
  }
}

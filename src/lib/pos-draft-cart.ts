/** Auto-saved POS cart draft (per user + mode), expires after 24 hours. */

import type { HeldCartSnapshot, HeldCartLine } from "@/lib/pos-held-carts";

export const POS_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type PosDraftCart = {
  id: "draft";
  label: string;
  mode: string;
  /** When the draft was last written — used for 24h expiry. */
  savedAt: string;
  createdAt: string;
  lines: HeldCartLine[];
  customerId?: string | null;
  supplierId?: string | null;
  paymentMethod?: "cash" | "credit";
  paidAmount?: number;
  discount?: number;
  discountType?: "amount" | "percent";
  notes?: string;
  safeId?: string;
  validUntil?: string;
  expectedDate?: string;
  purchasePriceBasis?: "buy" | "sell";
  /** Active price tier for this draft (null/omit = retail). */
  priceTierId?: string | null;
};

function storageKey(userId: string | null | undefined, mode: string): string {
  const uid = userId || "anon";
  return `windoor-pos-draft:${uid}:${mode}`;
}

function isExpired(savedAt: string, now = Date.now()): boolean {
  const t = Date.parse(savedAt);
  if (!Number.isFinite(t)) return true;
  return now - t > POS_DRAFT_TTL_MS;
}

export function loadPosDraft(
  userId: string | null | undefined,
  mode: string
): PosDraftCart | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(userId, mode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PosDraftCart;
    if (!parsed || parsed.id !== "draft" || !Array.isArray(parsed.lines)) {
      clearPosDraft(userId, mode);
      return null;
    }
    const savedAt = parsed.savedAt || parsed.createdAt;
    if (!savedAt || isExpired(savedAt)) {
      clearPosDraft(userId, mode);
      return null;
    }
    if (parsed.lines.length === 0) {
      clearPosDraft(userId, mode);
      return null;
    }
    return { ...parsed, savedAt };
  } catch {
    clearPosDraft(userId, mode);
    return null;
  }
}

export function savePosDraft(
  userId: string | null | undefined,
  mode: string,
  snapshot: Omit<PosDraftCart, "id" | "savedAt" | "createdAt" | "mode" | "label"> & {
    label?: string;
  }
): PosDraftCart | null {
  if (typeof window === "undefined") return null;
  if (!snapshot.lines.length) {
    clearPosDraft(userId, mode);
    return null;
  }
  const now = new Date().toISOString();
  const draft: PosDraftCart = {
    id: "draft",
    label: snapshot.label?.trim() || "مسودة تلقائية",
    mode,
    savedAt: now,
    createdAt: now,
    lines: snapshot.lines,
    customerId: snapshot.customerId ?? null,
    supplierId: snapshot.supplierId ?? null,
    paymentMethod: snapshot.paymentMethod,
    paidAmount: snapshot.paidAmount,
    discount: snapshot.discount,
    discountType: snapshot.discountType,
    notes: snapshot.notes,
    safeId: snapshot.safeId,
    validUntil: snapshot.validUntil,
    expectedDate: snapshot.expectedDate,
    purchasePriceBasis: snapshot.purchasePriceBasis,
  };
  localStorage.setItem(storageKey(userId, mode), JSON.stringify(draft));
  return draft;
}

export function clearPosDraft(
  userId: string | null | undefined,
  mode: string
): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(storageKey(userId, mode));
}

/** Build the same line payload used by held carts / draft restore. */
export function cartLinesForDraft(
  cart: Array<{
    product: { id: string; name: string };
    quantity: number;
    unit_price: number;
    discount: number;
    total: number;
  }>
): HeldCartLine[] {
  return cart.map((item) => ({
    productId: item.product.id,
    quantity: item.quantity,
    unit_price: item.unit_price,
    discount: item.discount,
    total: item.total,
    productName: item.product.name,
  }));
}

export function draftToHeldShape(draft: PosDraftCart): HeldCartSnapshot {
  return {
    id: draft.id,
    label: draft.label,
    mode: draft.mode,
    createdAt: draft.createdAt,
    lines: draft.lines,
    customerId: draft.customerId,
    supplierId: draft.supplierId,
    paymentMethod: draft.paymentMethod,
    paidAmount: draft.paidAmount,
    discount: draft.discount,
    discountType: draft.discountType,
    notes: draft.notes,
    safeId: draft.safeId,
    validUntil: draft.validUntil,
    expectedDate: draft.expectedDate,
  };
}

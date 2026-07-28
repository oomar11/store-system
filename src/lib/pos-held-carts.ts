/** Persist held POS carts in localStorage (per user + mode). */

export type HeldCartLine = {
  productId: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  productName?: string;
};

export type HeldCartSnapshot = {
  id: string;
  label: string;
  mode: string;
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
};

const MAX_HELD = 12;

function storageKey(userId: string | null | undefined, mode: string): string {
  const uid = userId || "anon";
  return `windoor-held-carts:${uid}:${mode}`;
}

export function loadHeldCarts(
  userId: string | null | undefined,
  mode: string
): HeldCartSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(userId, mode));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HeldCartSnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHeldCarts(
  userId: string | null | undefined,
  mode: string,
  carts: HeldCartSnapshot[]
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(userId, mode), JSON.stringify(carts));
}

export function addHeldCart(
  userId: string | null | undefined,
  mode: string,
  snapshot: Omit<HeldCartSnapshot, "id" | "createdAt" | "mode"> & {
    id?: string;
    createdAt?: string;
  }
): HeldCartSnapshot {
  const list = loadHeldCarts(userId, mode);
  const held: HeldCartSnapshot = {
    id: snapshot.id || crypto.randomUUID(),
    label: snapshot.label.trim() || `حجز ${list.length + 1}`,
    mode,
    createdAt: snapshot.createdAt || new Date().toISOString(),
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
  };
  const next = [held, ...list].slice(0, MAX_HELD);
  saveHeldCarts(userId, mode, next);
  return held;
}

export function removeHeldCart(
  userId: string | null | undefined,
  mode: string,
  heldId: string
): HeldCartSnapshot[] {
  const next = loadHeldCarts(userId, mode).filter((c) => c.id !== heldId);
  saveHeldCarts(userId, mode, next);
  return next;
}

export function heldCartItemCount(held: HeldCartSnapshot): number {
  return held.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}

export function heldCartTotal(held: HeldCartSnapshot): number {
  return held.lines.reduce((s, l) => s + (Number(l.total) || 0), 0);
}

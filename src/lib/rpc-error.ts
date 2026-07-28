/**
 * Normalize Postgres/PostgREST RPC error messages for the UI.
 * Some historical migrations stored Arabic RAISE text as `????` when applied
 * with a non-UTF8 client; map known patterns back to readable Arabic.
 */
export function formatRpcError(
  raw: unknown,
  fallback = "تعذر إتمام العملية"
): string {
  const message =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : fallback;

  const trimmed = message.trim();
  if (!trimmed) return fallback;

  // Corrupted UTF-8 Arabic that became question marks (each Arabic letter → ??)
  // "رصيد الخزنة غير كافٍ لإتمام العملية" → 8,12,6,8,12,14
  if (/^[?\s.]+$/.test(trimmed)) {
    const lengths = trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/\.+$/, "").length);
    if (lengths.join(",") === "8,12,6,8,12,14") {
      return "رصيد الخزنة غير كافٍ لإتمام العملية";
    }
    // Fallback for other fully-garbled Arabic exceptions
    return "تعذر إتمام العملية — راجع رصيد الخزنة أو الصلاحيات ثم أعد المحاولة";
  }

  return trimmed;
}

/** Clear purchase/sale cash message when safe balance is too low. */
export function insufficientSafeBalanceMessage(
  balance: number,
  needed: number
): string {
  const bal = Number(balance) || 0;
  const need = Number(needed) || 0;
  return `رصيد الخزنة غير كافٍ (المتاح ${bal.toFixed(2)} — المطلوب ${need.toFixed(2)}). أودع في الخزنة أو اختر الدفع الآجل.`;
}

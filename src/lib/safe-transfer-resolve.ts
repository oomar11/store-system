/** Pure helpers for resolving transfer safe ids (unit-tested). */

export function sameSafeId(a: string, b: string): boolean {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Normalize Arabic/English safe names for fuzzy recovery of stale ids. */
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

/**
 * Loose match for vault labels used in the wild:
 * «المحل» ↔ «خزنة المحل», «الرئيسيه» ↔ «الخزنه الرئيسيه».
 */
export function safeNamesLooselyMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const ka = normalizeSafeNameKey(a || "");
  const kb = normalizeSafeNameKey(b || "");
  if (!ka || !kb) return false;
  if (ka === kb) return true;

  const stripVaultPrefix = (k: string) =>
    k.replace(/^الخزنه\s+/, "").replace(/^خزنه\s+/, "").trim();
  const sa = stripVaultPrefix(ka);
  const sb = stripVaultPrefix(kb);
  if (sa && sb && (sa === sb || sa === kb || sb === ka)) return true;

  // Containment only when the shorter meaningful token is long enough
  // to avoid matching everything on «خزنه».
  const shorter = sa.length <= sb.length ? sa : sb;
  const longer = sa.length <= sb.length ? sb : sa;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  return false;
}

export type TransferSafeRow = {
  id: string;
  name: string;
  is_active?: boolean;
  balance?: number;
  deleted_at?: string | null;
};

function rankLiveSafe(row: TransferSafeRow): number {
  let score = 0;
  if (!row.deleted_at) score += 2;
  if (row.is_active !== false) score += 1;
  return score;
}

function pickBestNameMatch(
  pool: TransferSafeRow[],
  preferredName?: string | null
): TransferSafeRow | null {
  const matches = pool.filter((s) =>
    safeNamesLooselyMatch(s.name, preferredName)
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => rankLiveSafe(b) - rankLiveSafe(a))[0] || null;
}

export function pickLiveSafe(
  live: TransferSafeRow[],
  preferredId: string,
  preferredName?: string | null,
  excludeId?: string | null
): TransferSafeRow | null {
  const pool = excludeId
    ? live.filter((s) => !sameSafeId(s.id, excludeId))
    : live;
  const id = String(preferredId || "").trim();
  const byId = id ? pool.find((s) => sameSafeId(s.id, id)) : undefined;

  // If an id hits but the provided label clearly names another vault,
  // prefer the name (fixes ghost ids that still exist as soft leftovers).
  if (byId) {
    if (
      !preferredName ||
      safeNamesLooselyMatch(byId.name, preferredName) ||
      !pickBestNameMatch(pool, preferredName)
    ) {
      return byId;
    }
  }

  return pickBestNameMatch(pool, preferredName);
}

/**
 * Resolve from/to vaults for a transfer.
 * Never collapses both sides onto the same live row via name fallback.
 * Recovers from empty/stale ids when safe names are provided (mobile select bugs).
 */
export function resolveTransferPair(
  live: TransferSafeRow[],
  params: {
    fromSafeId: string;
    toSafeId: string;
    fromSafeName?: string | null;
    toSafeName?: string | null;
  }
):
  | { ok: true; from: TransferSafeRow; to: TransferSafeRow }
  | { ok: false; error: string } {
  let rawFromId = String(params.fromSafeId || "").trim();
  let rawToId = String(params.toSafeId || "").trim();

  // Mobile controlled <select> can show a name while React state id is still "".
  if (!rawFromId && params.fromSafeName) {
    const guessed = pickLiveSafe(live, "", params.fromSafeName);
    if (guessed) rawFromId = guessed.id;
  }
  if (!rawToId && params.toSafeName) {
    const guessed = pickLiveSafe(
      live,
      "",
      params.toSafeName,
      rawFromId || null
    );
    if (guessed) rawToId = guessed.id;
  }

  if (!rawFromId || !rawToId) {
    return { ok: false, error: "اختر خزنتين مختلفتين للتحويل" };
  }
  if (sameSafeId(rawFromId, rawToId)) {
    return { ok: false, error: "اختر خزنتين مختلفتين للتحويل" };
  }

  let from = pickLiveSafe(live, rawFromId, params.fromSafeName);
  let to = pickLiveSafe(
    live,
    rawToId,
    params.toSafeName,
    from?.id || rawFromId
  );

  if (!from) {
    from = pickLiveSafe(
      live,
      rawFromId,
      params.fromSafeName,
      to?.id || rawToId
    );
  }
  if (!to) {
    to = pickLiveSafe(
      live,
      rawToId,
      params.toSafeName,
      from?.id || rawFromId
    );
  }

  if (!from) {
    return {
      ok: false,
      error: params.fromSafeName
        ? `الخزنة المصدر «${params.fromSafeName}» غير موجودة على السيرفر — حدّث الصفحة`
        : "الخزنة المصدر غير موجودة — حدّث الصفحة واختر الخزنة من جديد",
    };
  }
  if (!to) {
    return {
      ok: false,
      error: params.toSafeName
        ? `الخزنة الهدف «${params.toSafeName}» غير موجودة على السيرفر — حدّث الصفحة`
        : "الخزنة الهدف غير موجودة — حدّث الصفحة واختر الخزنة من جديد",
    };
  }
  if (sameSafeId(from.id, to.id)) {
    return {
      ok: false,
      error: `«${from.name}» و«${params.toSafeName || to.name}» يشيران لنفس الخزنة على السيرفر — حدّث الصفحة`,
    };
  }
  return { ok: true, from, to };
}

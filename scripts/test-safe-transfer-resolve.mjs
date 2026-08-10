/**
 * Reproduction tests for الخزنة الرئيسية ↔ خزنة المحل transfer resolution.
 * Run: node scripts/test-safe-transfer-resolve.mjs
 */
import assert from "node:assert/strict";

function sameSafeId(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function normalizeSafeNameKey(name) {
  return String(name || "")
    .trim()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function safeNamesLooselyMatch(a, b) {
  const ka = normalizeSafeNameKey(a || "");
  const kb = normalizeSafeNameKey(b || "");
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const stripVaultPrefix = (k) =>
    k.replace(/^الخزنه\s+/, "").replace(/^خزنه\s+/, "").trim();
  const sa = stripVaultPrefix(ka);
  const sb = stripVaultPrefix(kb);
  if (sa && sb && (sa === sb || sa === kb || sb === ka)) return true;
  const shorter = sa.length <= sb.length ? sa : sb;
  const longer = sa.length <= sb.length ? sb : sa;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  return false;
}

function rankLiveSafe(row) {
  let score = 0;
  if (!row.deleted_at) score += 2;
  if (row.is_active !== false) score += 1;
  return score;
}

function pickBestNameMatch(pool, preferredName) {
  const matches = pool.filter((s) =>
    safeNamesLooselyMatch(s.name, preferredName)
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => rankLiveSafe(b) - rankLiveSafe(a))[0] || null;
}

function pickLiveSafe(live, preferredId, preferredName, excludeId) {
  const pool = excludeId
    ? live.filter((s) => !sameSafeId(s.id, excludeId))
    : live;
  const id = String(preferredId || "").trim();
  const byId = id ? pool.find((s) => sameSafeId(s.id, id)) : undefined;
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

function resolveTransferPair(live, params) {
  let rawFromId = String(params.fromSafeId || "").trim();
  let rawToId = String(params.toSafeId || "").trim();

  if (!rawFromId && params.fromSafeName) {
    const guessed = pickLiveSafe(live, "", params.fromSafeName);
    if (guessed) rawFromId = guessed.id;
  }
  if (!rawToId && params.toSafeName) {
    const guessed = pickLiveSafe(live, "", params.toSafeName, rawFromId || null);
    if (guessed) rawToId = guessed.id;
  }

  if (!rawFromId || !rawToId) {
    return { ok: false, error: "اختر خزنتين مختلفتين للتحويل" };
  }
  if (sameSafeId(rawFromId, rawToId)) {
    return { ok: false, error: "اختر خزنتين مختلفتين للتحويل" };
  }

  let from = pickLiveSafe(live, rawFromId, params.fromSafeName);
  let to = pickLiveSafe(live, rawToId, params.toSafeName, from?.id || rawFromId);

  if (!from) {
    from = pickLiveSafe(live, rawFromId, params.fromSafeName, to?.id || rawToId);
  }
  if (!to) {
    to = pickLiveSafe(live, rawToId, params.toSafeName, from?.id || rawFromId);
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

const LIVE_MAIN = "11111111-1111-1111-1111-111111111111";
const LIVE_STORE = "22222222-2222-2222-2222-222222222222";
const GHOST_MAIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GHOST_STORE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const live = [
  {
    id: LIVE_MAIN,
    name: "الخزنة الرئيسية",
    is_active: true,
    balance: 5000,
    deleted_at: null,
  },
  {
    id: LIVE_STORE,
    name: "خزنة المحل",
    is_active: true,
    balance: 1200,
    deleted_at: null,
  },
];

let passed = 0;
function check(title, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${title}`);
  } catch (err) {
    console.error(`FAIL  ${title}`);
    console.error(`      ${err.message}`);
    process.exitCode = 1;
  }
}

check("names do not normalize to the same key", () => {
  const a = normalizeSafeNameKey("الخزنة الرئيسية");
  const b = normalizeSafeNameKey("خزنة المحل");
  assert.notEqual(a, b);
});

check("live ids resolve الرئيسية → خزنة المحل", () => {
  const r = resolveTransferPair(live, {
    fromSafeId: LIVE_MAIN,
    toSafeId: LIVE_STORE,
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
  });
  assert.equal(r.ok, true);
  assert.equal(r.from.id, LIVE_MAIN);
  assert.equal(r.to.id, LIVE_STORE);
});

check("live ids resolve خزنة المحل → الرئيسية", () => {
  const r = resolveTransferPair(live, {
    fromSafeId: LIVE_STORE,
    toSafeId: LIVE_MAIN,
    fromSafeName: "خزنة المحل",
    toSafeName: "الخزنة الرئيسية",
  });
  assert.equal(r.ok, true);
  assert.equal(r.from.id, LIVE_STORE);
  assert.equal(r.to.id, LIVE_MAIN);
});

check("ghost offline ids remap by name to live ids", () => {
  const r = resolveTransferPair(live, {
    fromSafeId: GHOST_MAIN,
    toSafeId: GHOST_STORE,
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
  });
  assert.equal(r.ok, true);
  assert.equal(r.from.id, LIVE_MAIN);
  assert.equal(r.to.id, LIVE_STORE);
});

check("soft-deleted خزنة المحل still resolves by name", () => {
  const withDeleted = [
    live[0],
    { ...live[1], deleted_at: "2026-08-01T00:00:00Z", is_active: false },
  ];
  const r = resolveTransferPair(withDeleted, {
    fromSafeId: GHOST_MAIN,
    toSafeId: GHOST_STORE,
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
  });
  assert.equal(r.ok, true);
  assert.equal(r.to.id, LIVE_STORE);
});

check("missing target name yields الهدف error (not silent same-id)", () => {
  const onlyMain = [live[0]];
  const r = resolveTransferPair(onlyMain, {
    fromSafeId: LIVE_MAIN,
    toSafeId: GHOST_STORE,
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /الخزنة الهدف/);
  assert.match(r.error, /خزنة المحل/);
});

check("FIX: empty toSafeId recovers from toSafeName خزنة المحل", () => {
  // Mobile select can show خزنة المحل while React state id is still "".
  const r = resolveTransferPair(live, {
    fromSafeId: LIVE_MAIN,
    toSafeId: "",
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
  });
  assert.equal(r.ok, true);
  assert.equal(r.from.id, LIVE_MAIN);
  assert.equal(r.to.id, LIVE_STORE);
});

check("BUG REPRO: filtered-select stale toId equal fromId is rejected", () => {
  const r = resolveTransferPair(live, {
    fromSafeId: LIVE_STORE,
    toSafeId: LIVE_STORE,
    fromSafeName: "خزنة المحل",
    toSafeName: "خزنة المحل",
  });
  assert.equal(r.ok, false);
});

// Simulate the OLD buggy client: pass ghost toId with NO name recovery.
check("OLD BUG: ghost toId without name recovery would hit RPC not-found", () => {
  const byIdOnly = live.find((s) => sameSafeId(s.id, GHOST_STORE));
  assert.equal(byIdOnly, undefined);
  // This is what production RPC sees when mobile sends a stale offline id.
});

check("loose name: المحل matches خزنة المحل", () => {
  const liveShort = [
    live[0],
    { ...live[1], name: "المحل" },
  ];
  const r = resolveTransferPair(liveShort, {
    fromSafeId: GHOST_MAIN,
    toSafeId: GHOST_STORE,
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
  });
  assert.equal(r.ok, true);
  assert.equal(r.to.id, LIVE_STORE);
});

check("ghost id that still exists but wrong name prefers label", () => {
  // Leftover soft row kept the ghost id under a junk label; UI still says خزنة المحل.
  const messy = [
    live[0],
    {
      id: GHOST_STORE,
      name: "offline-ghost",
      is_active: false,
      balance: 0,
      deleted_at: "2026-08-01T00:00:00Z",
    },
    live[1],
  ];
  const r = resolveTransferPair(messy, {
    fromSafeId: LIVE_MAIN,
    toSafeId: GHOST_STORE,
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
  });
  assert.equal(r.ok, true);
  assert.equal(r.to.id, LIVE_STORE);
});

console.log(`\n${passed} assertions passed`);
if (process.exitCode) {
  console.error("\nTransfer resolve tests FAILED");
  process.exit(1);
}
console.log("Transfer resolve tests OK");

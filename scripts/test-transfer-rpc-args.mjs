/**
 * Integration-style mock: transferBetweenSafes resolution → RPC args.
 * Simulates the phone bug: ghost/empty ids for الرئيسية ↔ خزنة المحل.
 * Run: node scripts/test-transfer-rpc-args.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Inline resolve (same as src/lib/safe-transfer-resolve) so the script stays
// runnable without a TS build step.
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
function pickLiveSafe(live, preferredId, preferredName, excludeId) {
  const pool = excludeId
    ? live.filter((s) => !sameSafeId(s.id, excludeId))
    : live;
  const id = String(preferredId || "").trim();
  if (id) {
    const byId = pool.find((s) => sameSafeId(s.id, id));
    if (byId) return byId;
  }
  const key = normalizeSafeNameKey(preferredName || "");
  if (!key) return null;
  const matches = pool.filter((s) => normalizeSafeNameKey(s.name) === key);
  return (
    matches.find((s) => !s.deleted_at && s.is_active !== false) ||
    matches.find((s) => !s.deleted_at) ||
    matches[0] ||
    null
  );
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
  if (!rawFromId || !rawToId || sameSafeId(rawFromId, rawToId)) {
    return { ok: false, error: "اختر خزنتين مختلفتين للتحويل" };
  }
  let from = pickLiveSafe(live, rawFromId, params.fromSafeName);
  let to = pickLiveSafe(live, rawToId, params.toSafeName, from?.id || rawFromId);
  if (!from) from = pickLiveSafe(live, rawFromId, params.fromSafeName, to?.id || rawToId);
  if (!to) to = pickLiveSafe(live, rawToId, params.toSafeName, from?.id || rawFromId);
  if (!from || !to || sameSafeId(from.id, to.id)) {
    return { ok: false, error: "الخزنة الهدف غير موجودة" };
  }
  return { ok: true, from, to };
}

const LIVE_MAIN = "11111111-1111-1111-1111-111111111111";
const LIVE_STORE = "22222222-2222-2222-2222-222222222222";
const GHOST_STORE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const live = [
  { id: LIVE_MAIN, name: "الخزنة الرئيسية", is_active: true, balance: 5000, deleted_at: null },
  { id: LIVE_STORE, name: "خزنة المحل", is_active: true, balance: 1200, deleted_at: null },
];

function simulateTransferRpc(params) {
  const resolved = resolveTransferPair(live, params);
  if (!resolved.ok) throw new Error(resolved.error);
  // What would be sent to transfer_between_safes
  return {
    p_from_safe_id: resolved.from.id,
    p_to_safe_id: resolved.to.id,
    p_amount: params.amount,
  };
}

console.log("=== Simulate phone transfer: الرئيسية → خزنة المحل ===");

// Case A: healthy ids
{
  const rpc = simulateTransferRpc({
    fromSafeId: LIVE_MAIN,
    toSafeId: LIVE_STORE,
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
    amount: 1,
  });
  assert.equal(rpc.p_from_safe_id, LIVE_MAIN);
  assert.equal(rpc.p_to_safe_id, LIVE_STORE);
  console.log("PASS healthy ids", rpc);
}

// Case B: THE BUG — ghost target id (offline) + correct names
{
  const rpc = simulateTransferRpc({
    fromSafeId: LIVE_MAIN,
    toSafeId: GHOST_STORE,
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
    amount: 1,
  });
  assert.equal(rpc.p_from_safe_id, LIVE_MAIN);
  assert.equal(rpc.p_to_safe_id, LIVE_STORE);
  console.log("PASS ghost target remapped", rpc);
}

// Case C: THE BUG — empty target id (select mismatch) + name خزنة المحل
{
  const rpc = simulateTransferRpc({
    fromSafeId: LIVE_MAIN,
    toSafeId: "",
    fromSafeName: "الخزنة الرئيسية",
    toSafeName: "خزنة المحل",
    amount: 1,
  });
  assert.equal(rpc.p_to_safe_id, LIVE_STORE);
  console.log("PASS empty target id recovered from name", rpc);
}

// Case D: reverse direction
{
  const rpc = simulateTransferRpc({
    fromSafeId: GHOST_STORE,
    toSafeId: LIVE_MAIN,
    fromSafeName: "خزنة المحل",
    toSafeName: "الخزنة الرئيسية",
    amount: 1,
  });
  assert.equal(rpc.p_from_safe_id, LIVE_STORE);
  assert.equal(rpc.p_to_safe_id, LIVE_MAIN);
  console.log("PASS reverse خزنة المحل → الرئيسية", rpc);
}

// Case E: OLD behavior without name — ghost id would hit SQL not-found
{
  const exists = live.some((s) => sameSafeId(s.id, GHOST_STORE));
  assert.equal(exists, false);
  console.log("PASS confirmed ghost id is absent from live table (RPC would raise الخزنة الهدف غير موجودة)");
}

console.log("\nAll RPC-arg simulation tests OK");

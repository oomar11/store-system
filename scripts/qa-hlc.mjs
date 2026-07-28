/**
 * Quick HLC / LWW ordering checks (node).
 * Run: node scripts/qa-hlc.mjs
 */
import assert from "node:assert/strict";

function compareHlc(a, b) {
  if (a.physicalMs !== b.physicalMs) return a.physicalMs > b.physicalMs ? 1 : -1;
  if (a.counter !== b.counter) return a.counter > b.counter ? 1 : -1;
  if (a.deviceId === b.deviceId) return 0;
  return a.deviceId > b.deviceId ? 1 : -1;
}

const early = { physicalMs: 1000, counter: 0, deviceId: "aaaa" };
const late = { physicalMs: 2000, counter: 0, deviceId: "bbbb" };
const sameTimeHigherCtr = { physicalMs: 2000, counter: 2, deviceId: "aaaa" };
const sameTimeDevice = { physicalMs: 2000, counter: 2, deviceId: "bbbb" };

assert.equal(compareHlc(late, early) > 0, true, "later physical wins");
assert.equal(compareHlc(early, late) < 0, true, "earlier loses");
assert.equal(compareHlc(sameTimeHigherCtr, late) > 0, true, "higher counter wins");
assert.equal(compareHlc(sameTimeDevice, sameTimeHigherCtr) > 0, true, "device tie-break");

// Delete with later HLC must beat earlier edit
const editOffline = { physicalMs: 1500, counter: 0, deviceId: "store-pc" };
const deleteOnline = { physicalMs: 1800, counter: 0, deviceId: "phone" };
assert.equal(compareHlc(deleteOnline, editOffline) > 0, true, "delete wins over older edit");

// Arrival order irrelevant: older arriving later still loses
assert.equal(compareHlc(editOffline, deleteOnline) < 0, true, "late-arriving old edit loses");

console.log("qa-hlc: all assertions passed");

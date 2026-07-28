/** Hybrid Logical Clock for causal offline ordering */

export type Hlc = {
  physicalMs: number;
  counter: number;
  deviceId: string;
};

const MAX_DRIFT_MS = 10 * 60 * 1000; // 10 minutes
const WARN_DRIFT_MS = 2 * 60 * 1000;

let offsetMs = 0;
let lastHlc: Hlc | null = null;
let deviceIdCache: string | null = null;

export function getMaxDriftMs(): number {
  return MAX_DRIFT_MS;
}

export function getClockOffsetMs(): number {
  return offsetMs;
}

export function setClockOffsetMs(ms: number): void {
  offsetMs = ms;
}

/** Calibrate local clock against server wall time (ms since epoch). */
export function calibrateFromServer(serverMs: number, localMs = Date.now()): {
  offsetMs: number;
  driftMs: number;
  ok: boolean;
  warn: boolean;
} {
  const measured = serverMs - localMs;
  offsetMs = measured;
  const driftMs = Math.abs(measured);
  return {
    offsetMs: measured,
    driftMs,
    ok: driftMs <= MAX_DRIFT_MS,
    warn: driftMs > WARN_DRIFT_MS,
  };
}

export function nowPhysicalMs(): number {
  return Date.now() + offsetMs;
}

export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.physicalMs !== b.physicalMs) return a.physicalMs > b.physicalMs ? 1 : -1;
  if (a.counter !== b.counter) return a.counter > b.counter ? 1 : -1;
  if (a.deviceId === b.deviceId) return 0;
  return a.deviceId > b.deviceId ? 1 : -1;
}

export function hlcToKey(h: Hlc): string {
  return `${h.physicalMs}:${h.counter}:${h.deviceId}`;
}

export function parseHlc(row: {
  hlc_physical_ms?: number | null;
  hlc_counter?: number | null;
  hlc_device_id?: string | null;
  last_hlc_physical_ms?: number | null;
  last_hlc_counter?: number | null;
  last_hlc_device_id?: string | null;
}): Hlc | null {
  const physicalMs = Number(row.hlc_physical_ms ?? row.last_hlc_physical_ms ?? 0);
  const counter = Number(row.hlc_counter ?? row.last_hlc_counter ?? 0);
  const deviceId = String(row.hlc_device_id ?? row.last_hlc_device_id ?? "");
  if (!physicalMs || !deviceId) return null;
  return { physicalMs, counter, deviceId };
}

/** Tick HLC for a new local event. */
export function tickHlc(deviceId: string): Hlc {
  const physicalMs = nowPhysicalMs();
  let counter = 0;
  if (lastHlc) {
    if (physicalMs > lastHlc.physicalMs) {
      counter = 0;
    } else {
      counter = lastHlc.counter + 1;
    }
  }
  const next: Hlc = { physicalMs: Math.max(physicalMs, lastHlc?.physicalMs ?? 0), counter, deviceId };
  if (next.physicalMs === lastHlc?.physicalMs && next.counter === 0 && lastHlc) {
    next.counter = lastHlc.counter + 1;
  }
  lastHlc = next;
  return next;
}

/** Merge remote HLC into local clock (receive path). */
export function receiveHlc(remote: Hlc, deviceId: string): Hlc {
  const physicalMs = nowPhysicalMs();
  const maxPhys = Math.max(physicalMs, remote.physicalMs, lastHlc?.physicalMs ?? 0);
  let counter = 0;
  if (maxPhys === remote.physicalMs && maxPhys === (lastHlc?.physicalMs ?? 0)) {
    counter = Math.max(remote.counter, lastHlc?.counter ?? 0) + 1;
  } else if (maxPhys === remote.physicalMs) {
    counter = remote.counter + 1;
  } else if (maxPhys === (lastHlc?.physicalMs ?? 0)) {
    counter = (lastHlc?.counter ?? 0) + 1;
  } else {
    counter = 0;
  }
  const next: Hlc = { physicalMs: maxPhys, counter, deviceId };
  lastHlc = next;
  return next;
}

export function restoreHlcState(state: Hlc | null): void {
  lastHlc = state;
}

export function getLastHlc(): Hlc | null {
  return lastHlc;
}

export function getCachedDeviceId(): string | null {
  return deviceIdCache;
}

export function setCachedDeviceId(id: string): void {
  deviceIdCache = id;
}

export function isClockSkewUnsafe(): boolean {
  return Math.abs(offsetMs) > MAX_DRIFT_MS;
}

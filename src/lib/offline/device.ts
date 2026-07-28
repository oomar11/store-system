import { getOfflineDb, setMeta, getMeta } from "@/lib/offline/db";
import {
  calibrateFromServer,
  getClockOffsetMs,
  getLastHlc,
  restoreHlcState,
  setCachedDeviceId,
  setClockOffsetMs,
  type Hlc,
} from "@/lib/offline/hlc";
import type { DeviceState } from "@/lib/offline/types";

const DEVICE_KEY = "sync_device_id";

export async function getOrCreateDeviceId(): Promise<string> {
  const db = getOfflineDb();
  const existing = await db.device.get("main");
  if (existing?.device_id) {
    setCachedDeviceId(existing.device_id);
    if (existing.last_hlc) restoreHlcState(existing.last_hlc);
    setClockOffsetMs(existing.clock_offset_ms || 0);
    return existing.device_id;
  }

  const fromMeta = await getMeta(DEVICE_KEY);
  const deviceId = fromMeta || crypto.randomUUID();
  await setMeta(DEVICE_KEY, deviceId);
  setCachedDeviceId(deviceId);

  const state: DeviceState = {
    id: "main",
    device_id: deviceId,
    label: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "device",
    checkpoint: 0,
    bootstrapped_at: null,
    last_sync_at: null,
    clock_offset_ms: 0,
    storage_persisted: null,
    last_hlc: null,
  };
  await db.device.put(state);
  return deviceId;
}

export async function getDeviceState(): Promise<DeviceState | null> {
  await getOrCreateDeviceId();
  return (await getOfflineDb().device.get("main")) ?? null;
}

export async function updateDeviceState(
  patch: Partial<Omit<DeviceState, "id">>
): Promise<DeviceState> {
  const db = getOfflineDb();
  const cur = (await getDeviceState())!;
  const next: DeviceState = { ...cur, ...patch, id: "main" };
  await db.device.put(next);
  if (next.last_hlc) restoreHlcState(next.last_hlc);
  setClockOffsetMs(next.clock_offset_ms || 0);
  setCachedDeviceId(next.device_id);
  return next;
}

export async function persistLastHlc(hlc: Hlc): Promise<void> {
  await updateDeviceState({ last_hlc: hlc });
}

export async function applyServerTime(serverMs: number): Promise<{
  ok: boolean;
  warn: boolean;
  driftMs: number;
}> {
  const cal = calibrateFromServer(serverMs);
  await updateDeviceState({ clock_offset_ms: getClockOffsetMs() });
  return { ok: cal.ok, warn: cal.warn, driftMs: cal.driftMs };
}

export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "server";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Mac/i.test(ua)) return "Mac";
  return "Browser";
}

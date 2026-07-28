/** Local-first helpers: never hang the UI waiting on network */

import { isBrowserOnline } from "@/lib/offline/network";

export class TimeoutError extends Error {
  constructor(message = "timeout") {
    super(message);
    this.name = "TimeoutError";
  }
}

const CONNECTIVITY_CACHE_TTL_MS = 12_000;
let cachedOnline: boolean | null = null;
let cachedAt = 0;

/** Update the shared connectivity cache (OfflineProvider / probeOnline). */
export function setConnectivityCache(online: boolean): void {
  cachedOnline = online;
  cachedAt = Date.now();
}

/** Recent probe result, or null if missing/expired. */
export function getCachedOnline(): boolean | null {
  if (cachedOnline === null) return null;
  if (Date.now() - cachedAt > CONNECTIVITY_CACHE_TTL_MS) return null;
  return cachedOnline;
}

/**
 * Fast path for mutations: navigator.onLine + recent cache.
 * Does NOT hit /api/health — network errors still fall back to the outbox.
 */
export function isLikelyOnline(): boolean {
  if (!isBrowserOnline()) return false;
  if (getCachedOnline() === false) return false;
  return true;
}

/**
 * Single source of truth for "can we reach the server?"
 * Uses a short TTL cache so callers don't probe /api/health on every action.
 */
export async function isEffectivelyOnline(timeoutMs = 800): Promise<boolean> {
  if (!isBrowserOnline()) {
    setConnectivityCache(false);
    return false;
  }
  const cached = getCachedOnline();
  if (cached !== null) return cached;
  return probeOnline(timeoutMs);
}

export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms = 4000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export type LocalThenNetworkOptions<T> = {
  /** Load from IndexedDB / local cache */
  local: () => Promise<T | null | undefined>;
  /** Fetch from network (should throw on failure) */
  network: () => Promise<T>;
  /** Apply data to React state (called for local and/or network) */
  apply: (data: T, source: "local" | "network") => void;
  /** Network timeout ms */
  timeoutMs?: number;
  /** Skip network entirely */
  offline?: boolean;
  /**
   * When local data exists, refresh from network in the background and
   * return immediately (default true). Set false only if you must wait
   * for the freshest network result before continuing.
   */
  backgroundRefresh?: boolean;
};

/**
 * Show local data immediately, then refresh from network if possible.
 * When local cache hits, does NOT block on the network call.
 */
export async function readLocalThenNetwork<T>(
  options: LocalThenNetworkOptions<T>
): Promise<{ source: "local" | "network" | "none"; data: T | null }> {
  let localData: T | null = null;

  try {
    const raw = await options.local();
    if (raw != null) {
      localData = raw;
      options.apply(raw, "local");
    }
  } catch {
    /* ignore local errors */
  }

  if (options.offline) {
    return { source: localData != null ? "local" : "none", data: localData };
  }

  const timeoutMs = options.timeoutMs ?? 4000;
  const background =
    options.backgroundRefresh !== false && localData != null;

  if (background) {
    void (async () => {
      try {
        const remote = await withTimeout(options.network(), timeoutMs);
        options.apply(remote, "network");
      } catch {
        /* keep local */
      }
    })();
    return { source: "local", data: localData };
  }

  try {
    const remote = await withTimeout(options.network(), timeoutMs);
    options.apply(remote, "network");
    return { source: "network", data: remote };
  } catch {
    return { source: localData != null ? "local" : "none", data: localData };
  }
}

/**
 * Probe real connectivity beyond navigator.onLine.
 * Uses /api/health (SW must hit the network — not a cached shell asset).
 * Results are cached briefly via setConnectivityCache.
 */
export async function probeOnline(timeoutMs = 800): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setConnectivityCache(false);
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`/api/health?t=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    // SW returns 503 JSON { offline: true } when the network is down
    if (!res.ok) {
      setConnectivityCache(false);
      return false;
    }
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      offline?: boolean;
    } | null;
    if (body?.offline) {
      setConnectivityCache(false);
      return false;
    }
    const ok = body?.ok === true || res.status === 200;
    setConnectivityCache(ok);
    return ok;
  } catch {
    setConnectivityCache(false);
    return false;
  }
}

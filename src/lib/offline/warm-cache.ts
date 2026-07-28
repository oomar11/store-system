"use client";

import { getSnapshot } from "@/lib/offline/snapshot";
import { getMeta } from "@/lib/offline/db";
import { OFFLINE_SHELL_CACHE } from "@/lib/offline/cache-names";

/** True when a successful offline pack was written to this device. */
export async function isOfflinePackReady(): Promise<boolean> {
  try {
    const readyAt = await getMeta("offline_ready_at");
    if (!readyAt) return false;
    const { needsBootstrapRefresh } = await import("@/lib/offline/sync");
    if (await needsBootstrapRefresh()) return false;
    const snap = await getSnapshot();
    if (snap == null) return false;
    try {
      const { getDeviceState } = await import("@/lib/offline/device");
      const state = await getDeviceState();
      if (state?.bootstrapped_at && snap.products.length >= 0) {
        return true;
      }
    } catch {
      /* fall through to shell check */
    }
    if (!("caches" in window)) return true;
    const cache = await caches.open(OFFLINE_SHELL_CACHE);
    const core = ["/pos", "/dashboard", "/products", "/customers"];
    let hits = 0;
    for (const p of core) {
      if (await cache.match(p, { ignoreSearch: true })) hits += 1;
    }
    return hits >= 2;
  } catch {
    return false;
  }
}

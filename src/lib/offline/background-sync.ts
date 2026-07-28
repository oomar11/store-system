/** Debounced background sync — never block UI mutations. */

import { isBrowserOnline } from "@/lib/offline/network";
import { getCachedOnline } from "@/lib/offline/local-first";

type SyncRunner = () => Promise<unknown>;

let runner: SyncRunner | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<unknown> | null = null;

/** Register OfflineProvider.runSync so the badge updates during background sync. */
export function setBackgroundSyncRunner(fn: SyncRunner | null): void {
  runner = fn;
}

/**
 * Schedule a single debounced sync. Safe to call after every successful save.
 * Does not await — callers should fire-and-forget: `void scheduleBackgroundSync()`.
 */
export function scheduleBackgroundSync(delayMs = 1500): void {
  if (typeof window === "undefined") return;
  if (!isBrowserOnline()) return;
  if (getCachedOnline() === false) return;

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runBackgroundSync();
  }, delayMs);
}

async function runBackgroundSync(): Promise<void> {
  if (inFlight) {
    await inFlight;
    return;
  }
  inFlight = (async () => {
    try {
      if (!isBrowserOnline()) return;
      if (getCachedOnline() === false) return;
      if (runner) {
        await runner();
        return;
      }
      const { createClient } = await import("@/lib/supabase");
      const { syncOutbox } = await import("@/lib/offline/sync");
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      await syncOutbox(supabase);
    } catch {
      /* best effort */
    }
  })().finally(() => {
    inFlight = null;
  });
  await inFlight;
}

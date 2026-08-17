"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase";
import {
  countPendingOutbox,
  isBrowserOnline,
  listOutbox,
  probeOnline,
  setBackgroundSyncRunner,
  setConnectivityCache,
  subscribeConnectivity,
  type OutboxEntry,
  type SyncResult,
} from "@/lib/offline";

type OfflineContextValue = {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncResult: SyncResult | null;
  entries: OutboxEntry[];
  refreshQueue: () => Promise<void>;
  runSync: () => Promise<SyncResult>;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

const SYNC_INTERVAL_MS = 3 * 60 * 1000;
const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 800;

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const syncingRef = useRef(false);
  const syncPromiseRef = useRef<Promise<SyncResult> | null>(null);
  const lastSyncResultRef = useRef<SyncResult | null>(null);
  const pendingCountRef = useRef(0);
  const onlineRef = useRef(online);

  useEffect(() => {
    lastSyncResultRef.current = lastSyncResult;
  }, [lastSyncResult]);

  useEffect(() => {
    pendingCountRef.current = pendingCount;
  }, [pendingCount]);

  useEffect(() => {
    onlineRef.current = online;
    setConnectivityCache(online);
  }, [online]);

  const refreshQueue = useCallback(async () => {
    try {
      const [count, list] = await Promise.all([
        countPendingOutbox(),
        listOutbox({ includeSynced: false }),
      ]);
      setPendingCount(count);
      setEntries(list);
    } catch {
      /* IndexedDB unavailable */
    }
  }, []);

  const checkConnectivity = useCallback(async () => {
    if (!isBrowserOnline()) {
      setOnline(false);
      return false;
    }
    const ok = await probeOnline(PROBE_TIMEOUT_MS);
    setOnline(ok);
    return ok;
  }, []);

  const runSync = useCallback(async () => {
    if (syncPromiseRef.current) return syncPromiseRef.current;

    syncingRef.current = true;
    setSyncing(true);
    const promise = (async (): Promise<SyncResult> => {
      if (!isBrowserOnline()) {
        setOnline(false);
        const remaining = await countPendingOutbox();
        const result = {
          synced: 0,
          conflicts: 0,
          failed: 0,
          remaining,
          pulled: 0,
          superseded: 0,
          clockOk: true,
        };
        setLastSyncResult(result);
        return result;
      }
      const reachable = await checkConnectivity();
      if (!reachable) {
        const remaining = await countPendingOutbox();
        const result = {
          synced: 0,
          conflicts: 0,
          failed: 0,
          remaining,
          pulled: 0,
          superseded: 0,
          clockOk: true,
        };
        setLastSyncResult(result);
        return result;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        const remaining = await countPendingOutbox();
        const result = {
          synced: 0,
          conflicts: 0,
          failed: remaining > 0 ? remaining : 0,
          remaining,
          pulled: 0,
          superseded: 0,
          clockOk: true,
        };
        setLastSyncResult(result);
        return result;
      }
      const { syncOutbox } = await import("@/lib/offline/sync");
      const result = await syncOutbox(supabase);
      setLastSyncResult(result);
      await refreshQueue();
      return result;
    })().finally(() => {
      syncingRef.current = false;
      syncPromiseRef.current = null;
      setSyncing(false);
    });

    syncPromiseRef.current = promise;
    return promise;
  }, [supabase, refreshQueue, checkConnectivity]);

  // Mutations call scheduleBackgroundSync → this runner (updates badge)
  useEffect(() => {
    setBackgroundSyncRunner(() => runSync());
    return () => setBackgroundSyncRunner(null);
  }, [runSync]);

  // Connectivity + reconnect: single sync (syncOutbox already rebuilds snapshot)
  useEffect(() => {
    if (isBrowserOnline()) {
      void checkConnectivity();
    } else {
      setOnline(false);
    }
    return subscribeConnectivity((browserOnline) => {
      if (!browserOnline) {
        setOnline(false);
        return;
      }
      void (async () => {
        const ok = await probeOnline(PROBE_TIMEOUT_MS);
        setOnline(ok);
        if (!ok) return;
        await runSync();
      })();
    });
  }, [checkConnectivity, runSync]);

  useEffect(() => {
    void refreshQueue();
    const timer = window.setInterval(() => {
      if (!isBrowserOnline() || !onlineRef.current) return;
      void refreshQueue();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [refreshQueue]);

  // Live connectivity probe — skip entirely while navigator is offline
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isBrowserOnline()) {
        setOnline(false);
        return;
      }
      void checkConnectivity();
    }, PROBE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkConnectivity]);

  // Initial warm + periodic sync while truly online (no double pullSnapshot)
  useEffect(() => {
    let cancelled = false;

    async function warmAndSync() {
      await refreshQueue();
      if (!isBrowserOnline()) {
        setOnline(false);
        return;
      }
      const reachable = await checkConnectivity();
      if (!reachable || cancelled) return;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user || cancelled) return;

      await runSync();
      if (!cancelled) await refreshQueue();
    }

    void warmAndSync();

    const syncTimer = window.setInterval(() => {
      void (async () => {
        if (cancelled || !isBrowserOnline() || !onlineRef.current) return;
        const reachable = await checkConnectivity();
        if (!reachable) return;
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) return;
        await runSync();
      })();
    }, SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(syncTimer);
    };
  }, [supabase, refreshQueue, checkConnectivity, runSync]);

  // Remember last route for PWA cold start
  useEffect(() => {
    const save = () => {
      try {
        const path = window.location.pathname + window.location.search;
        if (
          path &&
          !path.startsWith("/login") &&
          !path.startsWith("/app-start")
        ) {
          localStorage.setItem("windoor-last-path", path);
        }
      } catch {
        /* ignore */
      }
    };
    save();
    window.addEventListener("popstate", save);
    const timer = window.setInterval(save, 4000);
    return () => {
      window.removeEventListener("popstate", save);
      window.clearInterval(timer);
    };
  }, []);

  // Hard-navigate only while offline — soft RSC nav hangs without cached flights.
  // Online: allow normal Next.js client navigation.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (onlineRef.current) return;
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = (e.target as Element | null)?.closest?.("a[href]");
      if (!el) return;
      const a = el as HTMLAnchorElement;
      if (a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (
        /^https?:\/\//i.test(href) &&
        !href.startsWith(window.location.origin)
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      try {
        const dest = new URL(href, window.location.href);
        const path = dest.pathname + dest.search;
        if (path && !path.startsWith("/login") && !path.startsWith("/app-start")) {
          localStorage.setItem("windoor-last-path", path);
        }
      } catch {
        /* ignore */
      }
      window.location.assign(href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const value = useMemo(
    () => ({
      online,
      pendingCount,
      syncing,
      lastSyncResult,
      entries,
      refreshQueue,
      runSync,
    }),
    [
      online,
      pendingCount,
      syncing,
      lastSyncResult,
      entries,
      refreshQueue,
      runSync,
    ]
  );

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    return {
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      pendingCount: 0,
      syncing: false,
      lastSyncResult: null,
      entries: [],
      refreshQueue: async () => {},
      runSync: async () => ({
        synced: 0,
        conflicts: 0,
        failed: 0,
        remaining: 0,
        pulled: 0,
        superseded: 0,
        clockOk: true,
      }),
    };
  }
  return ctx;
}

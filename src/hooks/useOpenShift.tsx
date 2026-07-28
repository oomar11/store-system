"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase";
import { fetchOpenShift, type ShiftRow } from "@/lib/shifts";
import { useAuth } from "@/hooks/useAuth";
import { getMeta, setMeta } from "@/lib/offline/db";
import { isBrowserOnline, isLikelyNetworkError } from "@/lib/offline/network";
import { withTimeout } from "@/lib/offline/local-first";
import {
  getMemoryShift,
  setMemoryShift,
} from "@/lib/offline/session-memory";

const OPEN_SHIFT_KEY = "cached_open_shift";

async function saveCachedShift(shift: ShiftRow | null) {
  try {
    await setMeta(OPEN_SHIFT_KEY, shift ? JSON.stringify(shift) : "");
  } catch {
    /* ignore */
  }
}

async function loadCachedShift(): Promise<ShiftRow | null> {
  try {
    const raw = await getMeta(OPEN_SHIFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ShiftRow;
  } catch {
    return null;
  }
}

type ShiftContextValue = {
  openShift: ShiftRow | null;
  loading: boolean;
  refreshShift: () => Promise<void>;
  /** الموظف لازم يكون في وردية مفتوحة عشان يشتغل */
  requiresShift: boolean;
  hasActiveShift: boolean;
  blockedByShift: boolean;
};

const ShiftContext = createContext<ShiftContextValue | null>(null);

export function ShiftProvider({ children }: { children: ReactNode }) {
  const { profile, loading: authLoading, isEmployee } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const mem = getMemoryShift();
  const [openShift, setOpenShift] = useState<ShiftRow | null>(() =>
    mem === undefined ? null : mem
  );
  const [loading, setLoading] = useState(() => mem === undefined);

  const refreshShift = useCallback(async () => {
    if (!isBrowserOnline()) {
      const cached = await loadCachedShift();
      setMemoryShift(cached);
      setOpenShift(cached);
      setLoading(false);
      return;
    }

    try {
      const shift = await withTimeout(fetchOpenShift(supabase), 2000);
      setMemoryShift(shift);
      setOpenShift(shift);
      await saveCachedShift(shift);
    } catch (e) {
      if (isLikelyNetworkError(e) || (e as Error)?.name === "TimeoutError") {
        const cached = await loadCachedShift();
        setMemoryShift(cached);
        setOpenShift(cached);
        setLoading(false);
        return;
      }
      try {
        const { data } = await withTimeout(
          (async () =>
            supabase
              .from("shifts")
              .select("*")
              .eq("status", "open")
              .maybeSingle())(),
          2000
        );
        const row = (data as ShiftRow | null) || null;
        setMemoryShift(row);
        setOpenShift(row);
        await saveCachedShift(row);
      } catch {
        const cached = await loadCachedShift();
        setMemoryShift(cached);
        setOpenShift(cached);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      setMemoryShift(null);
      setOpenShift(null);
      setLoading(false);
      return;
    }
    // Don't flash spinner if we already have memory from previous page
    if (getMemoryShift() === undefined) {
      setLoading(true);
    }
    void refreshShift();
  }, [authLoading, profile, refreshShift]);

  const requiresShift = !!profile && isEmployee;
  const hasActiveShift = !!openShift;
  const blockedByShift = requiresShift && !hasActiveShift;

  const value = useMemo(
    () => ({
      openShift,
      loading: authLoading || loading,
      refreshShift,
      requiresShift,
      hasActiveShift,
      blockedByShift,
    }),
    [
      openShift,
      authLoading,
      loading,
      refreshShift,
      requiresShift,
      hasActiveShift,
      blockedByShift,
    ]
  );

  return (
    <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
  );
}

export function useOpenShift(): ShiftContextValue {
  const ctx = useContext(ShiftContext);
  if (!ctx) {
    return {
      openShift: null,
      loading: false,
      refreshShift: async () => {},
      requiresShift: false,
      hasActiveShift: false,
      blockedByShift: false,
    };
  }
  return ctx;
}

/** أسماء شائعة لخزنة درج الكاشير */
export function isDrawerSafe(name: string | null | undefined): boolean {
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return (
    n.includes("درج") ||
    n.includes("drawer") ||
    n.includes("كاشير") ||
    n.includes("cash")
  );
}

/** يختار درج الكاشير من الإعدادات أو بالاسم، وإلا أول خزنة نشطة */
export function pickDrawerSafe<
  T extends { id: string; name: string; is_active?: boolean | null },
>(safes: T[], preferredId?: string | null): T | null {
  if (!safes.length) return null;
  if (preferredId) {
    const preferred = safes.find((s) => s.id === preferredId);
    if (preferred) return preferred;
  }
  const named = safes.find(
    (s) => s.is_active !== false && isDrawerSafe(s.name)
  );
  if (named) return named;
  return safes.find((s) => s.is_active !== false) || safes[0] || null;
}

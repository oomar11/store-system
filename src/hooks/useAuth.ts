"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import {
  canAccess,
  profileSubject,
  type AppPermission,
} from "@/lib/permissions";
import {
  loadCachedProfile,
  resolveAuthUser,
  saveCachedProfile,
  clearCachedProfile,
  getOfflineSession,
} from "@/lib/offline/auth-session";
import { isBrowserOnline, isLikelyNetworkError } from "@/lib/offline/network";
import { withTimeout } from "@/lib/offline/local-first";
import {
  clearSessionMemory,
  getMemoryProfile,
  setMemoryProfile,
} from "@/lib/offline/session-memory";
import type { Profile } from "@/types";

export function useAuth() {
  const [profile, setProfile] = useState<Profile | null>(() =>
    getMemoryProfile()
  );
  const [loading, setLoading] = useState(() => !getMemoryProfile());
  const [authMode, setAuthMode] = useState<"online" | "offline" | null>(null);
  const supabase = createClient();

  useEffect(() => {
    let cancelled = false;

    async function getProfile() {
      const { user, offlineSession } = await resolveAuthUser(supabase);

      if (!user) {
        if (!cancelled) {
          clearSessionMemory();
          setMemoryProfile(null);
          setProfile(null);
          setAuthMode(null);
          setLoading(false);
        }
        return;
      }

      if (offlineSession) {
        const offline = await getOfflineSession();
        if (offline && !cancelled) {
          setMemoryProfile(offline.profile);
          setProfile(offline.profile);
          setAuthMode("offline");
          setLoading(false);
          return;
        }
      }

      const mem = getMemoryProfile();
      if (mem && mem.id === user.id && !cancelled) {
        setProfile(mem);
        setLoading(false);
      }

      const cached = await loadCachedProfile(user.id);
      if (cached && !cancelled) {
        setMemoryProfile(cached);
        setProfile(cached);
        setAuthMode("online");
        setLoading(false);
      }

      if (!isBrowserOnline()) {
        if (!cancelled) {
          const offline = await getOfflineSession();
          const p = offline?.profile ?? cached ?? mem;
          setProfile(p);
          setAuthMode(offline ? "offline" : p ? "offline" : null);
          setLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await withTimeout(
          (async () =>
            supabase.from("profiles").select("*").eq("id", user.id).single())(),
          2500
        );
        if (!cancelled && !error && data) {
          await saveCachedProfile(data as Profile);
          setMemoryProfile(data as Profile);
          setProfile(data as Profile);
          setAuthMode("online");
          setLoading(false);
          return;
        }
        if (error && !isLikelyNetworkError(error)) {
          /* fall through to cache */
        }
      } catch {
        /* fall through */
      }

      if (!cancelled) {
        setProfile(cached ?? mem);
        setAuthMode(cached || mem ? "online" : null);
        setLoading(false);
      }
    }

    void getProfile();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        // Keep offline session if present
        void (async () => {
          const offline = await getOfflineSession();
          if (offline) {
            setMemoryProfile(offline.profile);
            setProfile(offline.profile);
            setAuthMode("offline");
            setLoading(false);
            return;
          }
          clearSessionMemory();
          setProfile(null);
          void clearCachedProfile();
          setAuthMode(null);
          setLoading(false);
        })();
      } else {
        void getProfile();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const subject = profileSubject(profile);
  const role = profile?.role;
  const isOwner = role === "owner";
  const isManager = role === "manager";
  const isEmployee = role === "employee";

  const can = (permission: AppPermission) => canAccess(subject, permission);

  return {
    profile,
    loading,
    authMode,
    isOfflineSession: authMode === "offline",
    subject,
    isOwner,
    isManager,
    isEmployee,
    canManageUsers: can("users.manage"),
    canManageTreasury: can("treasury"),
    canViewReports: can("reports"),
    canDeleteInvoices: can("invoices.delete"),
    canEditPrices: can("prices.edit"),
    canWriteProducts: can("products.write"),
    canWriteCustomers: can("customers.write"),
    canAccessSuppliers: can("suppliers"),
    canAccessExpenses: can("expenses"),
    canAccessPurchases: can("purchases"),
    canAccessSettings: can("settings"),
    can,
  };
}

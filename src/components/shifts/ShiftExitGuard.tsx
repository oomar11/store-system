"use client";

import { useCallback, useEffect, useRef } from "react";
import { useOpenShift } from "@/hooks/useOpenShift";
import { useAuth } from "@/hooks/useAuth";
import { appChoice } from "@/components/ui/ConfirmDialog";

const WARN_MSG =
  "عندك وردية مفتوحة — اقفل الوردية (تسليم الدرج) قبل ما تسييب الصفحة أو تسجّل خروج.";

async function postAbandon(
  action: "request" | "cancel" | "force",
  reason?: "abandoned_unload" | "abandoned_logout",
  opts?: { keepalive?: boolean; beacon?: boolean }
) {
  const payload = JSON.stringify({
    action,
    reason,
  });

  if (opts?.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "text/plain" });
    const ok = navigator.sendBeacon("/api/shifts/abandon", blob);
    if (ok) return;
  }

  await fetch("/api/shifts/abandon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: opts?.keepalive === true,
    credentials: "same-origin",
  });
}

/**
 * Warns employees before leaving with an open shift, and schedules
 * auto-close + manager notification if the tab/app is closed.
 */
export function ShiftExitGuard() {
  const { openShift } = useOpenShift();
  const { isEmployee } = useAuth();
  const openShiftIdRef = useRef<string | null>(null);
  const armedRef = useRef(false);

  useEffect(() => {
    openShiftIdRef.current = openShift?.id || null;
    armedRef.current = !!(isEmployee && openShift);
  }, [isEmployee, openShift]);

  // Cancel pending abandon when session is alive again (refresh / return)
  useEffect(() => {
    if (!isEmployee || !openShift) return;
    void postAbandon("cancel");
  }, [isEmployee, openShift?.id]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!armedRef.current) return;
      e.preventDefault();
      e.returnValue = WARN_MSG;
      return WARN_MSG;
    }

    function onPageHide(e: PageTransitionEvent) {
      if (!armedRef.current || !openShiftIdRef.current) return;
      if (e.persisted) return; // bfcache — page may come back
      void postAbandon("request", "abandoned_unload", {
        beacon: true,
        keepalive: true,
      });
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return null;
}

/** Call from logout — returns false if user cancelled. */
export async function confirmLogoutWithOpenShift(opts: {
  hasOpenShift: boolean;
  isEmployee: boolean;
  goToShifts: () => void;
}): Promise<"proceed" | "cancelled" | "abandoned"> {
  if (!opts.isEmployee || !opts.hasOpenShift) return "proceed";

  const result = await appChoice({
    title: "وردية مفتوحة",
    message:
      "عندك وردية مفتوحة — لازم تسلّم الدرج قبل الخروج.\n\nاختر: إقفال الوردية الآن، أو الخروج بدون إقفال (هتتقفل تلقائي ويتبعت إشعار للمدير)، أو إلغاء.",
    primaryLabel: "إقفال الوردية",
    dangerLabel: "خروج بدون إقفال",
    cancelLabel: "إلغاء",
  });

  if (result === "primary") {
    opts.goToShifts();
    return "cancelled";
  }
  if (result === "cancel") return "cancelled";

  try {
    await postAbandon("force", "abandoned_logout");
  } catch {
    // still allow logout
  }
  return "abandoned";
}

export function useShiftExitLogout() {
  const { openShift, hasActiveShift, refreshShift } = useOpenShift();
  const { isEmployee } = useAuth();

  return useCallback(
    async (goToShifts: () => void) => {
      const result = await confirmLogoutWithOpenShift({
        hasOpenShift: hasActiveShift,
        isEmployee,
        goToShifts,
      });
      if (result === "abandoned") {
        await refreshShift();
      }
      return result !== "cancelled";
    },
    [hasActiveShift, isEmployee, refreshShift, openShift?.id]
  );
}

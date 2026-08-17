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
  const shouldArmRef = useRef(false);

  useEffect(() => {
    openShiftIdRef.current = openShift?.id || null;
    shouldArmRef.current = !!(isEmployee && openShift);
    armedRef.current = shouldArmRef.current;
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

    let rearmTimer: number | undefined;

    function onInAppClick(e: MouseEvent) {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (a.getAttribute("target") === "_blank" || a.hasAttribute("download")) {
        return;
      }
      try {
        const dest = new URL(href, window.location.href);
        if (dest.origin !== window.location.origin) return;
      } catch {
        return;
      }
      // Same-origin sidebar/header navigation is not "leaving the tab".
      armedRef.current = false;
      if (rearmTimer) window.clearTimeout(rearmTimer);
      rearmTimer = window.setTimeout(() => {
        armedRef.current = shouldArmRef.current;
      }, 2500);
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("click", onInAppClick, true);
    return () => {
      if (rearmTimer) window.clearTimeout(rearmTimer);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("click", onInAppClick, true);
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

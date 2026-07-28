"use client";

import { useEffect, useState } from "react";
import { MOBILE_DESKTOP_MIN, MOBILE_TABLET_MIN } from "@/lib/mobile-nav";

export type ViewportMode = "phone" | "tablet" | "desktop";

function readMode(): ViewportMode {
  if (typeof window === "undefined") return "phone";
  const w = window.innerWidth;
  if (w >= MOBILE_DESKTOP_MIN) return "desktop";
  if (w >= MOBILE_TABLET_MIN) return "tablet";
  return "phone";
}

/** Reactive viewport bucket for `/m` shell (phone / tablet / desktop). */
export function useViewportMode() {
  const [mode, setMode] = useState<ViewportMode>("phone");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const update = () => setMode(readMode());
    update();
    setReady(true);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return {
    mode,
    ready,
    isPhone: mode === "phone",
    isTablet: mode === "tablet",
    isDesktop: mode === "desktop",
    showPosTab: mode === "tablet" || mode === "desktop",
  };
}

/** Prefer mobile shell after login when width is below desktop. */
export function prefersMobileShell(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_DESKTOP_MIN;
}

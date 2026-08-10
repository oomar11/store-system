"use client";

import { useEffect } from "react";
import { BottomNav } from "@/components/mobile/BottomNav";

function lockPortrait() {
  try {
    const orientation = window.screen?.orientation as
      | (ScreenOrientation & {
          lock?: (type: string) => Promise<void>;
        })
      | undefined;
    if (orientation && typeof orientation.lock === "function") {
      void orientation.lock("portrait").catch(() => undefined);
      void orientation.lock("portrait-primary").catch(() => undefined);
    }
    const legacy = window.screen as Screen & {
      lockOrientation?: (type: string) => boolean;
      mozLockOrientation?: (type: string) => boolean;
      msLockOrientation?: (type: string) => boolean;
    };
    legacy.lockOrientation?.("portrait");
    legacy.mozLockOrientation?.("portrait");
    legacy.msLockOrientation?.("portrait");
  } catch {
    /* ignore unsupported browsers */
  }
}

export function MobileShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("mobile-portrait-lock");
    lockPortrait();

    const onChange = () => lockPortrait();
    window.addEventListener("orientationchange", onChange);
    window.addEventListener("resize", onChange);
    window.visualViewport?.addEventListener("resize", onChange);
    document.addEventListener("visibilitychange", onChange);

    return () => {
      document.documentElement.classList.remove("mobile-portrait-lock");
      window.removeEventListener("orientationchange", onChange);
      window.removeEventListener("resize", onChange);
      window.visualViewport?.removeEventListener("resize", onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, []);

  return (
    <div className="mobile-app">
      <div className="mobile-landscape-blocker" role="alertdialog" aria-live="assertive">
        <p>رجّع الموبايل بالطول</p>
        <span>التطبيق شغال بالوضع العمودي فقط</span>
      </div>
      <div className="mobile-app__inner">{children}</div>
      <BottomNav />
    </div>
  );
}

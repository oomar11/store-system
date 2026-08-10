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
    }
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
    window.visualViewport?.addEventListener("resize", onChange);

    return () => {
      document.documentElement.classList.remove("mobile-portrait-lock");
      window.removeEventListener("orientationchange", onChange);
      window.visualViewport?.removeEventListener("resize", onChange);
    };
  }, []);

  return (
    <div className="mobile-app">
      <div className="mobile-landscape-blocker">
        <p>رجاءً ارجع الموبايل لوضع رأسي</p>
        <span>التطبيق مقفول على الوضع العمودي</span>
      </div>
      <div className="mobile-app__inner">{children}</div>
      <BottomNav />
    </div>
  );
}

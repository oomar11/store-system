"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useViewportMode } from "@/hooks/useViewportMode";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import PosPage from "@/app/(dashboard)/pos/page";

/**
 * Tablet-only POS inside the mobile shell.
 * Phones are redirected to `/m` — no counter selling on small screens.
 */
export default function MobilePosPage() {
  const router = useRouter();
  const { ready, isPhone, showPosTab } = useViewportMode();

  useEffect(() => {
    if (!ready) return;
    if (isPhone || !showPosTab) {
      router.replace("/m");
    }
  }, [ready, isPhone, showPosTab, router]);

  if (!ready || isPhone || !showPosTab) {
    return (
      <div className="mobile-loading-inline">
        <div className="mobile-spinner" />
      </div>
    );
  }

  return (
    <div className="mobile-pos-frame">
      <MobileHeader title="نقطة البيع" subtitle="وضع التابلت" />
      <div className="px-2 pb-4 md:px-3">
        <PosPage embedded />
      </div>
    </div>
  );
}

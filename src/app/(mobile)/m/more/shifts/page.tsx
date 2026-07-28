"use client";

import { Clock3 } from "lucide-react";
import ShiftsPage from "@/app/(dashboard)/shifts/page";
import { useViewportMode } from "@/hooks/useViewportMode";
import { useOpenShift } from "@/hooks/useOpenShift";
import { MobileHeader } from "@/components/mobile/MobileHeader";

/** Phone cannot open a shift, but can browse past closed shifts. */
export default function MobileShiftsPage() {
  const { isPhone, ready } = useViewportMode();
  const { openShift, loading: shiftLoading } = useOpenShift();

  if (!ready || shiftLoading) {
    return (
      <div className="mobile-loading-inline">
        <div className="mobile-spinner" />
      </div>
    );
  }

  return (
    <>
      <MobileHeader
        title="الوردية"
        subtitle={
          isPhone && !openShift
            ? "سجل الورديات — الفتح من التابلت"
            : "فتح وإقفال ومتابعة"
        }
      />
      {isPhone && !openShift ? (
        <div className="mobile-page pb-0">
          <div className="mobile-panel mb-3 flex items-start gap-2 p-4">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" />
            <p className="text-sm font-semibold leading-6 text-[var(--muted)]">
              فتح الوردية من التليفون غير متاح. تقدر تتابع الورديات السابقة من القائمة
              تحت.
            </p>
          </div>
        </div>
      ) : null}
      <div className={isPhone && !openShift ? "px-3 pb-4" : undefined}>
        <ShiftsPage blockOpenShift={isPhone} />
      </div>
    </>
  );
}

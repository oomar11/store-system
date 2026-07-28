"use client";

import { BottomNav } from "@/components/mobile/BottomNav";

export function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mobile-app">
      <div className="mobile-app__inner">{children}</div>
      <BottomNav />
    </div>
  );
}

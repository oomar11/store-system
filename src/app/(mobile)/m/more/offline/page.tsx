"use client";

import { OfflineQueuePanel } from "@/components/offline/OfflineQueuePanel";
import { SyncCenterPanel } from "@/components/offline/SyncCenterPanel";
import { MobileHeader } from "@/components/mobile/MobileHeader";

export default function MobileOfflineQueuePage() {
  return (
    <>
      <MobileHeader title="مزامنة أوفلاين" subtitle="بيانات الجهاز والطابور" />
      <div className="mobile-page space-y-4">
        <SyncCenterPanel />
        <OfflineQueuePanel />
      </div>
    </>
  );
}

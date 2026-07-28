"use client";

import { OfflineQueuePanel } from "@/components/offline/OfflineQueuePanel";
import { SyncCenterPanel } from "@/components/offline/SyncCenterPanel";

export default function OfflineQueuePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-black text-[var(--foreground)]">
          مركز المزامنة والأوفلاين
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          البيانات محفوظة على الجهاز. عند الاتصال تُزامَن العمليات حسب وقت حدوثها،
          والحذف على جهاز آخر يصل كـ tombstone فلا ترجع الفواتير المحذوفة.
        </p>
      </div>
      <SyncCenterPanel />
      <OfflineQueuePanel />
    </div>
  );
}

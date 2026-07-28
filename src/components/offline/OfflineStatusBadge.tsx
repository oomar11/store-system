"use client";

import Link from "next/link";
import { CloudOff, CloudUpload, Wifi, WifiOff } from "lucide-react";
import { useOffline } from "@/components/offline/OfflineProvider";

export function OfflineStatusBadge({ href = "/offline-queue" }: { href?: string }) {
  const { online, pendingCount, syncing, runSync } = useOffline();

  const label = !online
    ? "أوفلاين"
    : syncing
      ? "مزامنة..."
      : pendingCount > 0
        ? `${pendingCount} معلّق`
        : "متصل";

  const tone = !online
    ? "bg-[color-mix(in_srgb,var(--warning)_18%,var(--surface))] text-[var(--warning)] ring-[color-mix(in_srgb,var(--warning)_35%,var(--border))]"
    : pendingCount > 0
      ? "bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)] ring-[color-mix(in_srgb,var(--primary)_30%,var(--border))]"
      : "bg-[color-mix(in_srgb,var(--success)_18%,var(--surface))] text-[var(--success)] ring-[color-mix(in_srgb,var(--success)_35%,var(--border))]";

  const Icon = !online ? WifiOff : syncing ? CloudUpload : pendingCount > 0 ? CloudOff : Wifi;

  return (
    <div className="flex items-center gap-1">
      <Link
        href={href}
        title="عمليات أوفلاين المعلّقة"
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 transition hover:opacity-90 ${tone}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </Link>
      {online && pendingCount > 0 && !syncing ? (
        <button
          type="button"
          onClick={() => void runSync()}
          className="rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]"
        >
          مزامنة
        </button>
      ) : null}
    </div>
  );
}

"use client";

import { rangeFromPreset } from "@/lib/reports/dates";
import { cn } from "@/lib/utils";

type TodayDateChipProps = {
  dateFrom: string;
  dateTo: string;
  onApply: (from: string, to: string) => void;
  className?: string;
};

export function TodayDateChip({
  dateFrom,
  dateTo,
  onApply,
  className,
}: TodayDateChipProps) {
  const today = rangeFromPreset("today");
  const isActive = dateFrom === today.from && dateTo === today.to;

  return (
    <button
      type="button"
      onClick={() => onApply(today.from, today.to)}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
        isActive
          ? "bg-[#1473e6] text-white"
          : "border border-[#e7ebf1] bg-white text-[#687386] hover:bg-[#f8faff]",
        className
      )}
    >
      اليوم
    </button>
  );
}

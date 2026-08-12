"use client";

import {
  BUSINESS_LINE_COLORS,
  BUSINESS_LINE_LABELS,
  BUSINESS_LINE_VALUES,
  normalizeBusinessLines,
  type BusinessLine,
} from "@/lib/business-lines";
import { cn } from "@/lib/utils";

export function BusinessLineBadges({
  lines,
  className,
  size = "sm",
}: {
  lines?: BusinessLine[] | string[] | null;
  className?: string;
  size?: "sm" | "md";
}) {
  const normalized = normalizeBusinessLines(lines);
  if (normalized.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {normalized.map((line) => {
        const colors = BUSINESS_LINE_COLORS[line];
        return (
          <span
            key={line}
            className={cn(
              "inline-flex items-center rounded-md border font-bold",
              colors.bg,
              colors.text,
              colors.border,
              size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
            )}
          >
            {BUSINESS_LINE_LABELS[line]}
          </span>
        );
      })}
      {normalized.length > 1 ? (
        <span
          className={cn(
            "inline-flex items-center rounded-md border border-slate-200 bg-slate-50 font-bold text-slate-600",
            size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
          )}
        >
          أكتر من حاجة
        </span>
      ) : null}
    </div>
  );
}

export function BusinessLineEditor({
  value,
  onChange,
  disabled,
}: {
  value: BusinessLine[];
  onChange: (next: BusinessLine[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(normalizeBusinessLines(value));
  return (
    <div className="flex flex-wrap gap-2">
      {BUSINESS_LINE_VALUES.map((line) => {
        const active = selected.has(line);
        const colors = BUSINESS_LINE_COLORS[line];
        return (
          <button
            key={line}
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = new Set(selected);
              if (active) next.delete(line);
              else next.add(line);
              onChange(normalizeBusinessLines(Array.from(next)));
            }}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm font-bold transition disabled:opacity-50",
              active
                ? cn(colors.bg, colors.text, colors.border)
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            {BUSINESS_LINE_LABELS[line]}
          </button>
        );
      })}
    </div>
  );
}

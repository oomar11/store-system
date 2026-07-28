"use client";

import type { ReactNode } from "react";

export type BulkAction = {
  label: string;
  onClick: () => void;
  tone?: "default" | "success" | "warning" | "danger";
  disabled?: boolean;
};

const tones: Record<NonNullable<BulkAction["tone"]>, string> = {
  default:
    "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
  warning:
    "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
  danger:
    "border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
};

interface BulkActionBarProps {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
  children?: ReactNode;
}

export function BulkActionBar({
  count,
  actions,
  onClear,
  children,
}: BulkActionBarProps) {
  if (count <= 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm shadow-sm">
      <span className="font-semibold text-blue-900">
        محدد: {count.toLocaleString("ar-EG")}
      </span>
      {children}
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              tones[action.tone || "default"]
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ms-auto rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100"
      >
        إلغاء التحديد
      </button>
    </div>
  );
}

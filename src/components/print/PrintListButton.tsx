"use client";

import { Printer } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface PrintListButtonProps {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  /** When 0, shows a toast instead of opening an empty print preview. */
  rowCount?: number;
  emptyMessage?: string;
  className?: string;
}

export function PrintListButton({
  onClick,
  label = "طباعة التقرير",
  disabled,
  rowCount,
  emptyMessage = "لا توجد بيانات للطباعة",
  className = "",
}: PrintListButtonProps) {
  const { info } = useToast();

  function handleClick() {
    if (disabled) return;
    if (rowCount !== undefined && rowCount === 0) {
      info(emptyMessage);
      return;
    }
    onClick();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 ${className}`}
    >
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}

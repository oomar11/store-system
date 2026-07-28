"use client";

import { useRef } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

type DateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  type?: "date" | "datetime-local";
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  min?: string;
  max?: string;
};

/**
 * Date / datetime field that opens the native calendar picker on click
 * (instead of forcing digit-by-digit typing).
 */
export function DateField({
  value,
  onChange,
  type = "date",
  className,
  inputClassName,
  disabled,
  required,
  id,
  name,
  min,
  max,
}: DateFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = inputRef.current;
    if (!el || disabled) return;
    try {
      if (typeof el.showPicker === "function") {
        el.showPicker();
        return;
      }
    } catch {
      // fall through
    }
    el.focus();
  }

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        value={value}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        dir="ltr"
        onChange={(e) => onChange(e.target.value)}
        onClick={openPicker}
        className={cn(
          "date-field-input w-full cursor-pointer rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] py-2 pr-3 pl-10 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--primary)] focus:ring-3 focus:ring-[color-mix(in_srgb,var(--primary)_15%,transparent)] disabled:cursor-not-allowed disabled:bg-[var(--surface-subtle)]",
          inputClassName
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label="فتح التقويم"
        onClick={openPicker}
        className="absolute top-1/2 left-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] disabled:opacity-40"
      >
        <CalendarDays className="h-4 w-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}

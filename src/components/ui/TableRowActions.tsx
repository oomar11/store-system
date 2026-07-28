"use client";

import { Copy, Eye, History, Pencil, Power, Printer, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type RowAction = {
  label: string;
  onClick: () => void;
  tone?: "view" | "edit" | "delete" | "history" | "print" | "copy" | "toggle";
  icon?: "eye" | "pencil" | "trash" | "history" | "printer" | "copy" | "power";
  disabled?: boolean;
};

const tones = {
  view: "border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_22%,var(--surface))]",
  edit: "border-[color-mix(in_srgb,var(--warning)_40%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_16%,var(--surface))] text-[color-mix(in_srgb,var(--warning)_85%,var(--foreground))] hover:bg-[color-mix(in_srgb,var(--warning)_24%,var(--surface))]",
  delete: "border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_14%,var(--surface))] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_22%,var(--surface))]",
  history: "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)] hover:bg-[var(--surface-muted)]",
  print: "border-[color-mix(in_srgb,var(--success)_40%,var(--border))] bg-[color-mix(in_srgb,var(--success)_14%,var(--surface))] text-[var(--success)] hover:bg-[color-mix(in_srgb,var(--success)_22%,var(--surface))]",
  copy: "border-[color-mix(in_srgb,#8b5cf6_35%,var(--border))] bg-[color-mix(in_srgb,#8b5cf6_14%,var(--surface))] text-[#a78bfa] hover:bg-[color-mix(in_srgb,#8b5cf6_22%,var(--surface))]",
  toggle: "border-[color-mix(in_srgb,#64748b_35%,var(--border))] bg-[color-mix(in_srgb,#64748b_12%,var(--surface))] text-slate-700 hover:bg-[color-mix(in_srgb,#64748b_20%,var(--surface))]",
};

const icons = {
  eye: Eye,
  pencil: Pencil,
  trash: Trash2,
  history: History,
  printer: Printer,
  copy: Copy,
  power: Power,
};

interface TableRowActionsProps {
  actions: RowAction[];
}

export function TableRowActions({ actions }: TableRowActionsProps) {
  return (
    <div className="flex flex-nowrap items-center gap-1">
      {actions.map((action) => {
        const tone = action.tone || "view";
        const iconKey: keyof typeof icons =
          action.icon ||
          (tone === "edit"
            ? "pencil"
            : tone === "delete"
              ? "trash"
              : tone === "history"
                ? "history"
                : tone === "print"
                  ? "printer"
                  : tone === "copy"
                    ? "copy"
                    : tone === "toggle"
                      ? "power"
                      : "eye");
        const Icon = icons[iconKey];
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
            className={cn(
              "inline-flex h-7 items-center gap-0.5 rounded-md border px-1.5 text-[10px] font-bold leading-none shadow-none transition disabled:cursor-not-allowed disabled:opacity-50 max-lg:h-8 max-lg:px-2",
              tones[tone]
            )}
          >
            <Icon className="h-3 w-3 shrink-0" strokeWidth={2.25} />
            <span className="hidden lg:inline">{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

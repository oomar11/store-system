"use client";

import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import type { RowAction } from "@/components/ui/TableRowActions";

export function MobileStatCard({
  label,
  value,
  meta,
  tone = "blue",
  onClick,
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: "blue" | "orange" | "green" | "slate";
  onClick?: () => void;
}) {
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const actions: RowAction[] = onClick
    ? [{ label: "فتح", tone: "view", icon: "eye", onClick }]
    : [];

  const Tag = onClick ? "button" : "div";
  return (
    <>
      <Tag
        type={onClick ? "button" : undefined}
        className={`mobile-stat mobile-stat--${tone}${onClick ? " mobile-stat--clickable" : ""}`}
        onClick={onClick}
        onContextMenu={
          actions.length
            ? (e) => openMenu(e, toContextMenuItems(actions))
            : undefined
        }
      >
        <span className="mobile-stat__label">{label}</span>
        <strong className="mobile-stat__value">{value}</strong>
        {meta ? <span className="mobile-stat__meta">{meta}</span> : null}
      </Tag>
      {contextMenu}
    </>
  );
}

export function MobileListRow({
  title,
  subtitle,
  amount,
  amountTone,
  onClick,
  trailing,
  actions: extraActions,
}: {
  title: string;
  subtitle?: string;
  amount?: number | string;
  amountTone?: "positive" | "negative" | "muted";
  onClick?: () => void;
  trailing?: React.ReactNode;
  actions?: RowAction[];
}) {
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const actions: RowAction[] =
    extraActions && extraActions.length > 0
      ? extraActions
      : onClick
        ? [{ label: "فتح", tone: "view", icon: "eye", onClick }]
        : [];

  const Tag = onClick ? "button" : "div";
  const amountText =
    typeof amount === "number" ? formatCurrency(amount) : amount;
  return (
    <>
      <Tag
        type={onClick ? "button" : undefined}
        className={`mobile-list-row${onClick ? " mobile-list-row--clickable" : ""}`}
        onClick={onClick}
        onContextMenu={
          actions.length
            ? (e) => openMenu(e, toContextMenuItems(actions))
            : undefined
        }
      >
        <div className="min-w-0 flex-1 text-start">
          <p className="truncate font-semibold text-[var(--foreground)]">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{subtitle}</p>
          ) : null}
        </div>
        {amountText != null ? (
          <span
            className={`mobile-list-row__amount mobile-list-row__amount--${amountTone || "muted"}`}
          >
            {amountText}
          </span>
        ) : null}
        {trailing}
      </Tag>
      {contextMenu}
    </>
  );
}

export function MobileChip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`mobile-chip${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MobileSheet({
  open,
  title,
  onClose,
  children,
  variant = "sheet",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** "sheet" slides up from the bottom; "page" opens as a full screen. */
  variant?: "sheet" | "page";
}) {
  if (!open || typeof document === "undefined") return null;

  const isPage = variant === "page";

  // Portal to body so fixed positioning isn't trapped by ancestors
  // with transform / backdrop-filter (e.g. sticky mobile header).
  return createPortal(
    <div
      className={`mobile-sheet-root${isPage ? " mobile-sheet-root--page" : ""}`}
      role="dialog"
      aria-modal="true"
    >
      {!isPage && (
        <button
          type="button"
          className="mobile-sheet-backdrop"
          aria-label="إغلاق"
          onClick={onClose}
        />
      )}
      <div className={`mobile-sheet${isPage ? " mobile-sheet--page" : ""}`}>
        {isPage ? (
          <div className="mobile-sheet__topbar">
            <button
              type="button"
              className="mobile-sheet__back"
              onClick={onClose}
              aria-label="رجوع"
            >
              <ChevronRight className="h-5 w-5" />
              <span>رجوع</span>
            </button>
            <h2>{title}</h2>
            <span className="mobile-sheet__topbar-spacer" aria-hidden />
          </div>
        ) : (
          <>
            <div className="mobile-sheet__handle" />
            <div className="mobile-sheet__head">
              <h2>{title}</h2>
              <button
                type="button"
                className="mobile-icon-btn"
                onClick={onClose}
              >
                إغلاق
              </button>
            </div>
          </>
        )}
        <div className="mobile-sheet__body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function MobileEmpty({ message }: { message: string }) {
  return (
    <div className="mobile-empty">
      <p>{message}</p>
    </div>
  );
}

export function MobileSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="mobile-skeleton h-16" />
      ))}
    </div>
  );
}

export function MobileSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mobile-section">
      <div className="mobile-section__head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Copy, Eye, History, Pencil, Power, Printer, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RowAction } from "@/components/ui/TableRowActions";

export type ContextMenuItem =
  | (RowAction & { kind?: "action" })
  | { kind: "separator"; label?: string }
  | {
      kind: "label";
      label: string;
    };

type MenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
} | null;

const icons = {
  eye: Eye,
  pencil: Pencil,
  trash: Trash2,
  history: History,
  printer: Printer,
  copy: Copy,
  power: Power,
};

function normalizeItems(items: ContextMenuItem[]): ContextMenuItem[] {
  if (items.length === 0) {
    return [{ kind: "label", label: "لا توجد إجراءات" }];
  }
  return items;
}

function actionIcon(action: RowAction) {
  const tone = action.tone || "view";
  const iconKey =
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
  return icons[iconKey];
}

type ContextMenuHostProps = {
  state: MenuState;
  onClose: () => void;
};

function ContextMenuHost({ state, onClose }: ContextMenuHostProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!state || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    let left = state.x;
    let top = state.y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointerDown(e: MouseEvent | PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [state, onClose]);

  if (!mounted || !state) return null;

  const items = normalizeItems(state.items);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      dir="rtl"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[120] min-w-[11.5rem] max-w-[16rem] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return (
            <div
              key={`sep-${index}`}
              className="my-1 border-t border-[var(--border)]"
              role="separator"
            />
          );
        }
        if (item.kind === "label") {
          return (
            <div
              key={`label-${index}`}
              className="px-3 py-2 text-[11px] font-semibold text-[var(--muted)]"
            >
              {item.label}
            </div>
          );
        }

        const Icon = actionIcon(item);
        const disabled = !!item.disabled;
        return (
          <button
            key={`${item.label}-${index}`}
            type="button"
            role="menuitem"
            disabled={disabled}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-right text-[12px] font-bold transition",
              disabled
                ? "cursor-not-allowed opacity-45"
                : "hover:bg-[var(--surface-muted)] text-[var(--foreground)]"
            )}
            onClick={() => {
              if (disabled) return;
              onClose();
              item.onClick();
            }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={2.25} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}

/** Global host — mount once near app root, or use with useContextMenuController. */
export function ContextMenuLayer({
  state,
  onClose,
}: {
  state: MenuState;
  onClose: () => void;
}) {
  return <ContextMenuHost state={state} onClose={onClose} />;
}

export function useContextMenuController() {
  const [state, setState] = useState<MenuState>(null);
  const close = useCallback(() => setState(null), []);
  const openAt = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    setState({ x, y, items });
  }, []);
  return { state, openAt, close, layer: <ContextMenuLayer state={state} onClose={close} /> };
}

type ContextMenuTargetProps = {
  actions: ContextMenuItem[];
  children: ReactNode;
  className?: string;
  as?: "div" | "tr";
  /** Extra props for the wrapper (e.g. key is handled by parent). */
  onClick?: (e: ReactMouseEvent<HTMLElement>) => void;
};

/**
 * Wraps a row/card and opens the shared context menu on right-click.
 * Renders its own portal menu instance (fine for list rows).
 */
export function ContextMenuTarget({
  actions,
  children,
  className,
  as = "div",
  onClick,
}: ContextMenuTargetProps) {
  const [state, setState] = useState<MenuState>(null);
  const close = useCallback(() => setState(null), []);

  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setState({ x: e.clientX, y: e.clientY, items: actions });
    },
    [actions]
  );

  const Tag = as;

  return (
    <>
      <Tag className={className} onContextMenu={onContextMenu} onClick={onClick}>
        {children}
      </Tag>
      <ContextMenuHost state={state} onClose={close} />
    </>
  );
}

/**
 * Hook: returns onContextMenu handler + menu portal node to render once per page.
 * Prefer this in tables so one portal serves all rows.
 */
export function useRowContextMenu() {
  const [state, setState] = useState<MenuState>(null);
  const close = useCallback(() => setState(null), []);

  const openMenu = useCallback(
    (e: ReactMouseEvent, items: ContextMenuItem[]) => {
      e.preventDefault();
      e.stopPropagation();
      setState({ x: e.clientX, y: e.clientY, items });
    },
    []
  );

  const menu = <ContextMenuHost state={state} onClose={close} />;

  return { openMenu, menu, close };
}

/** Build a stable onContextMenu for a row given its actions. */
export function rowContextMenuProps(
  openMenu: (e: ReactMouseEvent, items: ContextMenuItem[]) => void,
  actions: ContextMenuItem[]
) {
  return {
    onContextMenu: (e: ReactMouseEvent) => openMenu(e, actions),
  };
}

/** Convenience: convert RowAction[] into ContextMenuItem[]. */
export function toContextMenuItems(actions: RowAction[]): ContextMenuItem[] {
  return actions.map((a) => ({ ...a, kind: "action" as const }));
}

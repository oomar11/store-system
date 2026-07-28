"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Package,
  ReceiptText,
  Search,
  ShoppingBag,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import {
  quickSearchTypeLabels,
  runQuickSearch,
  type QuickSearchEntity,
  type QuickSearchResult,
} from "@/lib/global-search";

const DEBOUNCE_MS = 280;
const MIN_CHARS = 1;

const typeIcons: Record<QuickSearchEntity, typeof Package> = {
  product: Package,
  customer: Users,
  supplier: Truck,
  sale: ReceiptText,
  purchase: ShoppingBag,
};

const typeOrder: QuickSearchEntity[] = [
  "product",
  "customer",
  "supplier",
  "sale",
  "purchase",
];

export function QuickSearch({
  autoFocus = false,
  onNavigate,
  className,
}: {
  autoFocus?: boolean;
  onNavigate?: () => void;
  className?: string;
} = {}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [fetchedQuery, setFetchedQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

  useEffect(() => {
    if (debouncedQuery.length < MIN_CHARS) {
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for async search
    setLoading(true);

    void runQuickSearch(supabase, debouncedQuery).then((next) => {
      if (cancelled || requestId !== requestIdRef.current) return;
      setResults(next);
      setFetchedQuery(debouncedQuery);
      setActiveIndex(0);
      setLoading(false);
      setOpen(true);
    });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, supabase]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const activeResults =
    debouncedQuery.length >= MIN_CHARS && fetchedQuery === debouncedQuery
      ? results
      : [];

  const grouped = useMemo(() => {
    return typeOrder
      .map((type) => ({
        type,
        items: activeResults.filter((r) => r.type === type),
      }))
      .filter((g) => g.items.length > 0);
  }, [activeResults]);

  const flatResults = useMemo(
    () => grouped.flatMap((g) => g.items),
    [grouped]
  );

  const trimmedQuery = query.trim();
  const showEmptyHint = open && trimmedQuery.length === 0;
  const searchSettled =
    debouncedQuery.length >= MIN_CHARS && fetchedQuery === debouncedQuery;
  const showNoResults = open && searchSettled && !loading && activeResults.length === 0;

  const showPanel =
    open && trimmedQuery.length >= MIN_CHARS && (loading || searchSettled);

  const goTo = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setResults([]);
      setFetchedQuery("");
      onNavigate?.();
      router.push(href);
    },
    [router, onNavigate]
  );

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;

    if (flatResults[activeIndex]) {
      goTo(flatResults[activeIndex].href);
      return;
    }

    goTo(`/products?q=${encodeURIComponent(q)}`);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showPanel) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) =>
        flatResults.length === 0 ? 0 : (i + 1) % flatResults.length
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) =>
        flatResults.length === 0
          ? 0
          : (i - 1 + flatResults.length) % flatResults.length
      );
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={rootRef} className={className ?? "relative w-full max-w-[360px]"}>
      <form onSubmit={handleSubmit} className="relative block" role="search">
        <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-soft)]" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="بحث سريع عن صنف، عميل، فاتورة..."
          className="h-10 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-subtle)] pr-10 pl-4 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--primary)] focus:bg-[var(--surface)] focus:ring-3 focus:ring-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
          aria-autocomplete="list"
          aria-controls={listId}
          autoComplete="off"
        />
        {loading && (
          <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--primary)]" />
        )}
      </form>

      {(showEmptyHint || showPanel) && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(70vh,420px)] overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-[0_16px_40px_rgba(16,24,40,0.16)]"
        >
          {showEmptyHint && (
            <p className="px-3 py-4 text-center text-xs text-[var(--muted)]">
              ابحث عن صنف، عميل، فاتورة...
            </p>
          )}

          {showPanel && loading && activeResults.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-[var(--muted)]">
              جاري البحث...
            </p>
          )}

          {showNoResults && (
              <div className="px-3 py-5 text-center">
                <p className="text-sm font-bold text-[var(--foreground)]">لا نتائج</p>
                <p className="mt-1.5 text-[11px] text-[var(--muted)]">
                  لا توجد نتائج لـ «{trimmedQuery}»
                </p>
              </div>
            )}

          {showPanel &&
            grouped.map((group) => (
            <div key={group.type} className="mb-1 last:mb-0">
              <p className="px-2.5 py-1.5 text-[10px] font-bold tracking-wide text-[var(--muted-soft)]">
                {quickSearchTypeLabels[group.type]}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const index = flatResults.findIndex(
                    (r) => r.id === item.id && r.type === item.type
                  );
                  const Icon = typeIcons[item.type];
                  const active = index === activeIndex;
                  return (
                    <li
                      key={`${item.type}-${item.id}`}
                      role="option"
                      aria-selected={active}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => goTo(item.href)}
                        className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-right transition-colors ${
                          active
                            ? "bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]"
                            : "text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                            active
                              ? "bg-[var(--surface)] text-[var(--primary)]"
                              : "bg-[var(--surface-subtle)] text-[var(--muted)]"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold">
                            {item.title}
                          </span>
                          <span
                            className={`mt-0.5 block truncate text-[10px] ${
                              active ? "text-[var(--primary)]" : "text-[var(--muted-soft)]"
                            }`}
                          >
                            {item.subtitle}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {showPanel && trimmedQuery.length >= MIN_CHARS && (
            <div className="mt-1 border-t border-[var(--border)] pt-1">
              <Link
                href={`/pos?q=${encodeURIComponent(query.trim())}`}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  setResults([]);
                  setFetchedQuery("");
                  onNavigate?.();
                }}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))]"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                فتح نقطة البيع والبحث عن «{query.trim()}»
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

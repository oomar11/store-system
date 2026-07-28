"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, BellOff, Package } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { LOW_STOCK_REFRESH_EVENT } from "@/lib/inventory";
import {
  fetchLowStockAlerts,
  setProductLowStockNotify,
  type LowStockProduct,
} from "@/lib/low-stock";
import { formatDateShort } from "@/lib/utils";
import { APP_NOTIFICATIONS_REFRESH_EVENT } from "@/lib/shifts";

const POLL_MS = 30_000;

type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationsBell() {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LowStockProduct[]>([]);
  const [appNotes, setAppNotes] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutingId, setMutingId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(supabase);
  supabaseRef.current = supabase;

  const refresh = useCallback(async (showSpinner = false) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    const client = supabaseRef.current;
    try {
      const [alerts, notesRes] = await Promise.all([
        fetchLowStockAlerts(client),
        client
          .from("app_notifications")
          .select("id, type, title, body, link, read_at, created_at")
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      setItems(alerts);
      setAppNotes((notesRes.data as AppNotification[]) || []);
    } catch {
      /* offline / timeout */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const {
        data: { session },
      } = await supabaseRef.current.auth.getSession();
      if (cancelled) return;

      if (!session) {
        setItems([]);
        setAppNotes([]);
        setLoading(false);
        setReady(false);
        return;
      }

      setReady(true);
      await refresh();
    }

    void boot();

    const {
      data: { subscription },
    } = supabaseRef.current.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (!session) {
        setReady(false);
        setItems([]);
        setAppNotes([]);
        setLoading(false);
        return;
      }
      if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED"
      ) {
        setReady(true);
        void refresh();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const pollId = window.setInterval(() => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(pollId);
  }, [ready, refresh]);

  useEffect(() => {
    if (!ready) return;

    const channel = supabaseRef.current
      .channel("alerts-and-notifications")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => {
          void refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_notifications" },
        () => {
          void refresh();
        }
      )
      .subscribe();

    function onLocalStockChange() {
      void refresh();
    }

    function onVisibility() {
      if (document.visibilityState === "visible") void refresh();
    }

    window.addEventListener(LOW_STOCK_REFRESH_EVENT, onLocalStockChange);
    window.addEventListener(APP_NOTIFICATIONS_REFRESH_EVENT, onLocalStockChange);
    window.addEventListener("focus", onLocalStockChange);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      void supabaseRef.current.removeChannel(channel);
      window.removeEventListener(LOW_STOCK_REFRESH_EVENT, onLocalStockChange);
      window.removeEventListener(
        APP_NOTIFICATIONS_REFRESH_EVENT,
        onLocalStockChange
      );
      window.removeEventListener("focus", onLocalStockChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, refresh]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleMute(productId: string) {
    setMutingId(productId);
    const { error } = await setProductLowStockNotify(supabase, productId, false);
    if (!error) {
      setItems((prev) => prev.filter((p) => p.id !== productId));
    }
    setMutingId(null);
  }

  async function markNoteRead(id: string) {
    await supabase
      .from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
    setAppNotes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n
      )
    );
  }

  const unreadApp = appNotes.filter((n) => !n.read_at).length;
  const stockCount = items.length;
  const count = unreadApp + stockCount;
  const badgeLabel = count > 99 ? "99+" : String(count);
  // Hide dismissed shift_abandoned so they leave the list after ack
  const visibleAppNotes = appNotes.filter(
    (n) => n.type !== "shift_abandoned" || !n.read_at
  );

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void refresh(true);
        }}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] hover:text-[var(--primary)]"
        aria-label={count > 0 ? `إشعارات (${count})` : "الإشعارات"}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 && (
          <span className="absolute -left-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[var(--surface)]">
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_16px_40px_rgba(16,24,40,0.16)]"
          role="menu"
        >
          <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)] px-3.5 py-2.5">
            <p className="text-sm font-bold text-[var(--foreground)]">الإشعارات</p>
            <p className="text-[11px] text-[var(--muted)]">
              {loading
                ? "جاري التحديث..."
                : count === 0
                  ? "لا توجد تنبيهات حالياً"
                  : `${unreadApp} تنبيه · ${stockCount} نقص مخزون`}
            </p>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && appNotes.length === 0 && items.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]" />
              </div>
            ) : (
              <>
                {visibleAppNotes.length > 0 && (
                  <div>
                    <p className="bg-[color-mix(in_srgb,var(--warning)_16%,var(--surface))] px-3.5 py-1.5 text-[10px] font-bold text-[var(--warning)]">
                      تنبيهات الوردية والنظام
                    </p>
                    <ul className="divide-y divide-[var(--border)]">
                      {visibleAppNotes.map((n) => (
                        <li key={n.id}>
                          <Link
                            href={n.link || "/shifts"}
                            onClick={() => {
                              // shift_abandoned: only dismiss via «تم الاطلاع» on detail page
                              if (n.type !== "shift_abandoned") {
                                void markNoteRead(n.id);
                              }
                              setOpen(false);
                            }}
                            className={`flex items-start gap-2 px-3 py-2.5 hover:bg-[var(--surface-subtle)] ${
                              n.read_at ? "opacity-70" : ""
                            }`}
                          >
                            <AlertTriangle
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                n.read_at ? "text-[var(--muted-soft)]" : "text-[var(--warning)]"
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-[var(--foreground)]">
                                {n.title}
                                {!n.read_at && (
                                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
                                )}
                              </p>
                              {n.body && (
                                <p className="mt-0.5 text-[11px] leading-5 text-[var(--muted)]">
                                  {n.body}
                                </p>
                              )}
                              <p className="mt-1 text-[10px] text-[var(--muted-soft)]">
                                {formatDateShort(n.created_at)}
                              </p>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between bg-[var(--surface-subtle)] px-3.5 py-1.5">
                    <p className="text-[10px] font-bold text-[var(--muted)]">
                      نواقص المخزون
                    </p>
                    <Link
                      href="/products"
                      onClick={() => setOpen(false)}
                      className="text-[11px] font-semibold text-[var(--primary)]"
                    >
                      الأصناف
                    </Link>
                  </div>
                  {items.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                      <Package className="h-7 w-7 text-[var(--muted-soft)]" />
                      <p className="text-xs text-[var(--muted)]">
                        لا توجد نواقص تحتاج تنبيهاً
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-[var(--border)]">
                      {items.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-start gap-2 px-3 py-2.5 hover:bg-[var(--surface-subtle)]"
                        >
                          <Link
                            href={`/products/${p.id}`}
                            onClick={() => setOpen(false)}
                            className="min-w-0 flex-1"
                          >
                            <p className="truncate text-xs font-bold text-[var(--foreground)]">
                              {p.name}
                            </p>
                            <p className="mt-0.5 text-[10px] text-[var(--muted)]" dir="ltr">
                              {p.sku || "—"}
                            </p>
                            <p className="mt-1 text-[11px] font-semibold text-[#c2410c]">
                              المتاح {p.quantity} {p.unit} · الحد {p.min_quantity}
                            </p>
                          </Link>
                          <button
                            type="button"
                            title="إيقاف تنبيه هذا الصنف"
                            disabled={mutingId === p.id}
                            onClick={() => handleMute(p.id)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] text-[var(--muted)] hover:border-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))] hover:text-[var(--danger)] disabled:opacity-50"
                          >
                            <BellOff className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

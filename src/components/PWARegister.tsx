"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  isBrowserOnline,
  isOfflinePackReady,
  scheduleBackgroundSync,
  SERWIST_SW_URL,
} from "@/lib/offline";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true
  );
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    // Prefer Serwist build-time SW; fall back to legacy public/sw.js
    try {
      return await navigator.serviceWorker.register(SERWIST_SW_URL, {
        updateViaCache: "none",
        scope: "/",
      });
    } catch {
      return await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
    }
  } catch (error) {
    console.log("SW registration failed:", error);
    return null;
  }
}

export function PWARegister() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [showIosHint, setShowIosHint] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null
  );
  const [installBusy, setInstallBusy] = useState(false);

  useEffect(() => {
    let registration: ServiceWorkerRegistration | null = null;
    let warmTimer: number | undefined;

    void registerServiceWorker().then((reg) => {
      if (!reg) return;
      registration = reg;
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      if (reg.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(reg.waiting);
        setUpdateReady(true);
      }
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") {
            if (navigator.serviceWorker.controller) {
              installing.postMessage({ type: "SKIP_WAITING" });
              setWaitingWorker(reg.waiting);
              setUpdateReady(true);
            }
          }
        });
      });

      if (isBrowserOnline()) {
        warmTimer = window.setTimeout(() => {
          void (async () => {
            const ready = await isOfflinePackReady();
            if (!ready) return;
            // OfflineProvider owns sync; only nudge a debounced background pass
            scheduleBackgroundSync(500);
          })();
        }, 2000);
      }
    });

    const onOnline = () => {
      void (async () => {
        const ready = await isOfflinePackReady();
        if (!ready) return;
        scheduleBackgroundSync(500);
      })();
    };
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("online", onOnline);
      if (warmTimer) window.clearTimeout(warmTimer);
      void registration;
    };
  }, []);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    if (isIos() && !isStandalone()) {
      const dismissed = sessionStorage.getItem("windoor-ios-install-dismissed");
      if (!dismissed) setShowIosHint(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  async function promptInstall() {
    if (!deferred) return;
    setInstallBusy(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    } finally {
      setInstallBusy(false);
    }
  }

  function applyUpdate() {
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    window.location.reload();
  }

  if (updateReady) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-3 shadow-lg sm:left-auto">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm font-semibold text-[var(--foreground)]">
            تحديث جديد للتطبيق جاهز
          </p>
          <button
            type="button"
            onClick={applyUpdate}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white"
          >
            تحديث
          </button>
        </div>
      </div>
    );
  }

  if (deferred && !isStandalone()) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-3 shadow-lg sm:left-auto">
        <div className="flex items-center gap-3">
          <Download className="h-5 w-5 shrink-0 text-[var(--primary)]" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              ثبّت ويندور كتطبيق على جهازك
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
              افتح التطبيق بسرعة من الشاشة الرئيسية
            </p>
          </div>
          <button
            type="button"
            disabled={installBusy}
            onClick={() => void promptInstall()}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
          >
            تثبيت
          </button>
          <button
            type="button"
            onClick={() => setDeferred(null)}
            className="rounded-lg p-2 text-[var(--muted)]"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-3 shadow-lg">
        <div className="flex items-start gap-3">
          <Download className="mt-0.5 h-5 w-5 shrink-0 text-[var(--primary)]" />
          <div className="flex-1 text-sm text-[var(--foreground)]">
            <p className="font-bold">تثبيت على الآيفون</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              من زر المشاركة ← «إضافة إلى الشاشة الرئيسية»
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              sessionStorage.setItem("windoor-ios-install-dismissed", "1");
              setShowIosHint(false);
            }}
            className="rounded-lg p-2 text-[var(--muted)]"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}

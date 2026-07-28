"use client";

import { useEffect, useState } from "react";
import {
  getDeviceState,
  getStorageEstimate,
  isClockSkewUnsafe,
  getClockOffsetMs,
  listSyncOutbox,
  getInstalledDataPackVersion,
} from "@/lib/offline";
import { useOffline } from "@/components/offline/OfflineProvider";
import { createClient } from "@/lib/supabase";
import { RefreshCw, Database, Clock, HardDrive, Wifi, WifiOff } from "lucide-react";

export function SyncCenterPanel() {
  const { online, pendingCount, syncing, lastSyncResult, runSync, refreshQueue } =
    useOffline();
  const [checkpoint, setCheckpoint] = useState(0);
  const [bootstrapped, setBootstrapped] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(
    null
  );
  const [superseded, setSuperseded] = useState(0);
  const [packVersion, setPackVersion] = useState<number | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const skew = isClockSkewUnsafe();

  async function refreshMeta() {
    const state = await getDeviceState();
    setCheckpoint(state?.checkpoint ?? 0);
    setBootstrapped(state?.bootstrapped_at ?? null);
    setLastSync(state?.last_sync_at ?? null);
    setPersisted(state?.storage_persisted ?? null);
    setStorage(await getStorageEstimate());
    const all = await listSyncOutbox({ includeSynced: true });
    setSuperseded(all.filter((e) => e.status === "superseded").length);
    setPackVersion(await getInstalledDataPackVersion());
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { getOfflineSession } = await import("@/lib/offline/auth-session");
    const offline = await getOfflineSession();
    setNeedsReauth(Boolean(offline && !session));
    await refreshQueue();
  }

  useEffect(() => {
    void refreshMeta();
  }, [lastSyncResult, pendingCount]);

  async function handleSync() {
    const supabase = createClient();
    await runSync();
    await refreshMeta();
    void supabase;
  }

  const usageMb = storage ? (storage.usage / (1024 * 1024)).toFixed(1) : "—";
  const quotaMb = storage ? (storage.quota / (1024 * 1024)).toFixed(0) : "—";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--muted)]">
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            الاتصال
          </div>
          <p className="mt-2 text-lg font-black text-[var(--foreground)]">
            {online ? "متصل" : "بدون نت"}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--muted)]">
            <Database className="h-3.5 w-3.5" />
            عمليات معلّقة
          </div>
          <p className="mt-2 text-lg font-black text-[var(--foreground)]">
            {pendingCount}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--muted)]">
            <Clock className="h-3.5 w-3.5" />
            ساعة الجهاز
          </div>
          <p className="mt-2 text-lg font-black text-[var(--foreground)]">
            {skew ? "انحراف كبير" : "متزامنة"}
          </p>
          <p className="text-[10px] text-[var(--muted)]">
            فرق: {Math.round(getClockOffsetMs())} ms
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--muted)]">
            <HardDrive className="h-3.5 w-3.5" />
            تخزين الجهاز
          </div>
          <p className="mt-2 text-lg font-black text-[var(--foreground)]">
            {usageMb} / {quotaMb} MB
          </p>
          <p className="text-[10px] text-[var(--muted)]">
            {persisted === true
              ? "محمي من المسح التلقائي"
              : persisted === false
                ? "غير محمي بالكامل"
                : "حالة الحماية غير معروفة"}
          </p>
        </div>
      </div>

      {needsReauth ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          أنت داخل بحساب أوفلاين. لرفع العمليات المعلّقة سجّل دخولاً أونلاين
          بنفس المستخدم — العمليات محفوظة على الجهاز ولن تُفقد.
        </div>
      ) : null}

      {skew ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ساعة الجهاز منحرفة عن السيرفر بأكثر من 10 دقائق. صحّح وقت Windows ثم
          اضغط مزامنة. المزامنة متوقفة لحماية ترتيب العمليات.
        </div>
      ) : null}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 text-[var(--muted)]">
            <p>
              آخر مزامنة:{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {lastSync
                  ? new Date(lastSync).toLocaleString("ar-EG")
                  : "لم تتم بعد"}
              </span>
            </p>
            <p>
              نقطة التزامن:{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {checkpoint}
              </span>
            </p>
            <p>
              تنزيل أولي:{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {bootstrapped
                  ? new Date(bootstrapped).toLocaleString("ar-EG")
                  : "غير مكتمل"}
              </span>
            </p>
            <p>
              إصدار حزمة البيانات:{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {packVersion ?? "—"}
              </span>
            </p>
            {lastSyncResult ? (
              <p>
                آخر نتيجة: تم {lastSyncResult.synced} · تجاوز{" "}
                {lastSyncResult.superseded ?? superseded} · تعارض{" "}
                {lastSyncResult.conflicts} · سحب {lastSyncResult.pulled ?? 0}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={syncing || !online || skew || needsReauth}
            onClick={() => void handleSync()}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "جاري المزامنة…" : "مزامنة الآن"}
          </button>
          <button
            type="button"
            onClick={() => {
              void import("@/lib/offline/local-backup").then((m) =>
                m.downloadLocalBackup()
              );
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-xs font-bold"
          >
            تصدير نسخة محلية
          </button>
        </div>
      </div>
    </div>
  );
}

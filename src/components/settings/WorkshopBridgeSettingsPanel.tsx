"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useToast } from "@/components/ui/Toast";

type BridgeStatus = {
  configured: boolean;
  source: "env" | "db" | "none";
  secret_masked: string;
  env_overrides_db: boolean;
  hint: string;
};

export function WorkshopBridgeSettingsPanel() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState("");
  const [manual, setManual] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/workshop-bridge", {
        cache: "no-store",
      });
      const json = (await res.json()) as BridgeStatus & { error?: string };
      if (!res.ok) throw new Error(json.error || "فشل التحميل");
      setStatus(json);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "فشل تحميل حالة الجسر");
    }
  }, [toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setRevealed("");
    try {
      const res = await fetch("/api/settings/workshop-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        secret?: string;
        message?: string;
        warning?: string | null;
        configured?: boolean;
        source?: BridgeStatus["source"];
        secret_masked?: string;
        env_overrides_db?: boolean;
        hint?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "فشل التوليد");
      if (json.secret) setRevealed(json.secret);
      setStatus({
        configured: Boolean(json.configured),
        source: json.source || "db",
        secret_masked: json.secret_masked || "",
        env_overrides_db: Boolean(json.env_overrides_db),
        hint: json.warning || json.message || "",
      });
      toastSuccess(json.message || "تم توليد المفتاح");
      if (json.warning) toastError(json.warning);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "فشل التوليد");
    } finally {
      setBusy(false);
    }
  }

  async function saveManual() {
    setBusy(true);
    setRevealed("");
    try {
      const res = await fetch("/api/settings/workshop-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", secret: manual }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        secret?: string;
        message?: string;
        warning?: string | null;
        configured?: boolean;
        source?: BridgeStatus["source"];
        secret_masked?: string;
        env_overrides_db?: boolean;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "فشل الحفظ");
      if (json.secret) setRevealed(json.secret);
      setManual("");
      setStatus({
        configured: Boolean(json.configured),
        source: json.source || "db",
        secret_masked: json.secret_masked || "",
        env_overrides_db: Boolean(json.env_overrides_db),
        hint: json.warning || json.message || "",
      });
      toastSuccess(json.message || "تم الحفظ");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "فشل الحفظ");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toastSuccess("تم النسخ");
    } catch {
      toastError("تعذر النسخ — انسخه يدويًا");
    }
  }

  return (
    <SettingsCard
      title="جسر الورش (PVC / بلسية)"
      description="المفتاح ده بيستخدمه ورشة PVC والبليسيه عشان يسجّلوا الخزنة والعملاء على المحل."
      icon={KeyRound}
    >
      <div className="space-y-4">
        <div
          className={`rounded-xl border px-3 py-2.5 text-sm ${
            status?.configured
              ? "border-emerald-300/70 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-amber-300/80 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          }`}
        >
          <p className="font-bold">
            {status?.configured ? "الجسر مضبوط ✓" : "الجسر غير مضبوط"}
          </p>
          <p className="mt-1 text-xs leading-5 opacity-90">
            {status?.hint || "جاري التحميل…"}
          </p>
          {status?.secret_masked ? (
            <p className="mt-1 font-mono text-xs" dir="ltr">
              {status.secret_masked}
              {status.source === "env" ? " (من Vercel)" : ""}
            </p>
          ) : null}
        </div>

        {revealed ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-3">
            <p className="text-xs font-bold text-[var(--foreground)]">
              انسخ المفتاح الآن (مش هيظهر تاني كامل)
            </p>
            <p
              className="mt-2 break-all font-mono text-sm text-[var(--foreground)]"
              dir="ltr"
            >
              {revealed}
            </p>
            <button
              type="button"
              onClick={() => void copyText(revealed)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
            >
              <Copy className="h-3.5 w-3.5" />
              نسخ المفتاح
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            توليد مفتاح جديد
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            تحديث الحالة
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-bold text-[var(--muted)]">
            أو الصق مفتاح جاهز (16+ حرف)
          </label>
          <input
            type="text"
            dir="ltr"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="paste secret…"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-mono text-sm"
          />
          <button
            type="button"
            disabled={busy || manual.trim().length < 16}
            onClick={() => void saveManual()}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            حفظ المفتاح
          </button>
        </div>

        <p className="text-xs leading-5 text-[var(--muted)]">
          بعد التوليد: افتح إعدادات ورشة PVC أو البلسية ← «ربط المحل» ← الصق
          نفس المفتاح مع رابط{" "}
          <span className="font-mono" dir="ltr">
            https://store-system-rho.vercel.app
          </span>
        </p>
      </div>
    </SettingsCard>
  );
}

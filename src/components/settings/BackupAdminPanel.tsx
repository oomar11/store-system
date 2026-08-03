"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  Send,
  ShieldAlert,
  MessageCircle,
  Loader2,
  Save,
  HardDrive,
  Bot,
  Link2,
  Unlink,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { clearLocalBusinessData } from "@/lib/offline";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { SettingsCard } from "@/components/settings/SettingsCard";

type BackupRun = {
  id: string;
  source: string;
  status: string;
  byte_size: number | null;
  error_message: string | null;
  created_at: string;
};

type TelegramPublic = {
  chat_id: string;
  bot_token_masked: string;
  configured: boolean;
  source: string;
  editable_chat_id: string;
};

type AiSetupStatus = {
  telegram_configured: boolean;
  gemini_configured: boolean;
  webhook_secret_configured: boolean;
  webhook_url: string;
  model: string;
  webhook: {
    ok?: boolean;
    url?: string;
    pending_update_count?: number;
    last_error_message?: string;
    description?: string;
  } | null;
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "يدوي",
  cron: "تلقائي",
  telegram: "تيليجرام",
  restore: "استعادة",
  factory_reset: "إعادة ضبط",
};

function formatBytes(n: number | null) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupAdminPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { success: toastSuccess, error: toastError } = useToast();

  const [lastRun, setLastRun] = useState<BackupRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [tgChatId, setTgChatId] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [tgMeta, setTgMeta] = useState<TelegramPublic | null>(null);
  const [aiStatus, setAiStatus] = useState<AiSetupStatus | null>(null);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoreRaw, setRestoreRaw] = useState<string | null>(null);
  const [restoreMeta, setRestoreMeta] = useState("");

  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");

  const flash = useCallback(
    (type: "ok" | "err", text: string) => {
      if (type === "ok") toastSuccess(text);
      else toastError(text);
    },
    [toastSuccess, toastError]
  );

  const loadLastRun = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("backup_runs")
      .select("id, source, status, byte_size, error_message, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastRun((data as BackupRun | null) ?? null);
  }, []);

  const loadTelegram = useCallback(async () => {
    try {
      const res = await fetch("/api/backup/telegram-config");
      if (!res.ok) return;
      const data = (await res.json()) as TelegramPublic;
      setTgMeta(data);
      setTgChatId(data.editable_chat_id || "");
      setTgToken("");
    } catch {
      // ignore
    }
  }, []);

  const loadAiStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/telegram/ai-setup");
      if (!res.ok) return;
      const data = (await res.json()) as AiSetupStatus;
      setAiStatus(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadLastRun();
    loadTelegram();
    loadAiStatus();
  }, [loadLastRun, loadTelegram, loadAiStatus]);

  async function aiAction(action: "register" | "unregister" | "test") {
    setBusy(`ai-${action}`);
    try {
      const res = await fetch("/api/telegram/ai-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "فشل العملية");
      if (action === "register") {
        flash("ok", "تم تفعيل مساعد جارفس على تيليجرام");
      } else if (action === "unregister") {
        flash("ok", "تم إيقاف webhook المساعد");
      } else {
        flash("ok", "تم إرسال رسالة اختبار المساعد");
      }
      await loadAiStatus();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "فشل العملية");
    } finally {
      setBusy(null);
    }
  }

  async function saveTelegram() {
    setBusy("save-tg");
    try {
      const res = await fetch("/api/backup/telegram-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChatId,
          bot_token: tgToken.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "فشل حفظ إعدادات تيليجرام");
      setTgMeta(data as TelegramPublic);
      setTgToken("");
      const branding = data.branding as
        | {
            name_ok?: boolean;
            photo_ok?: boolean;
            name?: string;
            errors?: string[];
          }
        | null
        | undefined;
      if (branding) {
        const parts: string[] = ["تم الحفظ"];
        if (branding.name_ok) {
          parts.push(`اسم البوت: ${branding.name || "تم"}`);
        }
        if (branding.photo_ok) {
          parts.push("تم تحديث صورة البوت");
        } else if (branding.errors?.length) {
          parts.push(branding.errors[0]);
        }
        flash(
          branding.name_ok || branding.photo_ok ? "ok" : "err",
          parts.join(" · ")
        );
      } else {
        flash("ok", "تم حفظ إعدادات بوت تيليجرام");
      }
      await loadTelegram();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "فشل الحفظ");
    } finally {
      setBusy(null);
    }
  }

  async function downloadBackup() {
    setBusy("download");
    try {
      const res = await fetch("/api/backup/export", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "فشل التحميل");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(cd);
      const name =
        match?.[1] || `backup-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      flash("ok", "تم تحميل النسخة الاحتياطية");
      await loadLastRun();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "فشل التحميل");
    } finally {
      setBusy(null);
    }
  }

  async function sendTelegram() {
    setBusy("telegram");
    try {
      const res = await fetch("/api/backup/export?send=telegram", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "فشل الإرسال");
      flash("ok", "تم إرسال النسخة إلى تيليجرام");
      await loadLastRun();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "فشل الإرسال");
    } finally {
      setBusy(null);
    }
  }

  async function testTelegram() {
    setBusy("test");
    try {
      const res = await fetch("/api/backup/telegram-test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "فشل الاختبار");
      const branding = data.branding as
        | { name_ok?: boolean; photo_ok?: boolean; name?: string }
        | undefined;
      const extra = branding?.name_ok
        ? ` · تم ضبط الاسم${branding.photo_ok ? " والصورة" : ""}`
        : "";
      flash("ok", `وصلت رسالة الاختبار على تيليجرام${extra}`);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "فشل الاختبار");
    } finally {
      setBusy(null);
    }
  }

  function onPickFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      try {
        const parsed = JSON.parse(text);
        setRestoreRaw(text);
        setRestoreMeta(
          `${parsed.store_name || "—"} · ${parsed.exported_at || "—"}`
        );
        setRestoreConfirm("");
        setRestoreOpen(true);
      } catch {
        flash("err", "الملف ليس JSON صالحاً");
      }
    };
    reader.readAsText(file, "utf-8");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function confirmRestore() {
    if (!restoreRaw) return;
    setBusy("restore");
    try {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: restoreConfirm.trim(),
          backup: restoreRaw,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "فشل الاستعادة");
      await clearLocalBusinessData();
      setRestoreOpen(false);
      setRestoreRaw(null);
      flash("ok", "تمت الاستعادة بنجاح — سيتم تحديث الصفحة");
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1200);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "فشل الاستعادة");
    } finally {
      setBusy(null);
    }
  }

  async function confirmReset() {
    setBusy("reset");
    try {
      const res = await fetch("/api/backup/factory-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: resetConfirm.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "فشل إعادة الضبط");
      await clearLocalBusinessData();
      setResetOpen(false);
      flash(
        "ok",
        data.backup_sent
          ? "اتبعت باك أب على تيليجرام وتمت إعادة الضبط — جاري تحديث الصفحة"
          : "تمت إعادة ضبط المصنع — سيتم تحديث الصفحة"
      );
      setTimeout(() => {
        window.location.replace(`/dashboard?fresh=${Date.now()}`);
      }, 800);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "فشل إعادة الضبط");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <SettingsCard
        title="بوت تيليجرام"
        description="أدخل توكن البوت من BotFather ورقم الـ Chat ID. بعد الحفظ، السيستم يحدّث اسم البوت وصورته تلقائياً من اسم المحل. الإعدادات دي مش بتتأثر بإعادة ضبط المصنع."
        icon={MessageCircle}
      >
        {tgMeta && (
          <p className="mb-3 text-xs text-[var(--muted)]">
            الحالة:{" "}
            <span
              className={
                tgMeta.configured
                  ? "font-medium text-green-700"
                  : "text-amber-700"
              }
            >
              {tgMeta.configured ? "مضبوط" : "غير مضبوط"}
            </span>
            {tgMeta.source !== "none" && (
              <>
                {" "}
                · المصدر:{" "}
                {tgMeta.source === "database" ? "الإعدادات" : "متغيرات البيئة"}
              </>
            )}
            {tgMeta.bot_token_masked ? (
              <> · التوكن الحالي: {tgMeta.bot_token_masked}</>
            ) : null}
          </p>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Bot Token
            </label>
            <input
              type="password"
              autoComplete="off"
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              placeholder={
                tgMeta?.bot_token_masked
                  ? "اتركه فارغاً للإبقاء على التوكن الحالي"
                  : "123456:ABC-DEF..."
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
              disabled={!!busy}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Chat ID
            </label>
            <input
              type="text"
              value={tgChatId}
              onChange={(e) => setTgChatId(e.target.value)}
              placeholder="مثال: 123456789"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
              disabled={!!busy}
            />
          </div>
          <button
            type="button"
            disabled={!!busy}
            onClick={saveTelegram}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {busy === "save-tg" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            حفظ إعدادات التيليجرام
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        title="مساعد جارفس (تيليجرام + Gemini)"
        description="اسأل عن المبيعات والمخزون والأرصدة والخزنة من تيليجرام. قراءة وتحليل فقط — بدون تعديل بيانات. يتطلب GEMINI_API_KEY و TELEGRAM_WEBHOOK_SECRET في بيئة Vercel."
        icon={Bot}
      >
        {aiStatus && (
          <div className="mb-4 space-y-1 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--muted)]">
            <div>
              Gemini:{" "}
              <span
                className={
                  aiStatus.gemini_configured
                    ? "font-medium text-green-700"
                    : "font-medium text-red-700"
                }
              >
                {aiStatus.gemini_configured
                  ? `جاهز (${aiStatus.model})`
                  : "غير مضبوط"}
              </span>
            </div>
            <div>
              Webhook secret:{" "}
              <span
                className={
                  aiStatus.webhook_secret_configured
                    ? "font-medium text-green-700"
                    : "font-medium text-amber-700"
                }
              >
                {aiStatus.webhook_secret_configured ? "مضبوط" : "ناقص"}
              </span>
            </div>
            <div>
              Webhook:{" "}
              <span className="font-medium text-[var(--foreground)] break-all">
                {aiStatus.webhook?.url || "غير مسجّل"}
              </span>
              {aiStatus.webhook?.last_error_message ? (
                <span className="mt-1 block text-red-600">
                  {aiStatus.webhook.last_error_message}
                </span>
              ) : null}
            </div>
            <div className="text-[10px] opacity-80 break-all">
              الهدف: {aiStatus.webhook_url}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => aiAction("register")}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {busy === "ai-register" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            تفعيل المساعد
          </button>

          <button
            type="button"
            disabled={!!busy}
            onClick={() => aiAction("test")}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
          >
            {busy === "ai-test" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bot className="h-4 w-4" />
            )}
            اختبار رسالة
          </button>

          <button
            type="button"
            disabled={!!busy}
            onClick={() => aiAction("unregister")}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === "ai-unregister" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Unlink className="h-4 w-4" />
            )}
            إيقاف الـ webhook
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        title="النسخ الاحتياطي"
        description="تحميل أو إرسال نسخة كاملة من بيانات المحل (بدون المستخدمين). النسخ التلقائي اليومي يُرسل عبر تيليجرام بعد ضبط البوت أعلاه."
        icon={HardDrive}
      >
        {lastRun && (
          <div className="mb-4 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--muted)]">
            آخر تشغيل:{" "}
            <span className="font-medium text-[var(--foreground)]">
              {SOURCE_LABELS[lastRun.source] || lastRun.source}
            </span>{" "}
            ·{" "}
            <span
              className={
                lastRun.status === "success" ? "text-green-700" : "text-red-700"
              }
            >
              {lastRun.status === "success" ? "نجاح" : "فشل"}
            </span>{" "}
            · {formatBytes(lastRun.byte_size)} ·{" "}
            {new Date(lastRun.created_at).toLocaleString("ar-EG")}
            {lastRun.error_message ? (
              <span className="mt-1 block text-red-600">
                {lastRun.error_message}
              </span>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={downloadBackup}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {busy === "download" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            تحميل JSON
          </button>

          <button
            type="button"
            disabled={!!busy}
            onClick={sendTelegram}
            className="inline-flex items-center gap-2 rounded-lg border border-sky-600 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
          >
            {busy === "telegram" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            إرسال لتيليجرام
          </button>

          <button
            type="button"
            disabled={!!busy}
            onClick={testTelegram}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === "test" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4" />
            )}
            اختبار تيليجرام
          </button>

          <button
            type="button"
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-600 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            استعادة من ملف
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </SettingsCard>

      <div
        className="settings-card"
        style={{
          borderColor: "color-mix(in srgb, var(--danger) 40%, var(--border))",
          background:
            "color-mix(in srgb, var(--danger) 10%, var(--surface))",
        }}
      >
        <div className="settings-card__header border-[color-mix(in_srgb,var(--danger)_25%,var(--border))]">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[color-mix(in_srgb,var(--danger)_16%,var(--surface))] text-[var(--danger)]">
              <ShieldAlert className="h-[18px] w-[18px]" />
            </span>
            <div>
              <h2 className="settings-card__title text-[var(--danger)]">
                إعادة ضبط المصنع
              </h2>
              <p className="settings-card__desc text-[color-mix(in_srgb,var(--danger)_75%,var(--foreground))]">
                قبل المسح بيتبعت باك أب تلقائي على تيليجرام، وبعدين يتمسح كل
                بيانات التشغيل (الأصناف والعملاء والفواتير…) مع مسح الكاش المحلي.
                المستخدمين وإعدادات تيليجرام يفضلوا. لازم تيليجرام يكون مضبوط.
              </p>
            </div>
          </div>
        </div>
        <div className="settings-card__body">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              setResetConfirm("");
              setResetOpen(true);
            }}
            className="rounded-xl bg-[var(--danger)] px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            إعادة ضبط المصنع…
          </button>
        </div>
      </div>

      <Modal
        open={restoreOpen}
        onClose={() => !busy && setRestoreOpen(false)}
        title="تأكيد الاستعادة"
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-gray-600">
            سيتم <strong>مسح كل البيانات الحالية</strong> واستبدالها بمحتوى
            الملف. المستخدمون لن يُمسحوا.
          </p>
          {restoreMeta && (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">
              {restoreMeta}
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              للتأكيد اكتب: <span className="font-bold">استعادة</span>
            </label>
            <input
              value={restoreConfirm}
              onChange={(e) => setRestoreConfirm(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="استعادة"
              disabled={!!busy}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setRestoreOpen(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={!!busy || restoreConfirm.trim() !== "استعادة"}
              onClick={confirmRestore}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === "restore" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              تنفيذ الاستعادة
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => !busy && setResetOpen(false)}
        title="تأكيد إعادة ضبط المصنع"
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-[var(--danger)]">
            أولاً هيتبعت باك أب كامل على تيليجرام، وبعدين كل بيانات المحل
            هتتمسح نهائياً (أصناف، عملاء، فواتير…) ما عدا حسابات المستخدمين
            وإعدادات تيليجرام. لو فشل الإرسال، المسح مش هيتم.
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
              للتأكيد اكتب: <span className="font-bold">مسح الكل</span>
            </label>
            <input
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--danger)] focus:outline-none"
              placeholder="مسح الكل"
              disabled={!!busy}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setResetOpen(false)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--foreground)]"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={!!busy || resetConfirm.trim() !== "مسح الكل"}
              onClick={confirmReset}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === "reset" && <Loader2 className="h-4 w-4 animate-spin" />}
              تأكيد المسح
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

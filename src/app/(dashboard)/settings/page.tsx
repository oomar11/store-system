"use client";

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Safe, Settings } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { BackupAdminPanel } from "@/components/settings/BackupAdminPanel";
import { UsersAdminPanel } from "@/components/settings/UsersAdminPanel";
import { PriceTiersPanel } from "@/components/settings/PriceTiersPanel";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { GeneralSettingsSection } from "@/components/settings/GeneralSettingsSection";
import { FinanceSettingsSection } from "@/components/settings/FinanceSettingsSection";
import { PrintSettingsSection } from "@/components/settings/PrintSettingsSection";
import { InventorySettingsSection } from "@/components/settings/InventorySettingsSection";
import { WorkshopBridgeSettingsPanel } from "@/components/settings/WorkshopBridgeSettingsPanel";
import {
  EMPTY_SETTINGS_FORM,
  SETTINGS_SAVE_TABS,
  type SettingsFormState,
  type SettingsTabId,
} from "@/components/settings/settings-form";
import { safesOrderQuery } from "@/lib/safes-order";
import { getSnapshot, isBrowserOnline, withTimeout } from "@/lib/offline";
import { useToast } from "@/components/ui/Toast";
import { resolvePrintFormats } from "@/lib/print-formats";

function formFromSettings(data: Settings): SettingsFormState {
  return {
    store_name: data.store_name || "",
    phone: data.phone || "",
    address: data.address || "",
    logo_url: data.logo_url || "",
    tax_number: data.tax_number || "",
    commercial_register: data.commercial_register || "",
    receipt_footer: data.receipt_footer || "",
    invoice_tagline: data.invoice_tagline || "",
    tax_rate: data.tax_rate ?? 15,
    tax_enabled: data.tax_enabled ?? true,
    currency: data.currency || "EGP",
    print_offset: data.print_offset || 0,
    drawer_safe_id: data.drawer_safe_id || "",
    default_low_stock_threshold: Number(data.default_low_stock_threshold ?? 0),
    print_formats: resolvePrintFormats(data.print_formats),
  };
}

function buildPayload(form: SettingsFormState) {
  return {
    store_name: form.store_name.trim() || "ويندور",
    phone: form.phone.trim() || null,
    address: form.address.trim() || null,
    logo_url: form.logo_url.trim() || null,
    tax_number: form.tax_number.trim() || null,
    commercial_register: form.commercial_register.trim() || null,
    receipt_footer: form.receipt_footer.trim() || null,
    tax_rate: form.tax_rate,
    tax_enabled: form.tax_enabled,
    currency: form.currency,
    print_offset: form.print_offset,
    invoice_tagline: form.invoice_tagline.trim() || null,
    drawer_safe_id: form.drawer_safe_id || null,
    default_low_stock_threshold: form.default_low_stock_threshold,
    print_formats: form.print_formats,
  };
}

const OPTIONAL_COLUMNS = [
  "print_formats",
  "tax_number",
  "commercial_register",
  "receipt_footer",
  "default_low_stock_threshold",
  "logo_url",
  "invoice_tagline",
  "drawer_safe_id",
] as const;

export default function SettingsPage() {
  const { canManageUsers, can, loading: authLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const canBackup = can("settings.backup");
  const canStoreSettings = can("settings");
  const canProductsWrite = can("products.write");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [form, setForm] = useState<SettingsFormState>({ ...EMPTY_SETTINGS_FORM });
  const [tab, setTab] = useState<SettingsTabId>("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [message, setMessage] = useState("");
  const supabase = createClient();
  const { success: toastSuccess, error: toastError } = useToast();

  const availableTabs = useMemo(() => {
    const tabs: { id: SettingsTabId; label: string }[] = [
      { id: "general", label: "عام" },
    ];
    if (canStoreSettings) {
      tabs.push(
        { id: "finance", label: "الضريبة والخزن" },
        { id: "print", label: "الطباعة" },
        { id: "inventory", label: "المخزون" }
      );
    }
    if (canStoreSettings || canProductsWrite) {
      tabs.push({ id: "tiers", label: "شرائح الأسعار" });
    }
    if (canManageUsers) {
      tabs.push({ id: "users", label: "المستخدمون" });
    }
    if (canBackup) {
      tabs.push({ id: "backup", label: "النسخ الاحتياطي" });
    }
    return tabs;
  }, [canStoreSettings, canProductsWrite, canManageUsers, canBackup]);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("tab") as SettingsTabId | null;
    const ids = availableTabs.map((t) => t.id);
    if (raw && ids.includes(raw)) {
      setTab(raw);
      return;
    }
    const first = ids[0] || "general";
    setTab(first);
    if (raw && !ids.includes(raw)) {
      const url = new URL(window.location.href);
      if (first === "general") url.searchParams.delete("tab");
      else url.searchParams.set("tab", first);
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [authLoading, availableTabs]);

  function switchTab(next: SettingsTabId) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "general") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url.pathname + url.search);
  }

  async function fetchSettings() {
    setLoading(true);
    if (!isBrowserOnline()) {
      const snap = await getSnapshot();
      if (snap?.settings) {
        const data = snap.settings as unknown as Settings;
        setSettings(data);
        setForm(formFromSettings(data));
      }
      if (snap?.safes?.length) {
        setSafes(snap.safes.filter((s) => s.is_active) as Safe[]);
      }
      setLoading(false);
      return;
    }
    try {
      const [{ data, error }, { data: safesData }] = await withTimeout(
        Promise.all([
          supabase
            .from("settings")
            .select("*")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
          safesOrderQuery(
            supabase.from("safes").select("*").eq("is_active", true)
          ),
        ]),
        4000
      );

      if (error) {
        console.error(error);
        setMessage("تعذر تحميل الإعدادات: " + error.message);
      }

      setSafes((safesData as Safe[]) || []);

      if (data) {
        setSettings(data);
        setForm(formFromSettings(data));
      }
    } catch {
      const snap = await getSnapshot();
      if (snap?.settings) {
        const data = snap.settings as unknown as Settings;
        setSettings(data);
        setForm(formFromSettings(data));
      }
      if (snap?.safes?.length) {
        setSafes(snap.safes.filter((s) => s.is_active) as Safe[]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function moveSafe(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= safes.length) return;
    const next = [...safes];
    const tmp = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = tmp;
    setSafes(next);
    setReordering(true);
    try {
      const results = await Promise.all(
        next.map((s, i) =>
          supabase.from("safes").update({ sort_order: i }).eq("id", s.id)
        )
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);
      toastSuccess("تم تحديث ترتيب الخزن");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر حفظ الترتيب");
      await fetchSettings();
    } finally {
      setReordering(false);
    }
  }

  async function persistPayload(
    payload: Record<string, unknown>
  ): Promise<{ saved: Settings | null; errorMessage: string }> {
    if (settings?.id) {
      const { data, error } = await supabase
        .from("settings")
        .update(payload)
        .eq("id", settings.id)
        .select("*")
        .single();
      return { saved: data, errorMessage: error?.message || "" };
    }

    const { data: existing } = await supabase
      .from("settings")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const { data, error } = await supabase
        .from("settings")
        .update(payload)
        .eq("id", existing.id)
        .select("*")
        .single();
      return { saved: data, errorMessage: error?.message || "" };
    }

    const { data, error } = await supabase
      .from("settings")
      .insert(payload)
      .select("*")
      .single();
    return { saved: data, errorMessage: error?.message || "" };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    let payload: Record<string, unknown> = buildPayload(form);
    let { saved, errorMessage } = await persistPayload(payload);

    // Drop unknown columns one-by-one if migration not applied yet
    for (const col of OPTIONAL_COLUMNS) {
      if (!errorMessage || !errorMessage.includes(col)) continue;
      const { [col]: _dropped, ...rest } = payload;
      void _dropped;
      payload = rest;
      const retry = await persistPayload(payload);
      saved = retry.saved;
      errorMessage = retry.errorMessage;
      if (!errorMessage && saved) {
        toastError(
          `تم الحفظ بدون بعض الحقول — نفّذ migration الإعدادات في Supabase (${col})`
        );
      }
    }

    setSaving(false);

    if (errorMessage || !saved) {
      const msg = "فشل الحفظ: " + (errorMessage || "حاول مرة أخرى");
      setMessage(msg);
      toastError(msg);
      return;
    }

    setSettings(saved);
    setForm(formFromSettings(saved));
    setMessage("تم حفظ الإعدادات بنجاح ✓");
    toastSuccess("تم حفظ الإعدادات بنجاح");
    setTimeout(() => setMessage(""), 3000);
  }

  if (loading || authLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
      </div>
    );
  }

  const showSave = canStoreSettings && SETTINGS_SAVE_TABS.includes(tab);

  function SaveBar() {
    if (!showSave) return null;
    return (
      <div className="settings-save-bar">
        <p className="settings-save-bar__hint">
          {saving ? "جاري حفظ التغييرات..." : "احفظ بعد تعديل بيانات هذا القسم"}
        </p>
        <button type="submit" disabled={saving} className="settings-save-btn">
          <Save className="h-4 w-4" strokeWidth={2.25} />
          {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
        </button>
      </div>
    );
  }

  return (
    <div className="settings-page mx-auto max-w-4xl">
      <header className="settings-page__header">
        <h1 className="settings-page__title">الإعدادات</h1>
        <p className="settings-page__subtitle">
          إدارة بيانات المحل والطباعة والصلاحيات والنسخ الاحتياطي
        </p>
      </header>

      <SettingsTabs tabs={availableTabs} active={tab} onChange={switchTab} />

      {message && (
        <div
          className={`settings-flash ${
            message.startsWith("فشل") || message.startsWith("تعذر")
              ? "settings-flash--err"
              : "settings-flash--ok"
          }`}
        >
          {message}
        </div>
      )}

      {tab === "general" && (
        <form onSubmit={handleSubmit}>
          <GeneralSettingsSection
            theme={theme}
            setTheme={setTheme}
            canStoreSettings={canStoreSettings}
            form={form}
            setForm={setForm}
          />
          <SaveBar />
        </form>
      )}

      {tab === "finance" && canStoreSettings && (
        <>
          <form onSubmit={handleSubmit}>
            <FinanceSettingsSection
              form={form}
              setForm={setForm}
              safes={safes}
              reordering={reordering}
              moveSafe={moveSafe}
            />
            <SaveBar />
          </form>
          <div className="mt-5">
            <WorkshopBridgeSettingsPanel />
          </div>
        </>
      )}

      {tab === "print" && canStoreSettings && (
        <form onSubmit={handleSubmit}>
          <PrintSettingsSection form={form} setForm={setForm} />
          <SaveBar />
        </form>
      )}

      {tab === "inventory" && canStoreSettings && (
        <form onSubmit={handleSubmit}>
          <InventorySettingsSection form={form} setForm={setForm} />
          <SaveBar />
        </form>
      )}

      {tab === "tiers" && (canStoreSettings || canProductsWrite) && (
        <PriceTiersPanel />
      )}

      {tab === "users" && canManageUsers && <UsersAdminPanel />}

      {tab === "backup" && canBackup && <BackupAdminPanel />}
    </div>
  );
}

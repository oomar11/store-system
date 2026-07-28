"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import {
  DEFAULT_INVENTORY_SHEET_CONFIG,
  normalizeInventorySheetConfig,
} from "@/lib/inventory-sheet";
import { InventorySheetLivePreview, InventorySheetPreview } from "@/components/print/InventorySheetPreview";
import type { InventorySheetConfig, Product, Settings } from "@/types";
import { ArrowRight, Printer, Save } from "lucide-react";
import { formatDateShort } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

type ToggleKey = keyof Pick<
  InventorySheetConfig,
  | "show_sku"
  | "show_category"
  | "show_unit"
  | "show_system_qty"
  | "show_counted_blank"
  | "show_variance_blank"
  | "show_notes_blank"
  | "group_by_category"
>;

const TOGGLES: { key: ToggleKey; label: string; hint: string }[] = [
  { key: "show_sku", label: "الكود / الباركود", hint: "عمود SKU" },
  { key: "show_category", label: "التصنيف", hint: "يظهر كعمود أو كعناوين أقسام" },
  { key: "show_unit", label: "الوحدة", hint: "قطعة / كرتونة …" },
  { key: "show_system_qty", label: "كمية النظام", hint: "الكمية المسجّلة حالياً" },
  { key: "show_counted_blank", label: "خانة الكمية الفعلية", hint: "فارغة للكتابة اليدوية" },
  { key: "show_variance_blank", label: "خانة الفرق", hint: "فارغة لحساب الفرق يدوياً" },
  { key: "show_notes_blank", label: "خانة ملاحظات", hint: "عمود ملاحظات فارغ" },
  { key: "group_by_category", label: "تجميع حسب التصنيف", hint: "عناوين أقسام بين الصفوف" },
];

export default function InventorySheetSetupPage() {
  const supabase = useMemo(() => createClient(), []);
  const { error: toastError } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [config, setConfig] = useState<InventorySheetConfig>(
    DEFAULT_INVENTORY_SHEET_CONFIG
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showPrint, setShowPrint] = useState(false);
  const [printProducts, setPrintProducts] = useState<Product[]>([]);
  const [printLoading, setPrintLoading] = useState(false);

  useEffect(() => {
    async function load() {
      const [settingsRes, productsRes] = await Promise.all([
        supabase.from("settings").select("*").limit(1).maybeSingle(),
        supabase
          .from("products")
          .select("*, category:categories(*)")
          .eq("is_active", true)
          .order("name")
          .limit(40),
      ]);

      if (settingsRes.data) {
        setSettings(settingsRes.data);
        setConfig(
          normalizeInventorySheetConfig(settingsRes.data.inventory_sheet_config)
        );
      }
      if (productsRes.data) setProducts(productsRes.data);
      setLoading(false);
    }
    load();
  }, [supabase]);

  function updateToggle(key: ToggleKey) {
    setConfig((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const payload = {
      inventory_sheet_config: {
        ...config,
        title: config.title.trim() || DEFAULT_INVENTORY_SHEET_CONFIG.title,
        extra_blank_rows: Math.max(0, Math.min(20, config.extra_blank_rows)),
      },
    };

    let errorMessage = "";
    if (settings?.id) {
      const { data, error } = await supabase
        .from("settings")
        .update(payload)
        .eq("id", settings.id)
        .select("*")
        .single();
      if (error) errorMessage = error.message;
      else if (data) {
        setSettings(data);
        setConfig(normalizeInventorySheetConfig(data.inventory_sheet_config));
      }
    } else {
      const { data, error } = await supabase
        .from("settings")
        .insert({
          store_name: "المحل",
          ...payload,
        })
        .select("*")
        .single();
      if (error) errorMessage = error.message;
      else if (data) {
        setSettings(data);
        setConfig(normalizeInventorySheetConfig(data.inventory_sheet_config));
      }
    }

    setSaving(false);
    setMessage(errorMessage ? `فشل الحفظ: ${errorMessage}` : "تم حفظ شكل ورقة الجرد");
  }

  async function printFullSheet() {
    setPrintLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*, category:categories(*)")
      .eq("is_active", true)
      .order("name");
    setPrintLoading(false);
    if (error) {
      toastError(`تعذر تحميل الأصناف: ${error.message}`);
      return;
    }
    if (!data?.length) {
      toastError("لا توجد أصناف للطباعة");
      return;
    }
    setPrintProducts(data);
    setShowPrint(true);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/inventory"
            className="mb-2 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
          >
            <ArrowRight className="h-4 w-4" />
            العودة للجرد
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">شكل ورقة الجرد</h1>
          <p className="mt-1 text-sm text-slate-600">
            اضبط الأعمدة واطبع ورقة كاملة قبل ما تفتح جلسة جرد
          </p>
        </div>
        <button
          type="button"
          disabled={printLoading}
          onClick={() => void printFullSheet()}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          {printLoading ? "جاري التحميل..." : "طباعة كل الأصناف"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <form
          onSubmit={handleSave}
          className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">عنوان الورقة</span>
            <input
              value={config.title}
              onChange={(e) => setConfig((c) => ({ ...c, title: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">
              ملاحظات أعلى الورقة
            </span>
            <textarea
              value={config.header_notes}
              onChange={(e) =>
                setConfig((c) => ({ ...c, header_notes: e.target.value }))
              }
              rows={2}
              placeholder="مثال: جرد نهاية الشهر — فرع المعادي"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-slate-700">
              أسطر فارغة إضافية
            </span>
            <input
              type="number"
              min={0}
              max={20}
              value={config.extra_blank_rows}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  extra_blank_rows: Number(e.target.value) || 0,
                }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              لإضافة أصناف غير مسجّلة أثناء العد اليدوي
            </span>
          </label>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">محتوى الورقة</p>
            <div className="space-y-2">
              {TOGGLES.map((t) => (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  <input
                    type="checkbox"
                    checked={config[t.key]}
                    onChange={() => updateToggle(t.key)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">
                      {t.label}
                    </span>
                    <span className="block text-[11px] text-slate-500">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {message && (
            <p
              className={`text-sm ${
                message.startsWith("فشل") ? "text-red-600" : "text-emerald-700"
              }`}
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "جاري الحفظ..." : "حفظ الشكل"}
          </button>
        </form>

        <div>
          <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">معاينة حية</p>
          <div className="max-h-[75vh] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <InventorySheetLivePreview
              config={config}
              products={products}
              settings={settings}
              subtitle="معاينة بعيّنة من الأصناف النشطة"
            />
          </div>
        </div>
      </div>

      {showPrint && (
        <InventorySheetPreview
          config={config}
          products={printProducts}
          settings={settings}
          subtitle={`ورقة جرد · كل الأصناف · ${formatDateShort(new Date().toISOString())}`}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

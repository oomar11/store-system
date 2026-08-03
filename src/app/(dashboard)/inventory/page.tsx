"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import {
  formatDateRelative,
  formatDateShort,
  INVENTORY_COUNT_STATUS_COLORS,
  INVENTORY_COUNT_STATUS_LABELS,
} from "@/lib/utils";
import { allocateDocumentNumber } from "@/lib/document-numbers";
import {
  INVENTORY_SETUP_SQL,
  INVENTORY_SETUP_SQL_URL,
  isDocumentNumberRpcMissing,
  isInventoryTablesMissing,
} from "@/lib/inventory-setup";
import { normalizeInventorySheetConfig } from "@/lib/inventory-sheet";
import { InventorySheetPreview } from "@/components/print/InventorySheetPreview";
import { TableRowActions, type RowAction } from "@/components/ui/TableRowActions";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import {
  getSnapshot,
  isBrowserOnline,
  TimeoutError,
  withTimeout,
} from "@/lib/offline";
import type {
  Category,
  InventoryCount,
  InventorySheetConfig,
  Product,
  Settings,
} from "@/types";
import {
  ClipboardList,
  LayoutTemplate,
  Plus,
  Printer,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export default function InventoryPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [offlineOnly, setOfflineOnly] = useState(false);

  const [showPrintPanel, setShowPrintPanel] = useState(false);
  const [printCategory, setPrintCategory] = useState("");
  const [printLoading, setPrintLoading] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [printProducts, setPrintProducts] = useState<Product[]>([]);
  const [printSettings, setPrintSettings] = useState<Settings | null>(null);
  const [printConfig, setPrintConfig] = useState<InventorySheetConfig | null>(
    null
  );
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    if (!isBrowserOnline()) {
      setOfflineOnly(true);
      setLoading(false);
      return;
    }
    setOfflineOnly(false);
    try {
      const [countsRes, catsRes] = await withTimeout(
        Promise.all([
          supabase
            .from("inventory_counts")
            .select("*")
            .order("created_at", { ascending: false }),
          supabase.from("categories").select("*").order("name"),
        ]),
        5000
      );

      if (countsRes.error) {
        if (isInventoryTablesMissing(countsRes.error.message)) {
          setSetupNeeded(true);
          setSetupError(countsRes.error.message);
        } else {
          console.error(countsRes.error);
        }
      } else if (countsRes.data) {
        setCounts(countsRes.data);
        setSetupNeeded(false);
      }
      if (catsRes.data) setCategories(catsRes.data);
    } catch {
      setOfflineOnly(true);
    } finally {
      setLoading(false);
    }
  }

  async function createCount() {
    if (!isBrowserOnline()) {
      toastError("الجرد يحتاج اتصال بالإنترنت");
      return;
    }
    setCreating(true);
    try {
      const count = await withTimeout(
        (async () => {
          const {
            data: { user },
          } = await supabase.auth.getUser();

          const countNumber = await allocateDocumentNumber(
            supabase,
            "inventory_count"
          );
          const { data, error: countError } = await supabase
            .from("inventory_counts")
            .insert({
              count_number: countNumber,
              status: "in_progress",
              notes: null,
              created_by: user?.id || null,
            })
            .select("*")
            .single();

          if (countError || !data) {
            throw new Error(countError?.message || "تعذر إنشاء الجرد");
          }
          return data;
        })(),
        12000
      );

      router.push(`/inventory/${count.id}`);
    } catch (err: unknown) {
      const message =
        err instanceof TimeoutError
          ? "انتهت مهلة الاتصال — حاول مرة أخرى"
          : err instanceof Error
            ? err.message
            : "خطأ غير معروف";
      if (isDocumentNumberRpcMissing(message) || isInventoryTablesMissing(message)) {
        setSetupNeeded(true);
        setSetupError(message);
        toastError(
          "تعذر إنشاء الجرد: يلزم تشغيل SQL التفعيل مرة واحدة في Supabase (الجداول + ترقيم الجلسات)"
        );
      } else {
        toastError("تعذر إنشاء الجرد: " + message);
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteCount(c: InventoryCount) {
    const msg =
      c.status === "completed"
        ? `حذف الجرد ${c.count_number}؟ المخزون اللي اتسوّى منه مش هيرجع تلقائياً.`
        : `حذف الجرد ${c.count_number}؟`;
    if (
      !(await confirm({
        message: msg,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;
    const { error } = await supabase
      .from("inventory_counts")
      .delete()
      .eq("id", c.id);
    if (error) {
      toastError("تعذر الحذف: " + error.message);
      return;
    }
    setCounts((prev) => prev.filter((x) => x.id !== c.id));
  }

  async function openBlankSheetPrint() {
    setPrintLoading(true);
    let query = supabase
      .from("products")
      .select("*, category:categories(*)")
      .eq("is_active", true)
      .order("name");

    if (printCategory) {
      query = query.eq("category_id", printCategory);
    }

    const [productsRes, settingsRes] = await Promise.all([
      query,
      supabase.from("settings").select("*").limit(1).maybeSingle(),
    ]);

    setPrintLoading(false);

    if (productsRes.error) {
      toastError("تعذر تحميل الأصناف: " + productsRes.error.message);
      return;
    }
    if (!productsRes.data?.length) {
      toastError("لا توجد أصناف للطباعة");
      return;
    }

    setPrintProducts(productsRes.data);
    setPrintSettings(settingsRes.data);
    setPrintConfig(
      normalizeInventorySheetConfig(
        settingsRes.data?.inventory_sheet_config
      )
    );
    setShowPrintPanel(false);
    setShowPrint(true);
  }

  function countRowActions(c: InventoryCount): RowAction[] {
    return [
      {
        label: "فتح",
        tone: "view",
        icon: "eye",
        onClick: () => router.push(`/inventory/${c.id}`),
      },
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () => router.push(`/inventory/${c.id}`),
      },
      {
        label: "حذف",
        tone: "delete",
        icon: "trash",
        onClick: () => void deleteCount(c),
      },
    ];
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
      </div>
    );
  }

  const categoryName = printCategory
    ? categories.find((c) => c.id === printCategory)?.name
    : null;

  return (
    <div>
      {offlineOnly && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          الجرد غير متاح بدون إنترنت — الوصّل النت عشان تشوف جلسات الجرد أو تبدأ جرد جديد.
          نقطة البيع والمنتجات والعملاء شغّالين من النسخة المحلية.
        </div>
      )}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الجرد</h1>
          <p className="mt-1 text-sm text-slate-600">
            اطبع ورقة جرد أولاً للعد اليدوي، بعدين افتح جلسة وسجّل الكميات
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/inventory/sheet-setup"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <LayoutTemplate className="h-4 w-4" />
            ضبط شكل الورقة
          </Link>
          <button
            type="button"
            onClick={() => setShowPrintPanel((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
          >
            <Printer className="h-4 w-4" />
            طباعة ورقة جرد
          </button>
          <button
            type="button"
            onClick={() => void createCount()}
            disabled={setupNeeded || creating}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {creating ? "جاري الفتح..." : "جرد جديد"}
          </button>
        </div>
      </div>

      {showPrintPanel && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
          <h2 className="mb-1 text-sm font-bold text-slate-800">
            طباعة ورقة جرد قبل الجلسة
          </h2>
          <p className="mb-3 text-xs text-slate-600">
            الورقة بتتطبع بالشكل المحفوظ في «ضبط شكل الورقة» — بدون فتح جلسة جرد
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1 text-xs">
              <span className="mb-1 block font-semibold text-slate-600">
                التصنيف
              </span>
              <select
                value={printCategory}
                onChange={(e) => setPrintCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">كل الأصناف النشطة</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowPrintPanel(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={printLoading}
                onClick={() => void openBlankSheetPrint()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                {printLoading ? "جاري التحميل..." : "معاينة وطباعة"}
              </button>
            </div>
          </div>
        </div>
      )}

      {setupNeeded && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-sm font-bold text-amber-900">تفعيل نظام الجرد مطلوب</h2>
          <p className="mt-1 text-sm text-amber-800">
            شغّل الـ SQL التالي مرة واحدة في Supabase (الجداول + ترقيم الجلسات) ثم حدّث
            الصفحة — بدون كده زر «جرد جديد» مش هيفتح.
          </p>
          {setupError && (
            <p className="mt-1 text-xs text-amber-700/80">{setupError}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={INVENTORY_SETUP_SQL_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800"
            >
              فتح SQL Editor
            </a>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(INVENTORY_SETUP_SQL);
                toastSuccess("تم نسخ الـ SQL");
              }}
              className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-900"
            >
              نسخ SQL
            </button>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                fetchData();
              }}
              className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-900"
            >
              إعادة المحاولة
            </button>
          </div>
          <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-white/80 p-3 text-[10px] text-slate-700">
            {INVENTORY_SETUP_SQL}
          </pre>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {counts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-slate-500">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
              <ClipboardList className="h-7 w-7 text-slate-400" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-slate-700">
                لا توجد جلسات جرد بعد
              </p>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                ابدأ بورقة جرد مطبوعة للعد اليدوي، ثم افتح جلسة وسجّل الكميات
                الفعلية
              </p>
            </div>
            <ol className="w-full max-w-md space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-right text-xs text-slate-600">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800">
                  1
                </span>
                <span>اطبع ورقة جرد (اختياري: حسب التصنيف)</span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-800">
                  2
                </span>
                <span>افتح «جرد جديد» وسجّل الكميات المعدودة</span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-800">
                  3
                </span>
                <span>أكمل الجلسة لتطبيق الفروقات على المخزون</span>
              </li>
            </ol>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPrintPanel(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
              >
                <Printer className="h-4 w-4" />
                طباعة ورقة جرد
              </button>
              <button
                type="button"
                onClick={() => void createCount()}
                disabled={creating || setupNeeded}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {creating ? "جاري الفتح..." : "ابدأ أول جرد"}
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-right font-semibold">رقم الجرد</th>
                  <th className="px-4 py-3 text-right font-semibold">الحالة</th>
                  <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                  <th className="px-4 py-3 text-right font-semibold">ملاحظات</th>
                  <th className="px-4 py-3 text-right font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-gray-100 hover:bg-slate-50"
                    onContextMenu={(e) =>
                      openMenu(e, toContextMenuItems(countRowActions(c)))
                    }
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold">
                      {c.count_number}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          INVENTORY_COUNT_STATUS_COLORS[c.status] ||
                          "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {INVENTORY_COUNT_STATUS_LABELS[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDateRelative(c.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{c.notes || "—"}</td>
                    <td className="px-4 py-3">
                      <TableRowActions actions={countRowActions(c)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showPrint && printConfig && (
        <InventorySheetPreview
          config={printConfig}
          products={printProducts}
          settings={printSettings}
          subtitle={
            categoryName
              ? `ورقة جرد · ${categoryName} · ${formatDateShort(new Date().toISOString())}`
              : `ورقة جرد · كل الأصناف · ${formatDateShort(new Date().toISOString())}`
          }
          onClose={() => setShowPrint(false)}
        />
      )}
      {contextMenu}
    </div>
  );
}

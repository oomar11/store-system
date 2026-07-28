"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { setProductStock } from "@/lib/inventory";
import { normalizeInventorySheetConfig } from "@/lib/inventory-sheet";
import {
  formatDateShort,
  INVENTORY_COUNT_STATUS_COLORS,
  INVENTORY_COUNT_STATUS_LABELS,
  smartSearchMatch,
} from "@/lib/utils";
import { InventorySheetPreview } from "@/components/print/InventorySheetPreview";
import { InventoryCountExcelToolbar } from "@/components/excel/InventoryCountExcelToolbar";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type {
  InventoryCount,
  InventoryCountItem,
  InventorySheetConfig,
  Product,
  Settings,
} from "@/types";
import { ArrowRight, CheckCircle2, Pencil, Printer, Search, Trash2 } from "lucide-react";

type CountItemRow = InventoryCountItem & {
  product?: Product & { category?: { id: string; name: string } | null };
};

export default function InventoryCountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const countId = String(params.id || "");
  const supabase = useMemo(() => createClient(), []);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const [count, setCount] = useState<InventoryCount | null>(null);
  const [items, setItems] = useState<CountItemRow[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sheetConfig, setSheetConfig] = useState<InventorySheetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "pending" | "variance">("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [addSearch, setAddSearch] = useState("");
  const [addQty, setAddQty] = useState("");
  const [adding, setAdding] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [pendingAddProduct, setPendingAddProduct] = useState<Product | null>(null);

  const addSearchRef = useRef<HTMLInputElement>(null);
  const addQtyRef = useRef<HTMLInputElement>(null);
  const qtyInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (countId) fetchDetail();
  }, [countId]);

  async function fetchDetail() {
    setLoading(true);
    const [countRes, itemsRes, settingsRes, catalogRes] = await Promise.all([
      supabase.from("inventory_counts").select("*").eq("id", countId).single(),
      supabase
        .from("inventory_count_items")
        .select("*, product:products(*, category:categories(*))")
        .eq("count_id", countId)
        .order("id"),
      supabase.from("settings").select("*").limit(1).maybeSingle(),
      supabase
        .from("products")
        .select("*, category:categories(*)")
        .eq("is_active", true)
        .order("name"),
    ]);

    if (countRes.error || !countRes.data) {
      toastError("جلسة الجرد غير موجودة");
      router.push("/inventory");
      return;
    }

    setCount(countRes.data);
    setNotesDraft(countRes.data.notes || "");
    const loadedItems = (itemsRes.data || []) as CountItemRow[];
    setItems(loadedItems);
    if (catalogRes.data) setCatalog(catalogRes.data);
    const drafts: Record<string, string> = {};
    for (const item of loadedItems) {
      drafts[item.id] =
        item.counted_quantity == null ? "" : String(item.counted_quantity);
    }
    setDraftValues(drafts);

    if (settingsRes.data) {
      setSettings(settingsRes.data);
      setSheetConfig(
        normalizeInventorySheetConfig(settingsRes.data.inventory_sheet_config)
      );
    } else {
      setSheetConfig(normalizeInventorySheetConfig(null));
    }
    setLoading(false);
  }

  const isReadonly =
    count?.status === "completed" || count?.status === "cancelled";

  useEffect(() => {
    if (!loading && !isReadonly) {
      addSearchRef.current?.focus();
    }
  }, [loading, isReadonly]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch = smartSearchMatch(searchTerm, [
        item.product?.name,
        item.product?.sku,
      ]);
      if (!matchesSearch) return false;

      if (filterMode === "pending") {
        return item.counted_quantity == null;
      }
      if (filterMode === "variance") {
        if (item.counted_quantity == null) return false;
        return Number(item.counted_quantity) !== Number(item.system_quantity);
      }
      return true;
    });
  }, [items, searchTerm, filterMode]);

  const stats = useMemo(() => {
    const total = items.length;
    const counted = items.filter((i) => i.counted_quantity != null).length;
    const variances = items.filter(
      (i) =>
        i.counted_quantity != null &&
        Number(i.counted_quantity) !== Number(i.system_quantity)
    ).length;
    return { total, counted, pending: total - counted, variances };
  }, [items]);

  async function saveCounted(itemId: string, raw: string) {
    if (isReadonly) return;
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && Number.isNaN(value)) {
      toastError("أدخل رقماً صالحاً");
      return;
    }

    setSavingId(itemId);
    const { error } = await supabase
      .from("inventory_count_items")
      .update({ counted_quantity: value })
      .eq("id", itemId);

    if (error) {
      toastError("تعذر الحفظ: " + error.message);
    } else {
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, counted_quantity: value } : i
        )
      );
      if (count?.status === "draft") {
        await supabase
          .from("inventory_counts")
          .update({ status: "in_progress" })
          .eq("id", countId);
        setCount((c) => (c ? { ...c, status: "in_progress" } : c));
      }
    }
    setSavingId(null);
  }

  function focusQtyAt(index: number) {
    const item = filteredItems[index];
    if (!item) return;
    const el = qtyInputRefs.current.get(item.id);
    if (el) {
      el.focus();
      el.select();
    }
  }

  function focusNextQty(currentItemId: string, direction: 1 | -1) {
    const idx = filteredItems.findIndex((i) => i.id === currentItemId);
    if (idx < 0) return;
    const next = idx + direction;
    if (next >= 0 && next < filteredItems.length) {
      focusQtyAt(next);
    } else if (direction === 1) {
      addSearchRef.current?.focus();
    }
  }

  async function applyCount() {
    if (!count || isReadonly) return;

    const toApply = items.filter((i) => i.counted_quantity != null);
    if (toApply.length === 0) {
      toastError("أدخل كمية فعلية لصنف واحد على الأقل قبل الاعتماد");
      return;
    }

    const pending = items.length - toApply.length;
    const msg =
      pending > 0
        ? `سيتم تسوية ${toApply.length} صنف فقط. ${pending} صنف بدون إدخال لن يتغير مخزونه. متابعة؟`
        : `اعتماد الجرد وتسوية مخزون ${toApply.length} صنف؟`;

    if (
      !(await confirm({
        message: msg,
      }))
    )
      return;

    setApplying(true);
    try {
      await setProductStock(
        supabase,
        toApply.map((i) => ({
          product_id: i.product_id,
          quantity: Number(i.counted_quantity),
        }))
      );

      const { error } = await supabase
        .from("inventory_counts")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", countId);

      if (error) throw new Error(error.message);

      setCount((c) =>
        c
          ? {
              ...c,
              status: "completed",
              completed_at: new Date().toISOString(),
            }
          : c
      );
      toastSuccess("تم اعتماد الجرد وتسوية المخزون");
    } catch (err) {
      toastError(
        "فشل الاعتماد: " + (err instanceof Error ? err.message : String(err))
      );
    }
    setApplying(false);
  }

  async function cancelCount() {
    if (!count || isReadonly) return;
    if (
      !(await confirm({
        message: "إلغاء جلسة الجرد؟ لن يتم تعديل المخزون.",
        tone: "danger",
        confirmLabel: "إلغاء الجرد",
      }))
    )
      return;

    const { error } = await supabase
      .from("inventory_counts")
      .update({ status: "cancelled" })
      .eq("id", countId);

    if (error) {
      toastError(error.message);
      return;
    }
    setCount((c) => (c ? { ...c, status: "cancelled" } : c));
  }

  async function reopenForEdit() {
    if (!count) return;
    const wasCompleted = count.status === "completed";
    const msg = wasCompleted
      ? "إعادة فتح الجرد للتعديل؟ المخزون اتسوّى قبل كده — بعد التعديل اضغط اعتماد تاني عشان تطبّق الكميات الجديدة."
      : "إعادة فتح الجرد للتعديل؟";
    if (
      !(await confirm({
        message: msg,
      }))
    )
      return;

    setReopening(true);
    const { error } = await supabase
      .from("inventory_counts")
      .update({ status: "in_progress", completed_at: null })
      .eq("id", countId);
    setReopening(false);

    if (error) {
      toastError("تعذر إعادة الفتح: " + error.message);
      return;
    }
    setCount((c) =>
      c ? { ...c, status: "in_progress", completed_at: undefined } : c
    );
  }

  async function deleteCount() {
    if (!count) return;
    const msg =
      count.status === "completed"
        ? `حذف الجرد ${count.count_number}؟ المخزون اللي اتسوّى منه مش هيرجع تلقائياً.`
        : `حذف الجرد ${count.count_number} نهائياً؟`;
    if (
      !(await confirm({
        message: msg,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;

    setDeleting(true);
    const { error } = await supabase
      .from("inventory_counts")
      .delete()
      .eq("id", countId);
    setDeleting(false);

    if (error) {
      toastError("تعذر الحذف: " + error.message);
      return;
    }
    router.push("/inventory");
  }

  async function saveNotes() {
    if (!count) return;
    const next = notesDraft.trim() || null;
    if ((count.notes || null) === next) return;
    setSavingNotes(true);
    const { error } = await supabase
      .from("inventory_counts")
      .update({ notes: next })
      .eq("id", countId);
    setSavingNotes(false);
    if (error) {
      toastError("تعذر حفظ الملاحظات: " + error.message);
      return;
    }
    setCount((c) => (c ? { ...c, notes: next || undefined } : c));
  }

  const itemProductIds = useMemo(
    () => new Set(items.map((i) => i.product_id)),
    [items]
  );

  const addResults = useMemo(() => {
    if (!addSearch.trim()) return [];
    return catalog
      .filter(
        (p) =>
          !itemProductIds.has(p.id) &&
          smartSearchMatch(addSearch, [p.name, p.sku])
      )
      .slice(0, 10);
  }, [catalog, addSearch, itemProductIds]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [addSearch]);

  const addProductToCount = useCallback(
    async (product: Product, qtyOverride?: string) => {
      if (isReadonly) return;
      const raw =
        qtyOverride !== undefined
          ? qtyOverride
          : addQty.trim() === ""
            ? String(product.quantity ?? 0)
            : addQty;
      const qty = Number(raw);
      if (Number.isNaN(qty) || qty < 0) {
        toastError("أدخل كمية صالحة");
        return;
      }
      setAdding(true);
      const { data, error } = await supabase
        .from("inventory_count_items")
        .insert({
          count_id: countId,
          product_id: product.id,
          system_quantity: Number(product.quantity) || 0,
          counted_quantity: qty,
        })
        .select("*, product:products(*, category:categories(*))")
        .single();

      if (error || !data) {
        toastError("تعذر الإضافة: " + (error?.message || ""));
      } else {
        const row = data as CountItemRow;
        setItems((prev) => [...prev, row]);
        setDraftValues((d) => ({ ...d, [row.id]: String(qty) }));
        setAddSearch("");
        setAddQty("");
        setPendingAddProduct(null);
        setHighlightIndex(0);
        requestAnimationFrame(() => addSearchRef.current?.focus());
      }
      setAdding(false);
    },
    [isReadonly, addQty, supabase, countId]
  );

  function selectProductForQty(product: Product) {
    setPendingAddProduct(product);
    setAddSearch(product.name);
    setAddQty(String(product.quantity ?? 0));
    requestAnimationFrame(() => {
      addQtyRef.current?.focus();
      addQtyRef.current?.select();
    });
  }

  function handleAddSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (addResults.length === 0) return;
      setHighlightIndex((i) => Math.min(i + 1, addResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (addResults.length === 0) return;
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const exact = catalog.find(
        (p) =>
          !itemProductIds.has(p.id) &&
          p.sku.trim().toLowerCase() === addSearch.trim().toLowerCase()
      );
      const chosen = exact || addResults[highlightIndex] || addResults[0];
      if (!chosen) return;
      selectProductForQty(chosen);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setAddSearch("");
      setPendingAddProduct(null);
      setHighlightIndex(0);
    }
  }

  function handleAddQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (pendingAddProduct) {
        void addProductToCount(pendingAddProduct, addQty);
      } else if (addResults[0]) {
        void addProductToCount(addResults[0], addQty);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPendingAddProduct(null);
      setAddQty("");
      addSearchRef.current?.focus();
    }
  }

  function handleRowQtyKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    itemId: string
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveCounted(itemId, (e.target as HTMLInputElement).value).then(() => {
        focusNextQty(itemId, 1);
      });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      void saveCounted(itemId, (e.target as HTMLInputElement).value);
      focusNextQty(itemId, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      void saveCounted(itemId, (e.target as HTMLInputElement).value);
      focusNextQty(itemId, -1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      addSearchRef.current?.focus();
    }
  }

  useEffect(() => {
    if (isReadonly) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (
        e.key === "F2" ||
        (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))
      ) {
        e.preventDefault();
        addSearchRef.current?.focus();
        addSearchRef.current?.select();
        return;
      }

      if (e.key === "/" && !typing) {
        e.preventDefault();
        addSearchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isReadonly]);

  async function removeItem(itemId: string) {
    if (isReadonly) return;
    if (
      !(await confirm({
        message: "حذف الصنف من الجرد؟",
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;
    const { error } = await supabase
      .from("inventory_count_items")
      .delete()
      .eq("id", itemId);
    if (error) {
      toastError(error.message);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setDraftValues((d) => {
      const next = { ...d };
      delete next[itemId];
      return next;
    });
  }

  const excelExportRows = useMemo(
    () =>
      items.map((i) => ({
        sku: i.product?.sku || "",
        name: i.product?.name || "",
        system_quantity: Number(i.system_quantity) || 0,
        counted_quantity: i.counted_quantity,
        notes: i.notes,
      })),
    [items]
  );

  const printProducts: Product[] = useMemo(() => {
    return items
      .map((i) => i.product)
      .filter((p): p is Product => Boolean(p))
      .map((p) => {
        const item = items.find((i) => i.product_id === p.id);
        return {
          ...p,
          quantity: item ? Number(item.system_quantity) : p.quantity,
        };
      });
  }, [items]);

  if (loading || !count) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/inventory"
            className="mb-2 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
          >
            <ArrowRight className="h-4 w-4" />
            كل جلسات الجرد
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 font-mono">
              {count.count_number}
            </h1>
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                INVENTORY_COUNT_STATUS_COLORS[count.status]
              }`}
            >
              {INVENTORY_COUNT_STATUS_LABELS[count.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {formatDateShort(count.created_at)}
          </p>
          <div className="mt-2 flex max-w-md flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-500">
              ملاحظات
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={() => void saveNotes()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                placeholder="ملاحظات الجرد..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              {savingNotes && (
                <span className="self-center text-[10px] text-slate-400">
                  حفظ...
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <InventoryCountExcelToolbar
            countId={countId}
            countNumber={count.count_number}
            exportRows={excelExportRows}
            catalog={catalog}
            existingItems={items}
            disabled={isReadonly}
            onImported={() => void fetchDetail()}
          />
          <Link
            href="/inventory/sheet-setup"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            شكل الورقة
          </Link>
          <button
            type="button"
            onClick={() => setShowPrint(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-4 w-4" />
            طباعة ورقة الجرد
          </button>
          {isReadonly && (
            <button
              type="button"
              disabled={reopening}
              onClick={() => void reopenForEdit()}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              <Pencil className="h-4 w-4" />
              {reopening ? "جاري الفتح..." : "إعادة فتح للتعديل"}
            </button>
          )}
          {!isReadonly && (
            <>
              <button
                type="button"
                onClick={cancelCount}
                className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={applyCount}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {applying ? "جاري الاعتماد..." : "اعتماد وتسوية المخزون"}
              </button>
            </>
          )}
          <button
            type="button"
            disabled={deleting}
            onClick={() => void deleteCount()}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "جاري الحذف..." : "حذف الجرد"}
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "الإجمالي", value: stats.total },
          { label: "تم العد", value: stats.counted },
          { label: "متبقي", value: stats.pending },
          { label: "فروقات", value: stats.variances },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-[11px] font-medium text-slate-500">{s.label}</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      {!isReadonly && (
        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">
              إضافة صنف للجرد
            </p>
            <p className="text-[11px] text-slate-500">
              F2 أو Ctrl+K للبحث · ↑↓ للاختيار · Enter · Esc
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={addSearchRef}
                type="text"
                value={addSearch}
                onChange={(e) => {
                  setAddSearch(e.target.value);
                  setPendingAddProduct(null);
                }}
                onKeyDown={handleAddSearchKeyDown}
                placeholder="ابحث بالاسم أو الكود ثم Enter..."
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pe-3 ps-9 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                autoComplete="off"
              />
              {addResults.length > 0 && !pendingAddProduct && (
                <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                  {addResults.map((p, idx) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={adding}
                        onClick={() => selectProductForQty(p)}
                        onMouseEnter={() => setHighlightIndex(idx)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm ${
                          idx === highlightIndex
                            ? "bg-blue-100 text-blue-950"
                            : "hover:bg-blue-50"
                        }`}
                      >
                        <span>
                          <span className="font-medium">{p.name}</span>
                          <span className="ms-2 font-mono text-xs text-slate-500">
                            {p.sku}
                          </span>
                        </span>
                        <span className="text-xs text-slate-500">
                          نظام: {p.quantity}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <input
              ref={addQtyRef}
              type="number"
              step="any"
              min={0}
              value={addQty}
              onChange={(e) => setAddQty(e.target.value)}
              onKeyDown={handleAddQtyKeyDown}
              placeholder="الكمية ثم Enter"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 sm:w-40"
            />
          </div>
          {pendingAddProduct ? (
            <p className="mt-1 text-[11px] font-medium text-blue-800">
              محدد: {pendingAddProduct.name} — اكتب الكمية واضغط Enter للإضافة
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">
              اكتب الكود أو الاسم → Enter → الكمية → Enter
            </p>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="تصفية القائمة بالاسم أو الكود..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
        <select
          value={filterMode}
          onChange={(e) =>
            setFilterMode(e.target.value as "all" | "pending" | "variance")
          }
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
        >
          <option value="all">كل الأصناف</option>
          <option value="pending">بدون إدخال</option>
          <option value="variance">ذات فرق فقط</option>
        </select>
      </div>

      {!isReadonly && filteredItems.length > 0 && (
        <p className="mb-2 text-[11px] text-slate-500">
          في جدول الكميات: Enter أو ↓ للصف التالي · ↑ للسابق · Esc للرجوع للبحث
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-gray-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 text-right font-semibold">الصنف</th>
                <th className="px-3 py-3 text-right font-semibold">الكود</th>
                <th className="px-3 py-3 text-center font-semibold">كمية النظام</th>
                <th className="px-3 py-3 text-center font-semibold">الكمية الفعلية</th>
                <th className="px-3 py-3 text-center font-semibold">الفرق</th>
                {!isReadonly && (
                  <th className="px-3 py-3 text-center font-semibold">حذف</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={isReadonly ? 5 : 6}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    لا توجد أصناف — ابحث بالأعلى واضغط Enter للإضافة
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const counted = item.counted_quantity;
                  const variance =
                    counted == null
                      ? null
                      : Number(counted) - Number(item.system_quantity);
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-gray-100 hover:bg-slate-50/80"
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-900">
                          {item.product?.name || "—"}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {item.product?.category?.name || "بدون تصنيف"}
                          {item.product?.unit ? ` · ${item.product.unit}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                        {item.product?.sku || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold">
                        {Number(item.system_quantity)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          ref={(el) => {
                            if (el) qtyInputRefs.current.set(item.id, el);
                            else qtyInputRefs.current.delete(item.id);
                          }}
                          type="number"
                          step="any"
                          disabled={isReadonly}
                          value={draftValues[item.id] ?? ""}
                          onChange={(e) =>
                            setDraftValues((d) => ({
                              ...d,
                              [item.id]: e.target.value,
                            }))
                          }
                          onBlur={(e) =>
                            void saveCounted(item.id, e.target.value)
                          }
                          onKeyDown={(e) => handleRowQtyKeyDown(e, item.id)}
                          className="mx-auto w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50"
                          placeholder="—"
                        />
                        {savingId === item.id && (
                          <span className="mt-0.5 block text-[10px] text-slate-400">
                            حفظ...
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-center font-semibold ${
                          variance == null
                            ? "text-slate-300"
                            : variance === 0
                              ? "text-emerald-600"
                              : variance > 0
                                ? "text-blue-700"
                                : "text-rose-600"
                        }`}
                      >
                        {variance == null
                          ? "—"
                          : variance > 0
                            ? `+${variance}`
                            : variance}
                      </td>
                      {!isReadonly && (
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => void removeItem(item.id)}
                            className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
                            aria-label="حذف"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showPrint && sheetConfig && (
        <InventorySheetPreview
          config={sheetConfig}
          products={printProducts}
          settings={settings}
          subtitle={`${count.count_number} · ${formatDateShort(count.created_at)}`}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

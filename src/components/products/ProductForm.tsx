"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { parseNumberInput, smartSearchMatch } from "@/lib/utils";
import {
  isOpeningQuantityMissing,
  PRODUCTS_OPENING_SETUP_SQL,
  PRODUCTS_OPENING_SETUP_SQL_URL,
} from "@/lib/products-opening-setup";
import {
  buyDiscountPercentForCategory,
  estimatedBuyPriceFromSell,
  isAnyCatalogBuyEstimate,
  resolveBuyPrice,
} from "@/lib/product-cost";
import {
  deleteProductTierPrices,
  listPriceTiers,
  upsertProductTierPrices,
} from "@/lib/price-tiers";
import { useToast } from "@/components/ui/Toast";
import type { Product, Category, PriceTier } from "@/types";
import { Plus, Shuffle } from "lucide-react";

function generateRandomSku(): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-4);
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return `P${ts}${rand}`.slice(0, 12);
}

function initialBuyPrice(
  product: Product | null,
  categoryName?: string | null
): number {
  const sell = Number(product?.sell_price) || 0;
  const buy = Number(product?.buy_price) || 0;
  const discount = buyDiscountPercentForCategory(categoryName);
  // Legacy catalog: buy was copied from sell → treat as missing cost
  if (sell > 0 && (buy <= 0 || Math.abs(buy - sell) < 0.005)) {
    return estimatedBuyPriceFromSell(sell, discount);
  }
  return buy;
}

const CREATE_CATEGORY_ID = "__create__";

interface ProductFormProps {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSave: () => void;
  /** يُستدعى بعد إنشاء قسم جديد عشان القائمة الأب تتحدث */
  onCategoryCreated?: (category: Category) => void;
}

export function ProductForm({
  product,
  categories,
  onClose,
  onSave,
  onCategoryCreated,
}: ProductFormProps) {
  const [form, setForm] = useState(() => {
    const categoryName = product?.category_id
      ? categories.find((c) => c.id === product.category_id)?.name
      : undefined;
    return {
      name: product?.name || "",
      sku: product?.sku || "",
      category_id: product?.category_id || "",
      unit: product?.unit || "قطعة",
      pack_size: Number(product?.pack_size ?? 1) || 1,
      buy_price: initialBuyPrice(product, categoryName),
      sell_price: product?.sell_price || 0,
      // لا نخلط الافتتاحي بالكمية الحالية — لو مفيش افتتاحي يبقى 0
      opening_quantity: Number(product?.opening_quantity ?? 0),
      min_quantity: product?.min_quantity ?? 5,
      notify_low_stock: product?.notify_low_stock ?? true,
      description: product?.description || "",
    };
  });
  const [tiers, setTiers] = useState<PriceTier[]>([]);
  /** Non-default tier id → sell price string for controlled inputs */
  const [tierPrices, setTierPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [error, setError] = useState("");
  const [needsSqlSetup, setNeedsSqlSetup] = useState(false);
  /** أقسام أُنشئت أثناء فتح الفورم قبل ما الأب يحدّث القائمة */
  const [createdCategories, setCreatedCategories] = useState<Category[]>([]);
  const [categoryQuery, setCategoryQuery] = useState(() => {
    if (!product?.category_id) return "";
    return categories.find((c) => c.id === product.category_id)?.name || "";
  });
  const [showCategoryList, setShowCategoryList] = useState(false);
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0);
  /** User typed buy_price manually — stop auto-syncing from sell */
  const buyManuallyEdited = useRef(
    !!product &&
      Number(product.buy_price) > 0 &&
      Math.abs(Number(product.buy_price) - Number(product.sell_price)) >= 0.005 &&
      !isAnyCatalogBuyEstimate(
        Number(product.buy_price),
        Number(product.sell_price)
      )
  );
  const supabase = createClient();
  const { error: toastError, success: toastSuccess } = useToast();

  const nonDefaultTiers = tiers.filter((t) => !t.is_default);

  const localCategories = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    for (const c of createdCategories) map.set(c.id, c);
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "ar")
    );
  }, [categories, createdCategories]);

  const selectedCategoryName =
    localCategories.find((c) => c.id === form.category_id)?.name ||
    categoryQuery ||
    "";
  const buyDiscountPercent = buyDiscountPercentForCategory(selectedCategoryName);

  useEffect(() => {
    if (product) return;
    let cancelled = false;
    async function loadDefaultThreshold() {
      const { data } = await supabase
        .from("settings")
        .select("default_low_stock_threshold")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      const threshold = Number(
        (data as { default_low_stock_threshold?: number })
          .default_low_stock_threshold ?? 0
      );
      if (threshold > 0) {
        setForm((prev) => ({ ...prev, min_quantity: threshold }));
      }
    }
    void loadDefaultThreshold();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  const trimmedCategoryQuery = categoryQuery.trim();
  const exactCategoryMatch = useMemo(() => {
    if (!trimmedCategoryQuery) return null;
    const key = trimmedCategoryQuery.toLowerCase();
    return (
      localCategories.find((c) => c.name.trim().toLowerCase() === key) || null
    );
  }, [localCategories, trimmedCategoryQuery]);

  const canCreateCategory =
    Boolean(trimmedCategoryQuery) && !exactCategoryMatch;

  const categoryOptions = useMemo(() => {
    const none = { id: "", name: "بدون قسم" };
    const filtered = localCategories.filter((c) =>
      smartSearchMatch(categoryQuery, [c.name])
    );
    const base = !trimmedCategoryQuery
      ? [none, ...localCategories]
      : [none, ...filtered];
    if (canCreateCategory) {
      return [
        ...base,
        {
          id: CREATE_CATEGORY_ID,
          name: `إنشاء قسم «${trimmedCategoryQuery}»`,
        },
      ];
    }
    return base;
  }, [
    localCategories,
    categoryQuery,
    trimmedCategoryQuery,
    canCreateCategory,
  ]);

  function selectCategory(id: string, name: string) {
    const discount = buyDiscountPercentForCategory(name);
    setForm((prev) => {
      const next = { ...prev, category_id: id };
      if (
        !buyManuallyEdited.current ||
        prev.buy_price <= 0 ||
        isAnyCatalogBuyEstimate(prev.buy_price, prev.sell_price)
      ) {
        next.buy_price = estimatedBuyPriceFromSell(prev.sell_price, discount);
        buyManuallyEdited.current = false;
      }
      return next;
    });
    setCategoryQuery(id ? name : "");
    setShowCategoryList(false);
  }

  async function createCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      toastError("اكتب اسم القسم أولاً");
      setShowCategoryList(true);
      return;
    }
    const existing = localCategories.find(
      (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      selectCategory(existing.id, existing.name);
      return;
    }

    setCreatingCategory(true);
    const { data, error: insertError } = await supabase
      .from("categories")
      .insert({ name: trimmed, description: null })
      .select("*")
      .single();

    setCreatingCategory(false);

    if (insertError || !data) {
      toastError(insertError?.message || "تعذر إنشاء القسم");
      return;
    }

    const created = data as Category;
    setCreatedCategories((prev) =>
      prev.some((c) => c.id === created.id) ? prev : [...prev, created]
    );
    selectCategory(created.id, created.name);
    onCategoryCreated?.(created);
    toastSuccess(`تم إنشاء قسم «${created.name}»`);
  }

  function handleCategoryKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showCategoryList && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setShowCategoryList(true);
      return;
    }
    if (e.key === "Escape") {
      setShowCategoryList(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveCategoryIndex((i) =>
        Math.min(i + 1, Math.max(0, categoryOptions.length - 1))
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveCategoryIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter" && showCategoryList && categoryOptions.length > 0) {
      e.preventDefault();
      const idx = Math.min(activeCategoryIndex, categoryOptions.length - 1);
      const opt = categoryOptions[idx];
      if (!opt) return;
      if (opt.id === CREATE_CATEGORY_ID) {
        void createCategory(trimmedCategoryQuery);
        return;
      }
      selectCategory(opt.id, opt.name);
    }
  }

  useEffect(() => {
    async function boot() {
      try {
        const list = await listPriceTiers(supabase);
        setTiers(list);
        if (!product?.id) return;
        const { data } = await supabase
          .from("product_tier_prices")
          .select("tier_id, sell_price")
          .eq("product_id", product.id);
        const next: Record<string, string> = {};
        for (const t of list.filter((x) => !x.is_default)) {
          const row = (data || []).find((r) => r.tier_id === t.id);
          next[t.id] =
            row != null && Number.isFinite(Number(row.sell_price))
              ? String(row.sell_price)
              : "";
        }
        setTierPrices(next);
      } catch {
        // tiers optional if migration not applied
      }
    }
    void boot();
  }, [product?.id, supabase]);

  const previewQuantity = product
    ? Number(product.quantity) +
      (Number(form.opening_quantity) - Number(product.opening_quantity ?? 0))
    : Number(form.opening_quantity);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNeedsSqlSetup(false);
    setLoading(true);

    if (!form.name || !form.sku) {
      setError("الاسم والكود مطلوبان");
      setLoading(false);
      return;
    }

    const skuTrim = form.sku.trim();
    let skuQuery = supabase
      .from("products")
      .select("id")
      .eq("sku", skuTrim)
      .limit(1);
    if (product?.id) skuQuery = skuQuery.neq("id", product.id);
    const { data: skuClash } = await skuQuery;
    if (skuClash && skuClash.length > 0) {
      setError("الكود مستخدم لصنف آخر — جرّب كوداً مختلفاً أو ولّد كوداً عشوائياً");
      setLoading(false);
      return;
    }

    const sellPrice = Number(form.sell_price);
    if (Number.isNaN(sellPrice) || sellPrice < 0) {
      toastError("سعر البيع لا يمكن أن يكون سالباً");
      setLoading(false);
      return;
    }

    const opening_quantity = Number(form.opening_quantity) || 0;
    // No fixed buy price: opening / catalog cost = sell − category trade discount
    const buyPrice = resolveBuyPrice(
      form.buy_price,
      sellPrice,
      buyDiscountPercent
    );

    const data: Record<string, unknown> = {
      name: form.name,
      sku: skuTrim,
      category_id: form.category_id || null,
      unit: form.unit,
      pack_size: Math.max(1, Number(form.pack_size) || 1),
      buy_price: buyPrice,
      sell_price: sellPrice,
      opening_quantity,
      min_quantity: Number(form.min_quantity),
      notify_low_stock: form.notify_low_stock,
      description: form.description || null,
    };

    let productId = product?.id || null;

    if (product) {
      const oldOpening = Number(product.opening_quantity ?? 0);
      data.quantity =
        Number(product.quantity) + (opening_quantity - oldOpening);
      const result = await supabase
        .from("products")
        .update(data)
        .eq("id", product.id);
      if (result.error) {
        setError(result.error.message);
        if (isOpeningQuantityMissing(result.error.message)) {
          setNeedsSqlSetup(true);
        }
        setLoading(false);
        return;
      }
    } else {
      data.quantity = opening_quantity;
      const result = await supabase
        .from("products")
        .insert(data)
        .select("id")
        .single();
      if (result.error || !result.data) {
        setError(result.error?.message || "تعذر الحفظ");
        if (isOpeningQuantityMissing(result.error?.message || "")) {
          setNeedsSqlSetup(true);
        }
        setLoading(false);
        return;
      }
      productId = result.data.id;
    }

    if (productId && nonDefaultTiers.length > 0) {
      try {
        const toUpsert: { tierId: string; sellPrice: number }[] = [];
        const toDelete: string[] = [];
        for (const t of nonDefaultTiers) {
          const raw = tierPrices[t.id];
          if (raw === "" || raw == null) {
            toDelete.push(t.id);
          } else {
            toUpsert.push({
              tierId: t.id,
              sellPrice: Number(raw) || 0,
            });
          }
        }
        if (toDelete.length > 0) {
          await deleteProductTierPrices(supabase, productId, toDelete);
        }
        if (toUpsert.length > 0) {
          await upsertProductTierPrices(supabase, productId, toUpsert);
        }
      } catch (tierErr) {
        toastError(
          tierErr instanceof Error
            ? tierErr.message
            : "تم حفظ الصنف لكن فشل حفظ أسعار الشرائح"
        );
      }
    }

    setLoading(false);
    onSave();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? "تعديل صنف" : "إضافة صنف جديد"}
    >
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {needsSqlSetup && (
        <div className="mb-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">يلزم تشغيل SQL مرة واحدة في Supabase</p>
          <div className="flex flex-wrap gap-2">
            <a
              href={PRODUCTS_OPENING_SETUP_SQL_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800"
            >
              فتح SQL Editor
            </a>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(PRODUCTS_OPENING_SETUP_SQL)
              }
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
            >
              نسخ SQL
            </button>
          </div>
          <pre className="max-h-32 overflow-auto rounded bg-white/80 p-2 text-[11px] text-amber-950" dir="ltr">
            {PRODUCTS_OPENING_SETUP_SQL}
          </pre>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            اسم الصنف *
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              الكود / الباركود *
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                dir="ltr"
                required
              />
              <button
                type="button"
                title="توليد كود عشوائي"
                onClick={() => setForm({ ...form, sku: generateRandomSku() })}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
              >
                <Shuffle className="h-3.5 w-3.5" />
                عشوائي
              </button>
            </div>
            <p className="mt-1 text-[10px] text-gray-400">
              يُستخدم للبحث والمسح في نقطة البيع وطباعة الملصقات
            </p>
          </div>
          <div className="relative">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              القسم
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={categoryQuery}
                onChange={(e) => {
                  setCategoryQuery(e.target.value);
                  setShowCategoryList(true);
                  setActiveCategoryIndex(0);
                  if (!e.target.value.trim()) {
                    setForm((prev) => ({ ...prev, category_id: "" }));
                  }
                }}
                onFocus={() => setShowCategoryList(true)}
                onBlur={() => {
                  window.setTimeout(() => setShowCategoryList(false), 150);
                }}
                onKeyDown={handleCategoryKeyDown}
                placeholder="ابحث أو أنشئ قسماً…"
                role="combobox"
                aria-expanded={showCategoryList}
                aria-controls="product-category-listbox"
                aria-autocomplete="list"
                disabled={creatingCategory}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                title="إضافة قسم جديد"
                disabled={creatingCategory}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (trimmedCategoryQuery) {
                    void createCategory(trimmedCategoryQuery);
                    return;
                  }
                  setShowCategoryList(true);
                  toastError("اكتب اسم القسم ثم اضغط +");
                }}
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {showCategoryList && (
              <ul
                id="product-category-listbox"
                role="listbox"
                className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
              >
                {categoryOptions.map((opt, index) => {
                  const isCreate = opt.id === CREATE_CATEGORY_ID;
                  return (
                    <li key={opt.id || "none"}>
                      <button
                        type="button"
                        id={`category-option-${index}`}
                        role="option"
                        aria-selected={index === activeCategoryIndex}
                        disabled={creatingCategory && isCreate}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (isCreate) {
                            void createCategory(trimmedCategoryQuery);
                            return;
                          }
                          selectCategory(opt.id, opt.name);
                        }}
                        className={`flex w-full items-center gap-1.5 px-3 py-2 text-right text-sm ${
                          isCreate
                            ? index === activeCategoryIndex
                              ? "bg-blue-100 font-semibold text-blue-800"
                              : "bg-blue-50 font-semibold text-blue-700 hover:bg-blue-100"
                            : index === activeCategoryIndex
                              ? "bg-blue-50 text-blue-800"
                              : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {isCreate && <Plus className="h-3.5 w-3.5 shrink-0" />}
                        {creatingCategory && isCreate
                          ? "جاري إنشاء القسم..."
                          : opt.name}
                      </button>
                    </li>
                  );
                })}
                {categoryOptions.length === 0 && (
                  <li className="px-3 py-2 text-sm text-gray-400">لا نتائج</li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              الوحدة
            </label>
            <select
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="قطعة">قطعة</option>
              <option value="كرتونة">كرتونة</option>
              <option value="متر">متر</option>
              <option value="كيلو">كيلو</option>
              <option value="لتر">لتر</option>
              <option value="علبة">علبة</option>
              <option value="طن">طن</option>
              <option value="لفة">لفة</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              وحدات التعبئة
            </label>
            <input
              type="number"
              min={1}
              step="1"
              value={form.pack_size}
              onChange={(e) => {
                const n = parseNumberInput(e.target.value);
                setForm({ ...form, pack_size: n === null ? 1 : Math.max(1, n) });
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              كم قطعة في الكرتونة/العلبة (المخزون بالقطعة)
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              سعر الشراء
            </label>
            <input
              type="number"
              step="0.01"
              value={form.buy_price === 0 ? "" : form.buy_price}
              onChange={(e) => {
                const n = parseNumberInput(e.target.value);
                buyManuallyEdited.current = true;
                setForm({ ...form, buy_price: n === null ? 0 : n });
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              افتراضي للرصيد الافتتاحي: خصم {buyDiscountPercent}٪ من سعر البيع
              {form.sell_price > 0
                ? ` (= ${estimatedBuyPriceFromSell(Number(form.sell_price), buyDiscountPercent)})`
                : ""}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              سعر البيع (تجزئة)
            </label>
            <input
              type="number"
              step="0.01"
              value={form.sell_price === 0 ? "" : form.sell_price}
              onChange={(e) => {
                const n = parseNumberInput(e.target.value);
                const sell = n === null ? 0 : n;
                const discount = buyDiscountPercentForCategory(
                  localCategories.find((c) => c.id === form.category_id)?.name ||
                    categoryQuery
                );
                setForm((prev) => {
                  const next = { ...prev, sell_price: sell };
                  if (
                    !buyManuallyEdited.current ||
                    prev.buy_price <= 0 ||
                    isAnyCatalogBuyEstimate(prev.buy_price, prev.sell_price)
                  ) {
                    next.buy_price = estimatedBuyPriceFromSell(sell, discount);
                    buyManuallyEdited.current = false;
                  }
                  return next;
                });
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
          </div>
        </div>

        {nonDefaultTiers.length > 0 && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
            <p className="mb-2 text-xs font-semibold text-blue-900">
              أسعار ثابتة للشرائح (اختياري)
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {nonDefaultTiers.map((tier) => (
                <div key={tier.id}>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {tier.name}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tierPrices[tier.id] ?? ""}
                    placeholder="اتركه فارغاً"
                    onChange={(e) =>
                      setTierPrices((prev) => ({
                        ...prev,
                        [tier.id]: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    dir="ltr"
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-gray-500">
              سعر ثابت اختياري يتقدّم على قواعد الخصم. اتركه فارغاً لاستخدام خصم
              الشريحة من الإعدادات (أو سعر التجزئة إن لم توجد قواعد).
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              رصيد افتتاحي
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.opening_quantity === 0 ? "" : form.opening_quantity}
              onChange={(e) => {
                const n = parseNumberInput(e.target.value);
                setForm({ ...form, opening_quantity: n === null ? 0 : n });
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
            <p className="mt-1 text-xs text-gray-500">
              {product
                ? "أساس حركة الصنف في أول الجدول. تعديلُه يغيّر المخزون الحالي بنفس الفرق فقط — مش بيستبدل الكمية."
                : "يُسجَّل كرصيد افتتاحي ومخزون ابتدائي عند إضافة الصنف"}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {product ? "المخزون الحالي (بعد الحفظ)" : "المخزون الابتدائي"}
            </label>
            <input
              type="number"
              value={previewQuantity}
              readOnly
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              dir="ltr"
            />
            {product && (
              <p className="mt-1 text-xs text-gray-500">
                الحالي الآن: {product.quantity} · الفرق المتوقع:{" "}
                {Number(form.opening_quantity) -
                  Number(product.opening_quantity ?? 0)}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              تتغير بالبيع والشراء والجرد — وليست للتعديل اليدوي هنا
            </p>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            الحد الأدنى
          </label>
          <input
            type="number"
            value={form.min_quantity === 0 ? "" : form.min_quantity}
            onChange={(e) => {
              const n = parseNumberInput(e.target.value);
              setForm({ ...form, min_quantity: n === null ? 0 : n });
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            dir="ltr"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <input
            type="checkbox"
            checked={form.notify_low_stock}
            onChange={(e) =>
              setForm({ ...form, notify_low_stock: e.target.checked })
            }
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-500"
          />
          <span>
            <span className="block text-sm font-medium text-gray-800">
              تنبيه عند نقص المخزون
            </span>
            <span className="mt-0.5 block text-xs text-gray-500">
              يظهر في جرس الإشعارات عندما الكمية تصل للحد الأدنى أو أقل. ألغِ
              التفعيل لكتم التنبيه دون إخفاء النقص من صفحة الأصناف.
            </span>
          </span>
        </label>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            ملاحظات
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {loading ? "جاري الحفظ..." : product ? "تحديث" : "إضافة"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
}

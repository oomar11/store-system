"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { Category, PriceTier, Product } from "@/types";

type Tab = "categories" | "products";

type CategoryRule = {
  category_id: string;
  discount_percent: number;
  category?: Category | null;
};

type ProductRule = {
  product_id: string;
  discount_percent: number;
  product?: Pick<Product, "id" | "name" | "sku"> | null;
};

type Props = {
  tier: PriceTier;
  onClose: () => void;
};

export function TierRulesModal({ tier, onClose }: Props) {
  const supabase = createClient();
  const { success: toastSuccess, error: toastError } = useToast();
  const [tab, setTab] = useState<Tab>("categories");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);
  const [productRules, setProductRules] = useState<ProductRule[]>([]);

  const [newCategoryId, setNewCategoryId] = useState("");
  const [newCategoryPct, setNewCategoryPct] = useState("10");
  const [productQuery, setProductQuery] = useState("");
  const [productHits, setProductHits] = useState<
    Pick<Product, "id" | "name" | "sku">[]
  >([]);
  const [selectedProduct, setSelectedProduct] = useState<Pick<
    Product,
    "id" | "name" | "sku"
  > | null>(null);
  const [newProductPct, setNewProductPct] = useState("10");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catsRes, catRulesRes, prodRulesRes] = await Promise.all([
        supabase.from("categories").select("id, name, description, created_at").order("name"),
        supabase
          .from("tier_category_discounts")
          .select("category_id, discount_percent, category:categories(id, name)")
          .eq("tier_id", tier.id),
        supabase
          .from("tier_product_discounts")
          .select(
            "product_id, discount_percent, product:products(id, name, sku)"
          )
          .eq("tier_id", tier.id),
      ]);
      if (catsRes.error) throw new Error(catsRes.error.message);
      if (catRulesRes.error) throw new Error(catRulesRes.error.message);
      if (prodRulesRes.error) throw new Error(prodRulesRes.error.message);

      setCategories((catsRes.data || []) as Category[]);
      setCategoryRules(
        (catRulesRes.data || []).map((r) => {
          const cat = r.category as Category | Category[] | null;
          return {
            category_id: r.category_id as string,
            discount_percent: Number(r.discount_percent) || 0,
            category: Array.isArray(cat) ? cat[0] ?? null : cat,
          };
        })
      );
      setProductRules(
        (prodRulesRes.data || []).map((r) => {
          const prod = r.product as
            | Pick<Product, "id" | "name" | "sku">
            | Pick<Product, "id" | "name" | "sku">[]
            | null;
          return {
            product_id: r.product_id as string,
            discount_percent: Number(r.discount_percent) || 0,
            product: Array.isArray(prod) ? prod[0] ?? null : prod,
          };
        })
      );
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر تحميل القواعد");
    } finally {
      setLoading(false);
    }
  }, [supabase, tier.id, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const usedCategoryIds = useMemo(
    () => new Set(categoryRules.map((r) => r.category_id)),
    [categoryRules]
  );

  const availableCategories = useMemo(
    () => categories.filter((c) => !usedCategoryIds.has(c.id)),
    [categories, usedCategoryIds]
  );

  useEffect(() => {
    const q = productQuery.trim();
    if (q.length < 1) {
      setProductHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku")
        .eq("is_active", true)
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
        .limit(8);
      if (cancelled) return;
      if (error) {
        setProductHits([]);
        return;
      }
      const used = new Set(productRules.map((r) => r.product_id));
      setProductHits(
        ((data || []) as Pick<Product, "id" | "name" | "sku">[]).filter(
          (p) => !used.has(p.id)
        )
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [productQuery, productRules, supabase]);

  function parsePct(raw: string): number | null {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    return n;
  }

  async function addCategoryRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryId) {
      toastError("اختر قسماً");
      return;
    }
    const pct = parsePct(newCategoryPct);
    if (pct == null) {
      toastError("نسبة الخصم يجب أن تكون بين 0 و 100");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("tier_category_discounts").upsert(
        {
          tier_id: tier.id,
          category_id: newCategoryId,
          discount_percent: pct,
        },
        { onConflict: "tier_id,category_id" }
      );
      if (error) throw new Error(error.message);
      setNewCategoryId("");
      setNewCategoryPct("10");
      toastSuccess("تمت إضافة خصم القسم");
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر الإضافة");
    } finally {
      setSaving(false);
    }
  }

  async function removeCategoryRule(categoryId: string) {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tier_category_discounts")
        .delete()
        .eq("tier_id", tier.id)
        .eq("category_id", categoryId);
      if (error) throw new Error(error.message);
      toastSuccess("تم الحذف");
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر الحذف");
    } finally {
      setSaving(false);
    }
  }

  async function addProductRule(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProduct) {
      toastError("اختر صنفاً");
      return;
    }
    const pct = parsePct(newProductPct);
    if (pct == null) {
      toastError("نسبة الخصم يجب أن تكون بين 0 و 100");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("tier_product_discounts").upsert(
        {
          tier_id: tier.id,
          product_id: selectedProduct.id,
          discount_percent: pct,
        },
        { onConflict: "tier_id,product_id" }
      );
      if (error) throw new Error(error.message);
      setSelectedProduct(null);
      setProductQuery("");
      setProductHits([]);
      setNewProductPct("10");
      toastSuccess("تمت إضافة خصم الصنف");
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر الإضافة");
    } finally {
      setSaving(false);
    }
  }

  async function removeProductRule(productId: string) {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tier_product_discounts")
        .delete()
        .eq("tier_id", tier.id)
        .eq("product_id", productId);
      if (error) throw new Error(error.message);
      toastSuccess("تم الحذف");
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر الحذف");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`قواعد «${tier.name}»`} wide>
      <p className="mb-4 text-xs text-[var(--muted)]">
        الأولوية عند البيع: سعر ثابت من بطاقة الصنف ← خصم منتج ← خصم قسم ← سعر
        التجزئة. النسب تُحسب من سعر التجزئة.
      </p>

      <div className="mb-4 flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-1">
        <button
          type="button"
          onClick={() => setTab("categories")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            tab === "categories"
              ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          خصم الأقسام
        </button>
        <button
          type="button"
          onClick={() => setTab("products")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            tab === "products"
              ? "bg-[var(--surface)] text-[var(--primary)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          خصم المنتجات
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
        </div>
      ) : tab === "categories" ? (
        <div className="space-y-4">
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {categoryRules.map((rule) => (
              <li
                key={rule.category_id}
                className="flex items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {rule.category?.name || "قسم"}
                  </p>
                  <p className="text-xs text-[var(--muted)]" dir="ltr">
                    خصم {rule.discount_percent}%
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void removeCategoryRule(rule.category_id)}
                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))]"
                  title="حذف"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {categoryRules.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-[var(--muted-soft)]">
                لا توجد خصومات أقسام
              </li>
            )}
          </ul>

          <form
            onSubmit={(e) => void addCategoryRule(e)}
            className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3"
          >
            <div className="min-w-[10rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                القسم
              </label>
              <select
                value={newCategoryId}
                onChange={(e) => setNewCategoryId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2.5 py-2 text-sm text-[var(--foreground)]"
              >
                <option value="">اختر قسماً</option>
                {availableCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                نسبة %
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={newCategoryPct}
                onChange={(e) => setNewCategoryPct(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2.5 py-2 text-sm text-[var(--foreground)]"
                dir="ltr"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !newCategoryId}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              إضافة
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {productRules.map((rule) => (
              <li
                key={rule.product_id}
                className="flex items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                    {rule.product?.name || "صنف"}
                  </p>
                  <p className="text-xs text-[var(--muted)]" dir="ltr">
                    {rule.product?.sku ? `${rule.product.sku} · ` : ""}
                    خصم {rule.discount_percent}%
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void removeProductRule(rule.product_id)}
                  className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))]"
                  title="حذف"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {productRules.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-[var(--muted-soft)]">
                لا توجد خصومات منتجات
              </li>
            )}
          </ul>

          <form
            onSubmit={(e) => void addProductRule(e)}
            className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3"
          >
            <div className="relative">
              <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                بحث عن صنف
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-soft)]" />
                <input
                  value={selectedProduct ? selectedProduct.name : productQuery}
                  onChange={(e) => {
                    setSelectedProduct(null);
                    setProductQuery(e.target.value);
                  }}
                  placeholder="اسم أو كود الصنف"
                  className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] py-2 pr-9 pl-3 text-sm text-[var(--foreground)]"
                />
              </div>
              {!selectedProduct && productHits.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
                  {productHits.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProduct(p);
                          setProductQuery("");
                          setProductHits([]);
                        }}
                        className="flex w-full flex-col items-start px-3 py-2 text-right text-sm hover:bg-[color-mix(in_srgb,var(--primary)_12%,var(--surface))]"
                      >
                        <span className="font-medium text-[var(--foreground)]">
                          {p.name}
                        </span>
                        <span className="text-xs text-[var(--muted)]" dir="ltr">
                          {p.sku}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-24">
                <label className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  نسبة %
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={newProductPct}
                  onChange={(e) => setNewProductPct(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2.5 py-2 text-sm text-[var(--foreground)]"
                  dir="ltr"
                />
              </div>
              <button
                type="submit"
                disabled={saving || !selectedProduct}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                إضافة
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
        >
          إغلاق
        </button>
      </div>
    </Modal>
  );
}

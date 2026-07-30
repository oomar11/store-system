"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, smartSearchMatch, stockQtyBadgeClass } from "@/lib/utils";
import { ProductForm } from "@/components/products/ProductForm";
import { TableRowActions, type RowAction } from "@/components/ui/TableRowActions";
import { BulkActionBar } from "@/components/ui/BulkActionBar";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { useSort } from "@/hooks/useSort";
import { useUrlSearchTerm } from "@/hooks/useUrlSearchTerm";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { BarcodeLabelsPreview } from "@/components/print/BarcodeLabelsPreview";
import { productListColumns } from "@/components/print/report-columns";
import { ExcelToolbar } from "@/components/excel/ExcelToolbar";
import { setProductLowStockNotify, isLowStock } from "@/lib/low-stock";
import {
  setEntitiesActive,
  setProductsLowStockNotify,
} from "@/lib/active-status";
import { notifyLowStockChanged } from "@/lib/inventory";
import { guardProductDelete } from "@/lib/delete-guards";
import { logAuditEvent } from "@/lib/audit";
import {
  getSnapshot,
  isBrowserOnline,
  readLocalThenNetwork,
  withTimeout,
} from "@/lib/offline";
import type { Product, Category, Settings } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Bell, BellOff, Package, Plus, Barcode } from "lucide-react";

export default function ProductsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canWriteProducts } = useAuth();
  const { error: toastError, info: toastInfo, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useUrlSearchTerm();
  const [filterCategory, setFilterCategory] = useState("");
  const [stockStatus, setStockStatus] = useState(
    () => searchParams.get("stock") || ""
  );
  const [notifyFilter, setNotifyFilter] = useState<"" | "on" | "off">("");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">(
    "active"
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showListPrint, setShowListPrint] = useState(false);
  const [labelProducts, setLabelProducts] = useState<Product[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [togglingNotifyId, setTogglingNotifyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const supabase = createClient();
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, []);

  async function fetchProducts() {
    const offline = !isBrowserOnline();

    await readLocalThenNetwork<{
      products: Product[];
      settings: Settings | null;
    }>({
      offline,
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap?.products?.length && !snap?.settings) return null;
        return {
          products: (snap.products || []).map(
            (p) =>
              ({
                ...p,
                category: null,
              }) as unknown as Product
          ),
          settings: (snap.settings as Settings | null) ?? null,
        };
      },
      network: async () => {
        const [prodRes, settingsRes] = await withTimeout(
          Promise.all([
            supabase
              .from("products")
              .select("*, category:categories(*)")
              .order("created_at", { ascending: false }),
            supabase.from("settings").select("*").limit(1).maybeSingle(),
          ]),
          5000
        );
        if (prodRes.error) throw prodRes.error;
        return {
          products: (prodRes.data as Product[]) || [],
          settings: (settingsRes.data as Settings | null) ?? null,
        };
      },
      apply: (data) => {
        setProducts(data.products);
        if (data.settings) setSettings(data.settings);
      },
    });

    setLoading(false);
  }

  async function fetchCategories() {
    try {
      if (!isBrowserOnline()) return;
      const data = await withTimeout(
        (async () => {
          const res = await supabase
            .from("categories")
            .select("*")
            .order("name");
          if (res.error) throw res.error;
          return res.data;
        })(),
        4000
      );
      if (data) setCategories(data);
    } catch {
      /* offline / timeout — filter stays empty */
    }
  }

  async function handleDelete(id: string) {
    const product = products.find((p) => p.id === id);
    const guard = await guardProductDelete(supabase, id, product?.name);
    if (!guard.ok) {
      toastError(guard.message);
      return;
    }
    if (
      !(await confirm({
        message: "هل أنت متأكد من حذف هذا الصنف؟ لا يمكن التراجع بعد الحذف.",
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;
    const { productsRepo, isLikelyOnline } = await import("@/lib/offline");
    await productsRepo.remove(id);
    if (isLikelyOnline()) {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) {
        toastError(error.message || "تعذر حذف الصنف من السيرفر — سيُعاد المحاولة عند المزامنة");
      } else {
        await logAuditEvent(supabase, {
          action: "product.delete",
          entityType: "product",
          entityId: id,
          entityLabel: product?.name || product?.sku || id,
          before: product
            ? { name: product.name, sku: product.sku, quantity: product.quantity }
            : null,
          source: "app",
        });
      }
    }
    setProducts(products.filter((p) => p.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function toggleNotify(product: Product) {
    const next = product.notify_low_stock === false;
    setTogglingNotifyId(product.id);
    setProducts((prev) =>
      prev.map((p) =>
        p.id === product.id ? { ...p, notify_low_stock: next } : p
      )
    );
    const { error } = await setProductLowStockNotify(supabase, product.id, next);
    if (error) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id
            ? { ...p, notify_low_stock: product.notify_low_stock }
            : p
        )
      );
      toastError("تعذر تحديث الإشعار: " + error);
    } else {
      notifyLowStockChanged();
    }
    setTogglingNotifyId(null);
  }

  async function toggleActive(product: Product) {
    const next = product.is_active === false;
    const label = next ? "تفعيل" : "إيقاف";
    if (
      !next &&
      !(await confirm({
        message: `إيقاف «${product.name}»؟ لن يظهر في نقطة البيع والمشتريات.`,
        tone: "danger",
        confirmLabel: "إيقاف",
      }))
    ) {
      return;
    }
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, is_active: next } : p))
    );
    const { error } = await setEntitiesActive(
      supabase,
      "products",
      [product.id],
      next,
      { [product.id]: product.name }
    );
    if (error) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id ? { ...p, is_active: product.is_active } : p
        )
      );
      toastError(`تعذر ${label} الصنف: ${error}`);
    } else {
      toastSuccess(next ? "تم تفعيل الصنف" : "تم إيقاف الصنف");
    }
  }

  async function bulkSetNotify(notify: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setProducts((prev) =>
      prev.map((p) =>
        selectedIds.has(p.id) ? { ...p, notify_low_stock: notify } : p
      )
    );
    const { error, updated } = await setProductsLowStockNotify(
      supabase,
      ids,
      notify
    );
    setBulkBusy(false);
    if (error) {
      toastError(error);
      await fetchProducts();
      return;
    }
    toastSuccess(
      notify
        ? `تم تفعيل الإشعارات لـ ${updated} صنف`
        : `تم إيقاف الإشعارات لـ ${updated} صنف`
    );
  }

  async function bulkSetActive(active: boolean) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !active &&
      !(await confirm({
        message: `إيقاف ${ids.length} صنف؟ لن تظهر في نقطة البيع والمشتريات.`,
        tone: "danger",
        confirmLabel: "إيقاف",
      }))
    ) {
      return;
    }
    setBulkBusy(true);
    const labels: Record<string, string> = {};
    for (const p of products) {
      if (selectedIds.has(p.id)) labels[p.id] = p.name;
    }
    setProducts((prev) =>
      prev.map((p) =>
        selectedIds.has(p.id) ? { ...p, is_active: active } : p
      )
    );
    const { error, updated } = await setEntitiesActive(
      supabase,
      "products",
      ids,
      active,
      labels
    );
    setBulkBusy(false);
    if (error) {
      toastError(error);
      await fetchProducts();
      return;
    }
    toastSuccess(
      active
        ? `تم تفعيل ${updated} صنف`
        : `تم إيقاف ${updated} صنف`
    );
    setSelectedIds(new Set());
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !(await confirm({
        message: `حذف ${ids.length} صنف؟ لا يمكن التراجع. الأصناف المرتبطة بفواتير ستُتخطى.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBulkBusy(true);
    const { productsRepo, isLikelyOnline } = await import("@/lib/offline");
    const online = isLikelyOnline();
    let deleted = 0;
    let skipped = 0;
    const deletedIds = new Set<string>();

    for (const id of ids) {
      const product = products.find((p) => p.id === id);
      const guard = await guardProductDelete(supabase, id, product?.name);
      if (!guard.ok) {
        skipped++;
        continue;
      }
      await productsRepo.remove(id);
      if (online) {
        const { error } = await supabase.from("products").delete().eq("id", id);
        if (error) {
          skipped++;
          continue;
        }
        await logAuditEvent(supabase, {
          action: "product.delete",
          entityType: "product",
          entityId: id,
          entityLabel: product?.name || product?.sku || id,
          before: product
            ? { name: product.name, sku: product.sku, quantity: product.quantity }
            : null,
          source: "app",
        });
      }
      deletedIds.add(id);
      deleted++;
    }

    setProducts((prev) => prev.filter((p) => !deletedIds.has(p.id)));
    setSelectedIds(new Set());
    setBulkBusy(false);

    if (deleted > 0 && skipped === 0) {
      toastSuccess(`تم حذف ${deleted} صنف`);
    } else if (deleted > 0) {
      toastInfo(`تم حذف ${deleted}، وتعذر حذف ${skipped}`);
    } else {
      toastError(`تعذر حذف الأصناف المحددة (${skipped})`);
    }
  }

  function productRowActions(product: Product): RowAction[] {
    const active = product.is_active !== false;
    return [
      {
        label: "ملصق",
        tone: "print",
        icon: "printer",
        onClick: () => setLabelProducts([product]),
      },
      {
        label: "حركة",
        tone: "history",
        icon: "history",
        onClick: () => router.push(`/products/${product.id}`),
      },
      ...(canWriteProducts
        ? [
            {
              label: "تعديل",
              tone: "edit" as const,
              icon: "pencil" as const,
              onClick: () => {
                setEditingProduct(product);
                setShowForm(true);
              },
            },
            {
              label: active ? "إيقاف" : "تفعيل",
              tone: "toggle" as const,
              icon: "power" as const,
              onClick: () => void toggleActive(product),
            },
            {
              label: "حذف",
              tone: "delete" as const,
              icon: "trash" as const,
              onClick: () => void handleDelete(product.id),
            },
          ]
        : []),
    ];
  }

  const lowStockCount = products.filter(
    (p) => p.is_active !== false && isLowStock(p.quantity, p.min_quantity)
  ).length;

  const filteredProducts = products.filter((p) => {
    const matchesSearch = smartSearchMatch(searchTerm, [p.name, p.sku]);
    const matchesCategory = !filterCategory || p.category_id === filterCategory;
    let matchesStock = true;
    if (stockStatus === "low") {
      matchesStock = isLowStock(p.quantity, p.min_quantity);
    } else if (stockStatus === "instock") {
      matchesStock = !isLowStock(p.quantity, p.min_quantity) && p.quantity > 0;
    } else if (stockStatus === "outofstock") {
      matchesStock = p.quantity === 0;
    }
    let matchesNotify = true;
    if (notifyFilter === "on") {
      matchesNotify = p.notify_low_stock !== false;
    } else if (notifyFilter === "off") {
      matchesNotify = p.notify_low_stock === false;
    }
    let matchesActive = true;
    if (activeFilter === "active") {
      matchesActive = p.is_active !== false;
    } else if (activeFilter === "inactive") {
      matchesActive = p.is_active === false;
    }
    return (
      matchesSearch &&
      matchesCategory &&
      matchesStock &&
      matchesNotify &&
      matchesActive
    );
  });

  const { items: sortedProducts, sortConfig, requestSort } = useSort(filteredProducts);

  const totalQuantity = sortedProducts.reduce((sum, p) => sum + p.quantity, 0);
  const totalBuyValue = sortedProducts.reduce((sum, p) => sum + p.quantity * p.buy_price, 0);
  const totalSellValue = sortedProducts.reduce((sum, p) => sum + p.quantity * p.sell_price, 0);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">الأصناف</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const targets =
                selectedIds.size > 0
                  ? sortedProducts.filter((p) => selectedIds.has(p.id))
                  : sortedProducts;
              if (targets.length === 0) {
                toastInfo("لا توجد أصناف لطباعة الملصقات");
                return;
              }
              setLabelProducts(targets);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <Barcode className="h-4 w-4" />
            ملصقات
            {selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </button>
          <PrintListButton
            onClick={() => setShowListPrint(true)}
            rowCount={sortedProducts.length}
            label="طباعة المخزون"
          />
          <ExcelToolbar
            entity="products"
            exportDisabled={sortedProducts.length === 0}
            products={products}
            exportProducts={sortedProducts}
            categories={categories}
            allowImport={canWriteProducts}
            onImported={() => {
              fetchProducts();
              fetchCategories();
            }}
          />
          {canWriteProducts && (
            <button
              onClick={() => {
                setEditingProduct(null);
                setShowForm(true);
              }}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              + إضافة صنف
            </button>
          )}
        </div>
      </div>

      {stockStatus === "low" && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          عرض النواقص فقط ({lowStockCount.toLocaleString("ar-EG")})
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="بحث بالاسم أو الكود..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">كل الأقسام</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        <select
          value={stockStatus}
          onChange={(e) => setStockStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">كل حالات المخزون</option>
          <option value="instock">متوفر</option>
          <option value="low">منخفض الكمية</option>
          <option value="outofstock">نفذت الكمية</option>
        </select>
        <select
          value={notifyFilter}
          onChange={(e) =>
            setNotifyFilter(e.target.value as "" | "on" | "off")
          }
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">كل الإشعارات</option>
          <option value="on">إشعار مفعّل</option>
          <option value="off">إشعار متوقف</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) =>
            setActiveFilter(e.target.value as "active" | "inactive" | "all")
          }
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="active">الأصناف النشطة</option>
          <option value="inactive">الموقوفة</option>
          <option value="all">الكل</option>
        </select>
      </div>

      {canWriteProducts && (
        <BulkActionBar
          count={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          actions={[
            {
              label: "تفعيل الإشعارات",
              tone: "warning",
              disabled: bulkBusy,
              onClick: () => void bulkSetNotify(true),
            },
            {
              label: "إيقاف الإشعارات",
              tone: "default",
              disabled: bulkBusy,
              onClick: () => void bulkSetNotify(false),
            },
            {
              label: "تفعيل الأصناف",
              tone: "success",
              disabled: bulkBusy,
              onClick: () => void bulkSetActive(true),
            },
            {
              label: "إيقاف الأصناف",
              tone: "warning",
              disabled: bulkBusy,
              onClick: () => void bulkSetActive(false),
            },
            {
              label: "حذف المحدد",
              tone: "danger",
              disabled: bulkBusy,
              onClick: () => void bulkDelete(),
            },
          ]}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto xl:overflow-x-visible">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 text-gray-600 sticky top-0 z-10 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] bg-gray-50/95 backdrop-blur-xs">
              <tr>
                <th className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={
                      sortedProducts.length > 0 &&
                      sortedProducts.every((p) => selectedIds.has(p.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(sortedProducts.map((p) => p.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    title="تحديد الكل"
                  />
                </th>
                <SortableHeader label="الصنف" field="name" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="الكود" field="sku" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="القسم" field="category.name" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="سعر الشراء" field="buy_price" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="سعر البيع" field="sell_price" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <SortableHeader label="الكمية" field="quantity" sortField={sortConfig.key} sortDirection={sortConfig.direction} onSort={requestSort} />
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  إشعار
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-700">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedProducts.map((product) => {
                const notifyOn = product.notify_low_stock !== false;
                const active = product.is_active !== false;
                return (
                <tr
                  key={product.id}
                  className={`hover:bg-gray-50 ${active ? "" : "bg-gray-50/80 opacity-75"}`}
                  onContextMenu={(e) =>
                    openMenu(e, toContextMenuItems(productRowActions(product)))
                  }
                >
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(product.id)}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(product.id);
                          else next.delete(product.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/products/${product.id}`}
                        className="font-medium text-[#1473e6] hover:underline"
                      >
                        {product.name}
                      </Link>
                      {!active && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                          موقوف
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600" dir="ltr">
                    {product.sku}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {product.category?.name || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatCurrency(product.buy_price)}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {formatCurrency(product.sell_price)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={stockQtyBadgeClass(
                        product.quantity <= 0
                          ? "out"
                          : isLowStock(product.quantity, product.min_quantity)
                            ? "low"
                            : "ok"
                      )}
                    >
                      {product.quantity} {product.unit}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {canWriteProducts ? (
                      <button
                        type="button"
                        title={
                          notifyOn
                            ? "إشعار النواقص مفعّل — اضغط لإيقافه"
                            : "إشعار النواقص متوقف — اضغط لتفعيله"
                        }
                        disabled={togglingNotifyId === product.id}
                        onClick={() => void toggleNotify(product)}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                          notifyOn
                            ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {notifyOn ? (
                          <Bell className="h-3.5 w-3.5" />
                        ) : (
                          <BellOff className="h-3.5 w-3.5" />
                        )}
                        {notifyOn ? "مفعّل" : "متوقف"}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">
                        {notifyOn ? "مفعّل" : "متوقف"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TableRowActions actions={productRowActions(product)} />
                  </td>
                </tr>
                );
              })}
              {sortedProducts.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10">
                    {products.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 text-center">
                        <Package className="h-9 w-9 text-gray-300" />
                        <p className="text-sm font-semibold text-gray-600">
                          لا توجد أصناف في المخزون
                        </p>
                        <p className="max-w-xs text-xs text-gray-500">
                          أضف أول صنف لتتبّع الكميات والأسعار والمبيعات
                        </p>
                        {canWriteProducts && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingProduct(null);
                              setShowForm(true);
                            }}
                            className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            إضافة صنف
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-center text-gray-500">
                        لا توجد نتائج مطابقة للبحث أو الفلتر
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            {sortedProducts.length > 0 && (
              <tfoot className="sticky bottom-0 bg-gray-50 font-bold border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-10">
                <tr className="bg-gray-50/95 backdrop-blur-xs text-gray-900">
                  <td></td>
                  <td className="px-4 py-3 font-semibold text-gray-700">إجمالي المعروض ({sortedProducts.length})</td>
                  <td colSpan={2}></td>
                  <td className="px-4 py-3 font-semibold text-blue-700">{formatCurrency(totalBuyValue)}</td>
                  <td className="px-4 py-3 font-semibold text-green-700">{formatCurrency(totalSellValue)}</td>
                  <td></td>
                  <td className="px-4 py-3 font-semibold text-gray-700" colSpan={3}>
                    {totalQuantity} وحدة
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {showListPrint && (
        <PrintReportPreview
          title="تقرير الأصناف والمخزون"
          rows={sortedProducts}
          columns={productListColumns}
          settings={settings}
          summary={[
            { label: "عدد الأصناف", value: String(sortedProducts.length) },
            { label: "إجمالي الكمية", value: String(totalQuantity) },
            { label: "قيمة الشراء", value: formatCurrency(totalBuyValue) },
            { label: "قيمة البيع", value: formatCurrency(totalSellValue) },
          ]}
          onClose={() => setShowListPrint(false)}
        />
      )}

      {labelProducts && (
        <BarcodeLabelsPreview
          products={labelProducts}
          settings={settings}
          onClose={() => setLabelProducts(null)}
        />
      )}

      {showForm && (
        <ProductForm
          product={editingProduct}
          categories={categories}
          onClose={() => setShowForm(false)}
          onSave={() => {
            setShowForm(false);
            fetchProducts();
          }}
          onCategoryCreated={(category) => {
            setCategories((prev) => {
              if (prev.some((c) => c.id === category.id)) return prev;
              return [...prev, category].sort((a, b) =>
                a.name.localeCompare(b.name, "ar")
              );
            });
          }}
        />
      )}
      {contextMenu}
    </div>
  );
}

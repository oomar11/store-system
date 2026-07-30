"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort, smartSearchMatch } from "@/lib/utils";
import {
  fetchProductMovements,
  assembleProductMovements,
  invoiceTypeLabel,
  movementSign,
  type MovementRow,
} from "@/lib/history";
import {
  InvoiceOperationModal,
  type InvoiceOpSelection,
} from "@/components/history/InvoiceOperationModal";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { BarcodeLabelsPreview } from "@/components/print/BarcodeLabelsPreview";
import { productMovementColumns } from "@/components/print/report-columns";
import { ProductForm } from "@/components/products/ProductForm";
import type { Category, Product, Settings } from "@/types";
import { ArrowRight, ExternalLink, Package, Pencil, Barcode } from "lucide-react";

type TypeFilter = "" | "sale" | "purchase" | "sale_return" | "purchase_return";

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = String(params.id || "");
  const supabase = useMemo(() => createClient(), []);

  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [selectedOp, setSelectedOp] = useState<InvoiceOpSelection | null>(null);
  const [showMovementsPrint, setShowMovementsPrint] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    const [prodRes, rows, settingsRes, catsRes] = await Promise.all([
      supabase
        .from("products")
        .select("*, category:categories(*)")
        .eq("id", productId)
        .maybeSingle(),
      fetchProductMovements(productId),
      supabase.from("settings").select("*").limit(1).maybeSingle(),
      supabase.from("categories").select("*").order("name"),
    ]);

    if (!prodRes.data) {
      setProduct(null);
      setMovements([]);
      setLoading(false);
      return;
    }

    const productData = prodRes.data as Product;
    setProduct(productData);
    setMovements(assembleProductMovements(productData, rows));
    if (settingsRes.data) setSettings(settingsRes.data);
    if (catsRes.data) setCategories(catsRes.data as Category[]);
    setLoading(false);
  }, [productId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return movements.filter((row) => {
      const inv = row.invoice;
      if (!inv) return false;
      // الرصيد الافتتاحي يظهر دائماً في أول الجدول إلا عند فلترة نوع معيّن
      if (row.isOpening || inv.type === "opening") {
        return !typeFilter;
      }
      if (typeFilter && inv.type !== typeFilter) return false;
      return smartSearchMatch(searchTerm, [
        inv.invoice_number,
        invoiceTypeLabel(inv.type),
        inv.customer?.name,
        inv.supplier?.name,
      ]);
    });
  }, [movements, searchTerm, typeFilter]);

  const inQty = filtered
    .filter((r) => !r.isOpening && movementSign(r.invoice!.type) > 0)
    .reduce((s, r) => s + Number(r.quantity), 0);
  const outQty = filtered
    .filter((r) => movementSign(r.invoice!.type) < 0)
    .reduce((s, r) => s + Number(r.quantity), 0);
  const lastBalance =
    filtered.length > 0
      ? filtered[filtered.length - 1].running_balance
      : product?.opening_quantity ?? 0;

  function openOperation(row: MovementRow) {
    const inv = row.invoice!;
    if (row.isOpening || inv.type === "opening") {
      setShowEdit(true);
      return;
    }
    setSelectedOp({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      type: inv.type,
      party: inv.customer?.name || inv.supplier?.name || "—",
      createdAt: inv.created_at,
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
        <p className="font-bold text-rose-800">الصنف غير موجود</p>
        <Link
          href="/products"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#1473e6]"
        >
          <ArrowRight className="h-4 w-4" />
          العودة للأصناف
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1473e6] hover:underline"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            الأصناف
          </button>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eaf4ff] text-[#1473e6]">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#172033]">{product.name}</h1>
              <p className="text-sm text-[#687386]">
                كود: <span className="font-mono font-semibold">{product.sku}</span>
                {product.category?.name ? ` · ${product.category.name}` : ""}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowLabels(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <Barcode className="h-4 w-4" />
            ملصق باركود
          </button>
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1473e6] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0f5fc0]"
          >
            <Pencil className="h-4 w-4" />
            تعديل الصنف
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailCard label="المخزون الحالي" value={`${product.quantity} ${product.unit}`} />
        <DetailCard label="سعر الشراء" value={formatCurrency(product.buy_price)} />
        <DetailCard label="سعر البيع" value={formatCurrency(product.sell_price)} />
        <DetailCard
          label="حد النواقص"
          value={`${product.min_quantity} ${product.unit}`}
          tone={product.quantity <= product.min_quantity ? "danger" : "default"}
        />
      </div>

      {product.description && (
        <div className="rounded-xl border border-[#e1e6ee] bg-white p-4 shadow-sm">
          <p className="text-sm text-[#526176]">{product.description}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[#e1e6ee] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#e1e6ee] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-[#172033]">عمليات الصنف</h2>
            <p className="text-xs text-[#687386]">
              اختر عملية للطباعة أو التعديل
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrintListButton
              onClick={() => setShowMovementsPrint(true)}
              rowCount={filtered.length}
              label="طباعة الحركة"
            />
            <input
              type="text"
              placeholder="بحث برقم المستند أو الطرف..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="min-w-[200px] rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
            >
              <option value="">كل الأنواع</option>
              <option value="sale">بيع</option>
              <option value="purchase">شراء</option>
              <option value="sale_return">مرتجع بيع</option>
              <option value="purchase_return">مرتجع شراء</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-[#eef1f6] bg-[#f8fafc] px-4 py-2.5 text-xs sm:grid-cols-4">
          <div>
            <span className="text-[#687386]">عدد العمليات: </span>
            <span className="font-bold text-[#172033]">{filtered.length}</span>
          </div>
          <div>
            <span className="text-[#687386]">وارد: </span>
            <span className="font-bold text-emerald-700">+{inQty}</span>
          </div>
          <div>
            <span className="text-[#687386]">منصرف: </span>
            <span className="font-bold text-rose-700">−{outQty}</span>
          </div>
          <div>
            <span className="text-[#687386]">رصيد بعد آخر حركة: </span>
            <span className="font-bold text-[#1473e6]">{lastBalance ?? 0}</span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#687386]">
            لا توجد عمليات مسجلة لهذا الصنف
          </p>
        ) : (
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#f3f6fa] text-[#526176]">
                <tr>
                  <th className="px-3 py-2.5 text-right font-semibold">التاريخ</th>
                  <th className="px-3 py-2.5 text-right font-semibold">المستند</th>
                  <th className="px-3 py-2.5 text-right font-semibold">النوع</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الطرف</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الكمية</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الرصيد</th>
                  <th className="px-3 py-2.5 text-right font-semibold">سعر الوحدة</th>
                  <th className="px-3 py-2.5 text-right font-semibold">الإجمالي</th>
                  <th className="px-3 py-2.5 text-right font-semibold">اختيار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef1f6]">
                {filtered.map((row) => {
                  const inv = row.invoice!;
                  const sign = movementSign(inv.type);
                  const party =
                    row.isOpening || inv.type === "opening"
                      ? "رصيد ابتدائي"
                      : inv.customer?.name || inv.supplier?.name || "—";
                  return (
                    <tr
                      key={row.id}
                      onClick={() => openOperation(row)}
                      className={`cursor-pointer hover:bg-[#eef6ff] ${
                        row.isOpening ? "bg-[#f8fbff]" : ""
                      }`}
                      title="اختر العملية"
                    >
                      <td className="px-3 py-2.5 text-[#526176]">
                        {row.isOpening
                          ? "—"
                          : formatDateShort(inv.created_at)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#1473e6]">
                        {inv.invoice_number}
                      </td>
                      <td className="px-3 py-2.5 font-semibold">
                        {invoiceTypeLabel(inv.type)}
                      </td>
                      <td className="px-3 py-2.5">{party}</td>
                      <td
                        className={`px-3 py-2.5 font-bold ${
                          sign > 0
                            ? "text-emerald-700"
                            : sign < 0
                              ? "text-rose-700"
                              : "text-[#172033]"
                        }`}
                      >
                        {sign > 0 ? "+" : sign < 0 ? "−" : ""}
                        {row.quantity}
                      </td>
                      <td className="px-3 py-2.5 font-bold text-[#1473e6]">
                        {row.running_balance ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.isOpening
                          ? "—"
                          : formatCurrency(row.unit_price)}
                      </td>
                      <td className="px-3 py-2.5 font-semibold">
                        {row.isOpening
                          ? "—"
                          : formatCurrency(row.total)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1 rounded-lg border border-[#9ec5f5] bg-[#eaf4ff] px-2 py-1 text-[11px] font-bold text-[#0b5fc4]">
                          <ExternalLink className="h-3.5 w-3.5" />
                          اختيار
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <InvoiceOperationModal
        selected={selectedOp}
        settings={settings}
        onClose={() => setSelectedOp(null)}
      />

      {showMovementsPrint && (
        <PrintReportPreview
          title={`حركة الصنف — ${product.name}`}
          subtitle={`الكود: ${product.sku} · المخزون الحالي: ${product.quantity} ${product.unit}`}
          rows={filtered}
          columns={productMovementColumns}
          settings={settings}
          summary={[
            { label: "عدد العمليات", value: String(filtered.length) },
            { label: "وارد", value: `+${inQty}` },
            { label: "منصرف", value: `−${outQty}` },
            {
              label: "رصيد افتتاحي",
              value: `${product.opening_quantity ?? 0} ${product.unit}`,
            },
            {
              label: "المخزون الحالي",
              value: `${product.quantity} ${product.unit}`,
            },
          ]}
          onClose={() => setShowMovementsPrint(false)}
        />
      )}

      {showLabels && (
        <BarcodeLabelsPreview
          products={[product]}
          settings={settings}
          onClose={() => setShowLabels(false)}
          defaultCopies={1}
        />
      )}

      {showEdit && (
        <ProductForm
          product={product}
          categories={categories}
          onClose={() => setShowEdit(false)}
          onSave={() => {
            setShowEdit(false);
            void load();
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
    </div>
  );
}

function DetailCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-xl border border-[#e1e6ee] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-[#687386]">{label}</p>
      <p
        className={`mt-1 text-lg font-bold ${
          tone === "danger" ? "text-rose-700" : "text-[#172033]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

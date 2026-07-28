"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { formatDateShort } from "@/lib/utils";
import { printReport } from "@/lib/print";
import type { InventorySheetConfig, Product, Settings } from "@/types";
import { resolveStoreName } from "./report-columns";
import { PrintBrandMark } from "./PrintBrandMark";

export type InventorySheetRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  categoryName: string;
  systemQty: number | null;
};

type Props = {
  config: InventorySheetConfig;
  products: Product[];
  settings: Settings | null;
  subtitle?: string;
  onClose: () => void;
  /** When true, render only the sheet body (for live preview embeds). */
  embedded?: boolean;
};

function productToRow(p: Product): InventorySheetRow {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku || "",
    unit: p.unit || "قطعة",
    categoryName: p.category?.name || "بدون تصنيف",
    systemQty: Number(p.quantity ?? 0),
  };
}

export function buildInventorySheetRows(
  products: Product[],
  config: InventorySheetConfig
): { rows: InventorySheetRow[]; groups: { name: string; rows: InventorySheetRow[] }[] } {
  const sorted = [...products].sort((a, b) => {
    const catA = a.category?.name || "بدون تصنيف";
    const catB = b.category?.name || "بدون تصنيف";
    if (config.group_by_category && catA !== catB) {
      return catA.localeCompare(catB, "ar");
    }
    return a.name.localeCompare(b.name, "ar");
  });

  const rows = sorted.map(productToRow);
  const blankRows: InventorySheetRow[] = Array.from(
    { length: config.extra_blank_rows },
    (_, i) => ({
      id: `blank-${i}`,
      name: "",
      sku: "",
      unit: "",
      categoryName: "",
      systemQty: null,
    })
  );

  if (!config.group_by_category) {
    return { rows: [...rows, ...blankRows], groups: [] };
  }

  const map = new Map<string, InventorySheetRow[]>();
  for (const row of rows) {
    const key = row.categoryName || "بدون تصنيف";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }

  const groups = Array.from(map.entries()).map(([name, groupRows]) => ({
    name,
    rows: groupRows,
  }));

  if (blankRows.length > 0) {
    groups.push({ name: "أصناف إضافية", rows: blankRows });
  }

  return { rows: [...rows, ...blankRows], groups };
}

function BlankCell({ wide }: { wide?: boolean }) {
  return (
    <td className={`border border-slate-400 ${wide ? "min-w-[4.5rem]" : "min-w-[3rem]"}`}>
      <div className="h-6" />
    </td>
  );
}

function SheetTable({
  config,
  products,
  settings,
  subtitle,
  titleOverride,
}: {
  config: InventorySheetConfig;
  products: Product[];
  settings: Settings | null;
  subtitle?: string;
  titleOverride?: string;
}) {
  const printedAt = useMemo(() => new Date(), []);
  const { rows, groups } = useMemo(
    () => buildInventorySheetRows(products, config),
    [products, config]
  );

  const storeName = resolveStoreName(settings);
  const storePhone = settings?.phone || "";
  const storeAddress = settings?.address || "";
  const title = titleOverride || config.title;

  const colSpan =
    1 + // #
    1 + // name
    (config.show_sku ? 1 : 0) +
    (config.show_category && !config.group_by_category ? 1 : 0) +
    (config.show_unit ? 1 : 0) +
    (config.show_system_qty ? 1 : 0) +
    (config.show_counted_blank ? 1 : 0) +
    (config.show_variance_blank ? 1 : 0) +
    (config.show_notes_blank ? 1 : 0);

  function renderRow(row: InventorySheetRow, index: number) {
    return (
      <tr key={row.id} className="border-b border-slate-300">
        <td className="border border-slate-300 px-1 py-1 text-center text-slate-500">
          {index + 1}
        </td>
        <td className="border border-slate-300 px-1.5 py-1 font-medium">
          {row.name || "\u00a0"}
        </td>
        {config.show_sku && (
          <td className="border border-slate-300 px-1 py-1 font-mono text-[10px]">
            {row.sku || "\u00a0"}
          </td>
        )}
        {config.show_category && !config.group_by_category && (
          <td className="border border-slate-300 px-1 py-1 text-[10px]">
            {row.categoryName || "\u00a0"}
          </td>
        )}
        {config.show_unit && (
          <td className="border border-slate-300 px-1 py-1 text-center text-[10px]">
            {row.unit || "\u00a0"}
          </td>
        )}
        {config.show_system_qty && (
          <td className="border border-slate-300 px-1 py-1 text-center font-semibold">
            {row.systemQty == null ? "\u00a0" : row.systemQty}
          </td>
        )}
        {config.show_counted_blank && <BlankCell wide />}
        {config.show_variance_blank && <BlankCell />}
        {config.show_notes_blank && <BlankCell wide />}
      </tr>
    );
  }

  let rowIndex = 0;

  return (
    <div
      className="print-paper print-report-sheet w-full text-black"
      data-watermark={storeName}
      dir="rtl"
    >
      <div className="mb-3 border-b border-slate-400 pb-2 text-center">
        <PrintBrandMark />
        <h1 className="text-xl font-black">{storeName}</h1>
        {(storeAddress || storePhone) && (
          <p className="mt-1 text-[11px] text-slate-600">
            {[storeAddress, storePhone].filter(Boolean).join(" · ")}
          </p>
        )}
        <h2 className="mt-2 text-base font-bold">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-[11px] text-slate-600">{subtitle}</p>
        )}
        {config.header_notes.trim() && (
          <p className="mt-1 text-[11px] text-slate-700">{config.header_notes}</p>
        )}
        <p className="mt-1 text-[10px] text-slate-500">
          تاريخ الطباعة: {formatDateShort(printedAt)}
        </p>
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2 border-slate-800 bg-slate-100">
            <th className="border border-slate-400 px-1 py-1.5 text-center font-bold">#</th>
            <th className="border border-slate-400 px-1 py-1.5 text-right font-bold">الصنف</th>
            {config.show_sku && (
              <th className="border border-slate-400 px-1 py-1.5 text-right font-bold">الكود</th>
            )}
            {config.show_category && !config.group_by_category && (
              <th className="border border-slate-400 px-1 py-1.5 text-right font-bold">التصنيف</th>
            )}
            {config.show_unit && (
              <th className="border border-slate-400 px-1 py-1.5 text-center font-bold">الوحدة</th>
            )}
            {config.show_system_qty && (
              <th className="border border-slate-400 px-1 py-1.5 text-center font-bold">
                كمية النظام
              </th>
            )}
            {config.show_counted_blank && (
              <th className="border border-slate-400 px-1 py-1.5 text-center font-bold">
                الكمية الفعلية
              </th>
            )}
            {config.show_variance_blank && (
              <th className="border border-slate-400 px-1 py-1.5 text-center font-bold">الفرق</th>
            )}
            {config.show_notes_blank && (
              <th className="border border-slate-400 px-1 py-1.5 text-center font-bold">ملاحظات</th>
            )}
          </tr>
        </thead>
        <tbody>
          {config.group_by_category
            ? groups.map((group) => (
                <Fragment key={`g-${group.name}`}>
                  <tr className="print-keep-together bg-slate-200">
                    <td
                      colSpan={colSpan}
                      className="border border-slate-400 px-2 py-1.5 text-right text-xs font-bold"
                    >
                      {group.name}
                    </td>
                  </tr>
                  {group.rows.map((row) => renderRow(row, rowIndex++))}
                </Fragment>
              ))
            : rows.map((row) => renderRow(row, rowIndex++))}

          {rows.length === 0 && (
            <tr>
              <td
                colSpan={colSpan}
                className="border border-slate-300 py-8 text-center text-slate-500"
              >
                لا توجد أصناف
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-6 grid grid-cols-2 gap-8 text-[11px]">
        <div className="border-t border-slate-400 pt-2">
          <p className="font-bold">توقيع الجرد:</p>
          <p className="mt-6 text-slate-400">........................</p>
        </div>
        <div className="border-t border-slate-400 pt-2">
          <p className="font-bold">توقيع الاعتماد:</p>
          <p className="mt-6 text-slate-400">........................</p>
        </div>
      </div>
    </div>
  );
}

/** Live preview of the sheet (no modal). */
export function InventorySheetLivePreview({
  config,
  products,
  settings,
  subtitle,
}: Omit<Props, "onClose" | "embedded">) {
  return (
    <div className="print-paper rounded-lg border border-[var(--border)] p-4 shadow-sm">
      <SheetTable
        config={config}
        products={products}
        settings={settings}
        subtitle={subtitle}
      />
    </div>
  );
}

/** Modal print preview for inventory sheets. */
export function InventorySheetPreview({
  config,
  products,
  settings,
  subtitle,
  onClose,
}: Props) {
  const [title, setTitle] = useState(config.title);
  const canPortal = typeof document !== "undefined";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!canPortal) return null;

  const sheet = (
    <SheetTable
      config={{ ...config, title }}
      products={products}
      settings={settings}
      subtitle={subtitle}
      titleOverride={title}
    />
  );

  return createPortal(
    <div className="print-portal fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="app-theme my-6 w-full max-w-4xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] shadow-2xl no-print">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--foreground)]">معاينة ورقة الجرد</h3>
              <p className="text-[11px] text-[var(--muted)]">
                {products.length} صنف · اطبع للعد اليدوي
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 bg-[var(--surface)] px-5 pb-4">
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-[var(--muted)]">عنوان الورقة</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[var(--border)] py-3 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={() => printReport()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] py-3 text-xs font-bold text-white hover:bg-[var(--primary-dark)]"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </button>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto bg-[var(--surface-muted)] p-4">
          <div className="print-paper mx-auto max-w-[210mm] rounded p-6 shadow-md">
            {sheet}
          </div>
        </div>
      </div>

      <div className="hidden print:block print-report">{sheet}</div>
    </div>,
    document.body
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import {
  formatCurrency,
  formatDateShort,
  INVENTORY_COUNT_STATUS_LABELS,
} from "@/lib/utils";
import { printReport } from "@/lib/print";
import type { InventoryCount, Settings } from "@/types";
import { resolveStoreName } from "./report-columns";
import { PrintBrandMark } from "./PrintBrandMark";

export type InventoryCountFinanceRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string;
  system_quantity: number;
  counted_quantity: number;
  variance: number;
  buy_price: number;
  sell_price: number;
  buy_variance_value: number;
  sell_variance_value: number;
  notes: string;
};

type Props = {
  count: InventoryCount;
  rows: InventoryCountFinanceRow[];
  settings: Settings | null;
  onClose: () => void;
};

function formatSignedQty(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

function formatSignedMoney(n: number): string {
  const formatted = formatCurrency(Math.abs(n));
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}

function ReportBody({
  title,
  count,
  rows,
  settings,
  printedAt,
}: {
  title: string;
  count: InventoryCount;
  rows: InventoryCountFinanceRow[];
  settings: Settings | null;
  printedAt: Date;
}) {
  const storeName = resolveStoreName(settings);
  const storePhone = settings?.phone || "";
  const storeAddress = settings?.address || "";

  const varianceRows = useMemo(
    () => rows.filter((r) => r.variance !== 0),
    [rows]
  );

  const finance = useMemo(() => {
    let buyIncrease = 0;
    let buyDecrease = 0;
    let sellIncrease = 0;
    let sellDecrease = 0;
    for (const r of varianceRows) {
      if (r.buy_variance_value > 0) buyIncrease += r.buy_variance_value;
      else if (r.buy_variance_value < 0) buyDecrease += Math.abs(r.buy_variance_value);
      if (r.sell_variance_value > 0) sellIncrease += r.sell_variance_value;
      else if (r.sell_variance_value < 0) sellDecrease += Math.abs(r.sell_variance_value);
    }
    return {
      buyIncrease,
      buyDecrease,
      buyNet: buyIncrease - buyDecrease,
      sellIncrease,
      sellDecrease,
      sellNet: sellIncrease - sellDecrease,
      varianceCount: varianceRows.length,
    };
  }, [varianceRows]);

  const subtitle = [
    INVENTORY_COUNT_STATUS_LABELS[count.status] || count.status,
    formatDateShort(count.created_at),
    count.completed_at
      ? `اعتماد: ${formatDateShort(count.completed_at)}`
      : null,
    count.notes?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");

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
        <p className="mt-1 text-[10px] text-slate-500">
          تاريخ الطباعة: {formatDateShort(printedAt)}
        </p>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <SummaryBox label="أصناف معدودة" value={String(rows.length)} />
        <SummaryBox label="بها فرق" value={String(finance.varianceCount)} />
        <SummaryBox
          label="زيادة شراء"
          value={formatCurrency(finance.buyIncrease)}
        />
        <SummaryBox
          label="نقص شراء"
          value={formatCurrency(finance.buyDecrease)}
        />
        <SummaryBox
          label="صافي شراء"
          value={formatSignedMoney(finance.buyNet)}
        />
        <SummaryBox
          label="زيادة بيع"
          value={formatCurrency(finance.sellIncrease)}
        />
        <SummaryBox
          label="نقص بيع"
          value={formatCurrency(finance.sellDecrease)}
        />
        <SummaryBox
          label="صافي بيع"
          value={formatSignedMoney(finance.sellNet)}
        />
      </div>

      <h3 className="mb-1 text-xs font-bold text-slate-800">كل الأصناف المعدودة</h3>
      <FinanceTable rows={rows} />

      {varianceRows.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-1 text-xs font-bold text-slate-800">
            أصناف بها فرق فقط ({varianceRows.length})
          </h3>
          <FinanceTable rows={varianceRows} compact />
        </div>
      )}

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

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-300 px-2 py-1.5">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="font-bold text-slate-900">{value}</p>
    </div>
  );
}

function FinanceTable({
  rows,
  compact = false,
}: {
  rows: InventoryCountFinanceRow[];
  compact?: boolean;
}) {
  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="border-b-2 border-slate-800 bg-slate-100">
          <th className="border border-slate-400 px-1 py-1 text-center font-bold">#</th>
          <th className="border border-slate-400 px-1 py-1 text-right font-bold">الصنف</th>
          {!compact && (
            <th className="border border-slate-400 px-1 py-1 text-right font-bold">الكود</th>
          )}
          <th className="border border-slate-400 px-1 py-1 text-right font-bold">القسم</th>
          <th className="border border-slate-400 px-1 py-1 text-center font-bold">نظام</th>
          <th className="border border-slate-400 px-1 py-1 text-center font-bold">فعلي</th>
          <th className="border border-slate-400 px-1 py-1 text-center font-bold">فرق</th>
          {!compact && (
            <th className="border border-slate-400 px-1 py-1 text-center font-bold">تكلفة</th>
          )}
          <th className="border border-slate-400 px-1 py-1 text-center font-bold">قيمة شراء</th>
          {!compact && (
            <th className="border border-slate-400 px-1 py-1 text-center font-bold">بيع</th>
          )}
          <th className="border border-slate-400 px-1 py-1 text-center font-bold">قيمة بيع</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={compact ? 8 : 11}
              className="border border-slate-300 py-6 text-center text-slate-500"
            >
              لا توجد أصناف معدودة
            </td>
          </tr>
        ) : (
          rows.map((row, index) => (
            <tr
              key={row.id}
              className={`border-b border-slate-300 ${
                row.variance !== 0 ? "bg-amber-50/60" : ""
              }`}
            >
              <td className="border border-slate-300 px-1 py-1 text-center text-slate-500">
                {index + 1}
              </td>
              <td className="border border-slate-300 px-1 py-1 font-medium">
                {row.name}
              </td>
              {!compact && (
                <td className="border border-slate-300 px-1 py-1 font-mono">
                  {row.sku || "—"}
                </td>
              )}
              <td className="border border-slate-300 px-1 py-1">{row.category}</td>
              <td className="border border-slate-300 px-1 py-1 text-center">
                {row.system_quantity}
              </td>
              <td className="border border-slate-300 px-1 py-1 text-center font-semibold">
                {row.counted_quantity}
              </td>
              <td className="border border-slate-300 px-1 py-1 text-center font-bold">
                {formatSignedQty(row.variance)}
              </td>
              {!compact && (
                <td className="border border-slate-300 px-1 py-1 text-center">
                  {formatCurrency(row.buy_price)}
                </td>
              )}
              <td className="border border-slate-300 px-1 py-1 text-center font-semibold">
                {formatSignedMoney(row.buy_variance_value)}
              </td>
              {!compact && (
                <td className="border border-slate-300 px-1 py-1 text-center">
                  {formatCurrency(row.sell_price)}
                </td>
              )}
              <td className="border border-slate-300 px-1 py-1 text-center font-semibold">
                {formatSignedMoney(row.sell_variance_value)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export function InventoryCountResultPreview({
  count,
  rows,
  settings,
  onClose,
}: Props) {
  const [title, setTitle] = useState(`نتيجة الجرد ${count.count_number}`);
  const canPortal = typeof document !== "undefined";
  const printedAt = useMemo(() => new Date(), []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!canPortal) return null;

  const report = (
    <ReportBody
      title={title}
      count={count}
      rows={rows}
      settings={settings}
      printedAt={printedAt}
    />
  );

  return createPortal(
    <div className="print-portal fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="app-theme my-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] shadow-2xl no-print">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface))] text-[var(--primary)]">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--foreground)]">
                معاينة نتيجة الجرد
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                {rows.length} صنف معدود · تحليل شراء وبيع
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
            <span className="mb-1 block font-semibold text-[var(--muted)]">
              عنوان التقرير
            </span>
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

        <div className="max-h-[55vh] overflow-y-auto bg-[var(--surface-muted)] p-4">
          <div className="print-paper mx-auto max-w-[210mm] rounded p-6 shadow-md">
            {report}
          </div>
        </div>
      </div>

      <div className="hidden print:block print-report">{report}</div>
    </div>,
    document.body
  );
}

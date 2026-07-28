"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { formatDateShort } from "@/lib/utils";
import { printReport } from "@/lib/print";
import type { Settings } from "@/types";
import { resolveStoreName, type ReportColumn } from "./report-columns";
import { PrintBrandMark } from "./PrintBrandMark";

type SummaryItem = { label: string; value: string };

interface PrintReportPreviewProps<T extends { id?: string }> {
  title: string;
  rows: T[];
  columns: ReportColumn[];
  settings: Settings | null;
  summary?: SummaryItem[];
  subtitle?: string;
  onClose: () => void;
  getRowId?: (row: T, index: number) => string;
}

export function PrintReportPreview<T extends { id?: string }>({
  title: initialTitle,
  rows,
  columns,
  settings,
  summary = [],
  subtitle,
  onClose,
}: PrintReportPreviewProps<T>) {
  const [title, setTitle] = useState(initialTitle);
  const [notes, setNotes] = useState("");
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() =>
    columns.map((c) => c.key)
  );
  const canPortal = typeof document !== "undefined";
  const printedAt = useMemo(() => new Date(), []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const visibleColumns = columns.filter((c) => visibleKeys.includes(c.key));

  const storeName = resolveStoreName(settings);
  const storePhone = settings?.phone || "";
  const storeAddress = settings?.address || "";

  function toggleColumn(key: string) {
    setVisibleKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  if (!canPortal) return null;

  const reportBody = (
    <div
      className="print-paper print-report-sheet w-full text-black"
      data-watermark={storeName}
      dir="rtl"
    >
      <div className="mb-4 border-b border-slate-300 pb-3 text-center">
        <PrintBrandMark />
        <h1 className="text-xl font-black">{storeName}</h1>
        {(storeAddress || storePhone) && (
          <p className="mt-1 text-[11px] text-slate-600">
            {[storeAddress, storePhone].filter(Boolean).join(" · ")}
          </p>
        )}
        <h2 className="mt-3 text-base font-bold">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-[11px] text-slate-600">{subtitle}</p>
        )}
        <p className="mt-1 text-[10px] text-slate-500">
          تاريخ الطباعة: {formatDateShort(printedAt)}
        </p>
      </div>

      {summary.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-3 text-[11px]">
          {summary.map((item) => (
            <div
              key={item.label}
              className="rounded border border-slate-200 px-2 py-1"
            >
              <span className="text-slate-500">{item.label}: </span>
              <span className="font-bold">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2 border-slate-800">
            <th className="px-1 py-1.5 text-right font-bold">#</th>
            {visibleColumns.map((col) => (
              <th key={col.key} className="px-1 py-1.5 text-right font-bold">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={visibleColumns.length + 1}
                className="py-6 text-center text-slate-500"
              >
                لا توجد بيانات للطباعة
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={row.id != null ? String(row.id) : `row-${index}`}
                className="border-b border-slate-200"
              >
                <td className="px-1 py-1.5 text-slate-500">{index + 1}</td>
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-1 py-1.5">
                    {col.getValue(row as Record<string, unknown>)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {notes.trim() && (
        <div className="mt-4 border-t border-dashed border-slate-300 pt-2 text-[11px]">
          <p className="font-bold text-slate-700">ملاحظات:</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-800">{notes}</p>
        </div>
      )}
    </div>
  );

  return createPortal(
    <div className="print-portal fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="my-6 w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl no-print">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">معاينة التقرير</h3>
              <p className="text-[11px] text-slate-500">
                {rows.length} صف · عدّل ثم اطبع
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 bg-white px-5 pb-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-slate-600">
                عنوان التقرير
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-slate-600">
                ملاحظات (اختياري)
              </span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="تظهر أسفل التقرير عند الطباعة"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">
              الأعمدة الظاهرة
            </p>
            <div className="flex flex-wrap gap-2">
              {columns.map((col) => (
                <label
                  key={col.key}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium"
                >
                  <input
                    type="checkbox"
                    checked={visibleKeys.includes(col.key)}
                    onChange={() => toggleColumn(col.key)}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-300 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={() => printReport()}
              disabled={visibleColumns.length === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </button>
          </div>
        </div>

        <div className="max-h-[40vh] overflow-y-auto bg-slate-200 p-4">
          <div className="print-paper mx-auto max-w-[210mm] rounded p-6 shadow-md">
            {reportBody}
          </div>
        </div>
      </div>

      <div className="hidden print:block print-report">{reportBody}</div>
    </div>,
    document.body
  );
}

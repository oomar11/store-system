"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { printReport } from "@/lib/print";
import { barcodeToSvg } from "@/lib/barcode-code128";
import {
  LABEL_SIZE_OPTS,
  resolvePrintFormats,
} from "@/lib/print-formats";
import { resolveStoreName } from "@/components/print/report-columns";
import { PrintBrandMark } from "@/components/print/PrintBrandMark";
import type { Product, Settings } from "@/types";

type BarcodeLabelsPreviewProps = {
  products: Product[];
  settings: Settings | null;
  onClose: () => void;
  /** copies of each label */
  defaultCopies?: number;
};

export function BarcodeLabelsPreview({
  products,
  settings,
  onClose,
  defaultCopies = 1,
}: BarcodeLabelsPreviewProps) {
  const printOpts = useMemo(
    () => resolvePrintFormats(settings?.print_formats),
    [settings?.print_formats]
  );
  const [copies, setCopies] = useState(defaultCopies);
  const [showPrice, setShowPrice] = useState(printOpts.barcode_show_price);
  const [showName, setShowName] = useState(printOpts.barcode_show_name);
  const canPortal = typeof document !== "undefined";
  const storeName = resolveStoreName(settings);
  const sizeOpts = LABEL_SIZE_OPTS[printOpts.barcode_label_size];

  useEffect(() => {
    setShowPrice(printOpts.barcode_show_price);
    setShowName(printOpts.barcode_show_name);
  }, [printOpts.barcode_show_price, printOpts.barcode_show_name]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const labels = useMemo(() => {
    const n = Math.max(1, Math.min(50, Number(copies) || 1));
    const list: Product[] = [];
    for (const p of products) {
      for (let i = 0; i < n; i++) list.push(p);
    }
    return list;
  }, [products, copies]);

  if (!canPortal) return null;

  const sheet = (
    <div className="print-paper print-report-sheet w-full text-black" dir="rtl">
      <div className="mb-3 border-b border-slate-300 pb-2 text-center print:hidden">
        <PrintBrandMark sizeClassName="h-8 w-8" />
        <p className="text-sm font-bold">{storeName} — ملصقات باركود</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {labels.map((p, idx) => {
          let svg = "";
          try {
            svg = barcodeToSvg(p.sku, {
              height: sizeOpts.height,
              moduleWidth: sizeOpts.moduleWidth,
            });
          } catch {
            svg = "";
          }
          return (
            <div
              key={`${p.id}-${idx}`}
              className="flex break-inside-avoid flex-col items-center justify-center rounded border border-slate-300 px-1.5 py-1.5 text-center"
              style={{ minHeight: sizeOpts.minHeight }}
            >
              {showName ? (
                <p
                  className={`mb-0.5 line-clamp-2 font-bold leading-tight ${sizeOpts.nameClass}`}
                >
                  {p.name}
                </p>
              ) : null}
              {svg ? (
                <div
                  className="mx-auto max-w-full overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <p className="font-mono text-[10px]">{p.sku}</p>
              )}
              {showPrice ? (
                <p className={`mt-0.5 font-bold ${sizeOpts.priceClass}`}>
                  {formatCurrency(p.sell_price)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  return createPortal(
    <div className="print-portal fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl no-print">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                طباعة ملصقات باركود
              </h3>
              <p className="text-[11px] text-slate-500">
                {products.length} صنف · {labels.length} ملصق
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 bg-white px-5 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              <span className="mb-1 block font-semibold text-slate-600">
                عدد النسخ لكل صنف
              </span>
              <input
                type="number"
                min={1}
                max={50}
                value={copies}
                onChange={(e) => setCopies(Number(e.target.value) || 1)}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={showName}
                onChange={(e) => setShowName(e.target.checked)}
              />
              اسم الصنف
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
              />
              سعر البيع
            </label>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-300 py-3 text-xs font-semibold"
            >
              إغلاق
            </button>
            <button
              type="button"
              onClick={() => printReport()}
              disabled={labels.length === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              طباعة الملصقات
            </button>
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto bg-slate-200 p-4">
          <div className="print-paper mx-auto max-w-[210mm] rounded p-4 shadow-md">
            {sheet}
          </div>
        </div>
      </div>

      <div className="hidden print:block print-report">{sheet}</div>
    </div>,
    document.body
  );
}

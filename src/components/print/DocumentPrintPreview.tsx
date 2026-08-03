"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatDateShort, DOCUMENT_STAGE_LABELS } from "@/lib/utils";
import { printReport, printReceiptElement } from "@/lib/print";
import {
  applyReceiptPrintWidth,
  clearReceiptPrintWidth,
  getReceiptWidthMm,
  isReceiptLayout,
  RECEIPT_FONT_CLASSES,
  resolvePrintFormats,
  type PrintFormatsConfig,
} from "@/lib/print-formats";
import type { Settings } from "@/types";
import { Printer, X, Phone, MapPin } from "lucide-react";
import { resolveStoreName } from "./report-columns";
import { PrintBrandMark } from "./PrintBrandMark";
import {
  formatListMarkdownLabel,
  hasListMarkdown,
} from "@/lib/print-list-price";

export type PrintLineItem = {
  name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  /** Retail unit price before tier markdown */
  list_unit_price?: number | null;
};

export type DocumentPrintKind =
  | "sale"
  | "purchase"
  | "sale_return"
  | "purchase_return"
  | "quote"
  | "purchase_order";

interface DocumentPrintPreviewProps {
  kind: DocumentPrintKind;
  documentNumber: string;
  /** Source sale/purchase invoice number for returns */
  originalDocumentNumber?: string | null;
  items: PrintLineItem[];
  partyName?: string | null;
  partyPhone?: string | null;
  partyLabel?: string;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  paid?: number;
  paymentMethod?: string;
  cashierName?: string;
  notes?: string;
  stage?: string;
  settings: Settings | null;
  onClose: () => void;
  issuedAt?: Date | string | null;
  /** إن وُجد، يحترم إعداد الطباعة التلقائية بعد البيع */
  autoPrint?: boolean;
}

const KIND_LABELS: Record<DocumentPrintKind, string> = {
  sale: "فاتورة بيع",
  purchase: "فاتورة شراء",
  sale_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
  quote: "عرض سعر",
  purchase_order: "طلب شراء",
};

function paymentLabel(method?: string): string {
  if (method === "cash") return "نقدي";
  if (method === "credit") return "آجل";
  if (method === "bank_transfer") return "تحويل بنكي";
  return method || "—";
}

function resolvePrintOffset(settings: Settings | null) {
  if (settings && typeof settings.print_offset === "number") {
    return settings.print_offset;
  }
  if (typeof window === "undefined") return 0;
  const savedOffset = localStorage.getItem("receipt_print_offset_mm");
  return savedOffset ? Number(savedOffset) : 0;
}

export function DocumentPrintPreview({
  kind,
  documentNumber,
  originalDocumentNumber,
  items,
  partyName,
  partyPhone,
  partyLabel,
  subtotal,
  discount,
  taxAmount,
  total,
  paid = 0,
  paymentMethod,
  cashierName,
  notes,
  stage,
  settings,
  onClose,
  issuedAt,
  autoPrint = false,
}: DocumentPrintPreviewProps) {
  const [currentDateTime] = useState(
    () => (issuedAt ? new Date(issuedAt) : new Date())
  );
  const printAreaRef = useRef<HTMLDivElement>(null);
  const printOffset = useMemo(() => resolvePrintOffset(settings), [settings]);
  const printOpts = useMemo(
    () => resolvePrintFormats(settings?.print_formats),
    [settings?.print_formats]
  );
  const canPortal = typeof document !== "undefined";
  const isReceipt = isReceiptLayout(settings?.print_formats, kind);
  const receiptWidthMm = getReceiptWidthMm(printOpts);
  const copies = isReceipt
    ? Math.min(3, Math.max(1, printOpts.print_copies || 1))
    : 1;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (isReceipt) applyReceiptPrintWidth(receiptWidthMm);
    return () => {
      document.body.style.overflow = previousOverflow;
      clearReceiptPrintWidth();
    };
  }, [isReceipt, receiptWidthMm]);

  useEffect(() => {
    if (!autoPrint || kind !== "sale" || !printOpts.auto_print_sale) return;
    const t = window.setTimeout(() => {
      if (isReceipt) {
        const el = printAreaRef.current;
        if (el) printReceiptElement(el, receiptWidthMm);
      } else {
        printReport();
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [autoPrint, kind, isReceipt, printOpts.auto_print_sale, receiptWidthMm]);

  const storeName = resolveStoreName(settings);
  const storePhone = settings?.phone || "";
  const storeAddress = settings?.address || "";
  const logoUrl = settings?.logo_url?.trim() || "";
  const taxNumber = settings?.tax_number?.trim() || "";
  const commercialRegister = settings?.commercial_register?.trim() || "";
  const receiptFooter = settings?.receipt_footer?.trim() || "";
  const kindLabel = KIND_LABELS[kind];
  const resolvedPartyLabel =
    partyLabel ||
    (kind === "purchase" || kind === "purchase_return" || kind === "purchase_order"
      ? "المورد"
      : "العميل");

  const formattedTime = currentDateTime.toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const offsetStyle = isReceipt
    ? {
        paddingLeft: printOffset > 0 ? `${printOffset}mm` : undefined,
        paddingRight: printOffset < 0 ? `${Math.abs(printOffset)}mm` : undefined,
      }
    : undefined;

  if (!canPortal) return null;

  const contentProps = {
    kind,
    kindLabel,
    documentNumber,
    originalDocumentNumber,
    items,
    partyName,
    partyPhone,
    partyLabel: resolvedPartyLabel,
    subtotal,
    discount,
    taxAmount,
    total,
    paid,
    paymentMethod,
    cashierName,
    notes,
    stage,
    storeName,
    storePhone,
    storeAddress,
    logoUrl,
    taxNumber,
    commercialRegister,
    receiptFooter,
    formattedTime,
    currentDateTime,
    isReceipt,
    printOpts,
  };

  const content = <DocumentContent {...contentProps} />;

  function handlePrint() {
    if (isReceipt) {
      const el = printAreaRef.current;
      if (el) printReceiptElement(el, receiptWidthMm);
    } else {
      printReport();
    }
  }

  return createPortal(
    <div className="print-portal fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div
        className={`my-8 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl no-print ${
          isReceipt ? "max-w-[400px]" : "max-w-[720px]"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">معاينة الطباعة</h3>
              <p className="text-[11px] text-slate-500">
                {kindLabel} · {documentNumber}
                {!isReceipt ? (
                  <span className="mr-2 inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-white">
                    ورق A4
                  </span>
                ) : (
                  <span className="mr-2 inline-flex rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white">
                    فاتورة {receiptWidthMm}مم
                  </span>
                )}
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

        <div className="flex gap-3 bg-white px-5 pb-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-300 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            إغلاق
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-xs font-bold text-white hover:bg-blue-800"
          >
            <Printer className="h-4 w-4" />
            طباعة
            {copies > 1 ? ` ×${copies}` : ""}
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto bg-slate-300/80 p-5">
          <div
            className={`print-paper mx-auto shadow-[0_8px_30px_rgba(0,0,0,0.18)] ring-1 ring-slate-400/40 ${
              isReceipt
                ? "max-w-full px-4 py-6"
                : "w-full max-w-[210mm] px-8 py-8"
            }`}
            style={isReceipt ? { width: `${receiptWidthMm}mm` } : undefined}
          >
            {!isReceipt && (
              <div className="mb-4 flex items-center justify-between border-b border-dashed border-slate-300 pb-2 text-[10px] font-bold text-slate-400">
                <span>معاينة ورق A4 — يتقسم على صفحات عند الطباعة</span>
                <span dir="ltr">A4</span>
              </div>
            )}
            <div style={offsetStyle}>{content}</div>
          </div>
        </div>
      </div>

      {isReceipt ? (
        /* Source for iframe receipt print (cloned, not window.print) */
        <div ref={printAreaRef} className="hidden" aria-hidden>
          {Array.from({ length: copies }, (_, i) => (
            <div
              key={i}
              className={copies > 1 ? "print-copy-break" : undefined}
              style={offsetStyle}
            >
              <DocumentContent {...contentProps} />
            </div>
          ))}
        </div>
      ) : (
        <div className="hidden print:block print-report">
          {Array.from({ length: copies }, (_, i) => (
            <div
              key={i}
              className={copies > 1 ? "print-copy-break" : undefined}
              style={offsetStyle}
            >
              <DocumentContent {...contentProps} />
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

function DocumentContent({
  kind,
  kindLabel,
  documentNumber,
  originalDocumentNumber,
  items,
  partyName,
  partyPhone,
  partyLabel,
  subtotal,
  discount,
  taxAmount,
  total,
  paid,
  paymentMethod,
  cashierName,
  notes,
  stage,
  storeName,
  storePhone,
  storeAddress,
  logoUrl,
  taxNumber,
  commercialRegister,
  receiptFooter,
  formattedTime,
  currentDateTime,
  isReceipt,
  printOpts,
}: {
  kind: DocumentPrintKind;
  kindLabel: string;
  documentNumber: string;
  originalDocumentNumber?: string | null;
  items: PrintLineItem[];
  partyName?: string | null;
  partyPhone?: string | null;
  partyLabel: string;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  paid: number;
  paymentMethod?: string;
  cashierName?: string;
  notes?: string;
  stage?: string;
  storeName: string;
  storePhone: string;
  storeAddress: string;
  logoUrl: string;
  taxNumber: string;
  commercialRegister: string;
  receiptFooter: string;
  formattedTime: string;
  currentDateTime: Date;
  isReceipt: boolean;
  printOpts: PrintFormatsConfig;
}) {
  const fonts = isReceipt
    ? RECEIPT_FONT_CLASSES[printOpts.font_size] || RECEIPT_FONT_CLASSES.normal
    : {
        body: "text-xs",
        title: "text-2xl",
        meta: "text-[9px]",
        table: "text-[10px]",
        total: "text-xs",
      };
  const showContact =
    printOpts.show_address && (storeAddress || storePhone);
  const showTax =
    printOpts.show_tax_info && (taxNumber || commercialRegister);

  return (
    <div
      className={`print-paper w-full text-black flex flex-col ${fonts.body} ${
        isReceipt ? "" : "print-report-sheet"
      }`}
      data-watermark={isReceipt ? undefined : storeName}
      dir="rtl"
    >
      <div className="flex flex-col items-center text-center">
        {printOpts.show_logo ? (
          <PrintBrandMark logoUrl={logoUrl || null} />
        ) : null}
        <h1 className={`font-black text-slate-950 mb-1 ${fonts.title}`}>
          {storeName}
        </h1>
        <p className={`${fonts.meta} text-slate-500 font-bold`}>{kindLabel}</p>
      </div>

      {(showContact || showTax) && (
        <div className={`mt-2 text-center ${fonts.meta} text-slate-600 space-y-0.5 border-b border-dashed border-slate-300 pb-2`}>
          {showContact && storeAddress && (
            <div className="flex items-center justify-center gap-1">
              <MapPin className="h-2.5 w-2.5 shrink-0" />
              <span>{storeAddress}</span>
            </div>
          )}
          {showContact && storePhone && (
            <div className="flex items-center justify-center gap-1">
              <Phone className="h-2.5 w-2.5 shrink-0" />
              <span dir="ltr">{storePhone}</span>
            </div>
          )}
          {showTax && taxNumber ? <p>الرقم الضريبي: {taxNumber}</p> : null}
          {showTax && commercialRegister ? (
            <p>السجل التجاري: {commercialRegister}</p>
          ) : null}
        </div>
      )}

      <div className={`my-2 space-y-1 ${fonts.meta} text-slate-700`}>
        <div className="flex justify-between">
          <span className="font-semibold text-slate-500">الرقم:</span>
          <span className="font-extrabold text-slate-900">{documentNumber}</span>
        </div>
        {originalDocumentNumber && (
          <div className="flex justify-between">
            <span className="font-semibold text-slate-500">الفاتورة الأصلية:</span>
            <span className="font-bold text-slate-900">{originalDocumentNumber}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="font-semibold text-slate-500">التاريخ:</span>
          <span className="font-bold">
            {formatDateShort(currentDateTime)} - {formattedTime}
          </span>
        </div>
        {printOpts.show_cashier ? (
          <div className="flex justify-between">
            <span className="font-semibold text-slate-500">الكاشير:</span>
            <span className="font-medium">{cashierName?.trim() || "الكاشير"}</span>
          </div>
        ) : null}
        {stage && (
          <div className="flex justify-between">
            <span className="font-semibold text-slate-500">المرحلة:</span>
            <span className="font-medium">
              {DOCUMENT_STAGE_LABELS[stage] || stage}
            </span>
          </div>
        )}
        {partyName && (
          <div className="mt-1.5 rounded bg-slate-100 p-1.5 space-y-0.5 border border-slate-200">
            <div className="flex justify-between">
              <span className="text-slate-500">{partyLabel}:</span>
              <span className="font-bold text-slate-900">{partyName}</span>
            </div>
            {partyPhone && (
              <div className="flex justify-between">
                <span className="text-slate-500">الهاتف:</span>
                <span dir="ltr">{partyPhone}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`${isReceipt ? "receipt-divider-top pt-1.5" : "border-t border-dashed border-slate-400 pt-2"} ${fonts.table}`}>
        {isReceipt ? (
          <>
            <div className="mb-1 flex justify-between font-extrabold">
              <span>الصنف</span>
              <span>الإجمالي</span>
            </div>
            <div className="space-y-1">
              {items.map((item, index) => (
                <div
                  key={index}
                  className={`receipt-line pb-1 ${
                    index < items.length - 1
                      ? "receipt-item-sep border-b border-slate-300"
                      : ""
                  }`}
                >
                  <p className="font-bold leading-snug">{item.name}</p>
                  {printOpts.show_sku && item.sku ? (
                    <p className="text-[8px] font-normal text-slate-400" dir="ltr">
                      {item.sku}
                    </p>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-2">
                    <span>
                      {item.quantity} × {formatCurrency(item.unit_price)}
                    </span>
                    <span className="shrink-0 font-extrabold">
                      {formatCurrency(item.total)}
                    </span>
                  </div>
                  {hasListMarkdown(item.list_unit_price, item.unit_price) ? (
                    <p className="text-[8px] text-emerald-700">
                      {formatListMarkdownLabel(
                        Number(item.list_unit_price),
                        item.unit_price
                      )}
                    </p>
                  ) : null}
                  {printOpts.show_item_discount && item.discount > 0 ? (
                    <p className="text-[8px] text-red-500">
                      خصم: -{formatCurrency(item.discount)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : (
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="border-b border-dashed border-slate-300 font-extrabold">
                <th className="pb-1.5 text-right">الصنف</th>
                <th className="pb-1.5 text-center">الكمية</th>
                <th className="pb-1.5 text-center">السعر</th>
                <th className="pb-1.5 text-left">الإجمالي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-slate-100">
              {items.map((item, index) => (
                <tr key={index} className="align-top">
                  <td className="break-words py-1 text-right font-bold leading-snug">
                    {item.name}
                    {printOpts.show_sku && item.sku ? (
                      <span
                        className="mt-0.5 block text-[8px] font-normal text-slate-400"
                        dir="ltr"
                      >
                        {item.sku}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 text-center font-bold">{item.quantity}</td>
                  <td className="py-1 text-center">
                    {formatCurrency(item.unit_price)}
                    {hasListMarkdown(item.list_unit_price, item.unit_price) ? (
                      <span className="mt-0.5 block text-[8px] font-normal text-emerald-700">
                        {formatListMarkdownLabel(
                          Number(item.list_unit_price),
                          item.unit_price
                        )}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 text-left font-extrabold">
                    {formatCurrency(item.total)}
                    {printOpts.show_item_discount && item.discount > 0 ? (
                      <span className="block text-[8px] font-normal text-red-500">
                        (خصم: -{formatCurrency(item.discount)})
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={`receipt-divider-top mt-2 border-t border-dashed border-slate-400 pt-2 space-y-1 ${fonts.table}`}>
        <div className="flex justify-between text-slate-600">
          <span>المجموع الفرعي</span>
          <span className="font-semibold">{formatCurrency(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>الخصم</span>
            <span className="font-semibold">- {formatCurrency(discount)}</span>
          </div>
        )}
        {taxAmount > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>الضريبة</span>
            <span className="font-semibold">{formatCurrency(taxAmount)}</span>
          </div>
        )}
        <div className={`receipt-total-line flex justify-between items-center border-t border-double border-slate-400 py-1.5 ${fonts.total} font-extrabold`}>
          <span>الإجمالي</span>
          <span className="text-sm font-black">{formatCurrency(total)}</span>
        </div>

        {paymentMethod &&
          (kind === "sale" ||
            kind === "purchase" ||
            kind === "sale_return" ||
            kind === "purchase_return") && (
            <div className={`receipt-divider-top mt-1 space-y-0.5 ${fonts.meta} border-t border-dashed border-slate-200 pt-1.5`}>
              <div className="flex justify-between">
                <span>طريقة الدفع:</span>
                <span className="font-bold">{paymentLabel(paymentMethod)}</span>
              </div>
              <div className="flex justify-between">
                <span>المدفوع:</span>
                <span className="font-bold">{formatCurrency(paid)}</span>
              </div>
              {total - paid > 0 && (
                <div className="flex justify-between text-red-600 font-extrabold">
                  <span>المتبقي:</span>
                  <span>{formatCurrency(total - paid)}</span>
                </div>
              )}
            </div>
          )}

        {notes && (
          <div className={`receipt-divider-top mt-2 border-t border-dashed border-slate-200 pt-1.5 ${fonts.meta}`}>
            <span className="font-semibold text-slate-500">ملاحظات: </span>
            <span>{notes}</span>
          </div>
        )}
      </div>

      {!isReceipt && printOpts.a4_show_signature ? (
        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-[10px] text-slate-600">
          <div>
            <div className="mb-10 border-b border-dashed border-slate-400" />
            <p className="font-bold">توقيع المستلم</p>
          </div>
          <div>
            <div className="mb-10 border-b border-dashed border-slate-400" />
            <p className="font-bold">ختم / توقيع المحل</p>
          </div>
        </div>
      ) : null}

      <div className="receipt-divider-top mt-3 border-t border-dashed border-slate-400 pt-2.5 text-center">
        {receiptFooter ? (
          <p className="mb-1 text-[8.5px] font-bold leading-tight text-slate-800">
            {receiptFooter}
          </p>
        ) : null}
        <p className="text-[10px] font-black text-slate-900">شكراً لتعاملكم معنا</p>
      </div>
    </div>
  );
}

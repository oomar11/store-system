"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import type { Customer, Settings } from "@/types";
import { Printer, X, Phone, MapPin, CheckCircle2 } from "lucide-react";
import { printReceiptElement } from "@/lib/print";
import {
  applyReceiptPrintWidth,
  clearReceiptPrintWidth,
  getReceiptWidthMm,
  RECEIPT_FONT_CLASSES,
  resolvePrintFormats,
  type PrintFormatsConfig,
} from "@/lib/print-formats";
import {
  formatListMarkdownLabel,
  hasListMarkdown,
} from "@/lib/print-list-price";

interface CartItem {
  product: { name: string; sku: string };
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  /** Retail before tier markdown */
  list_unit_price?: number | null;
}

interface InvoicePreviewProps {
  invoiceNumber: string;
  cart: CartItem[];
  customer: Customer | null;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  paid: number;
  paymentMethod: "cash" | "credit";
  cashierName: string;
  settings: Settings | null;
  onClose: () => void;
  /** success = after save; view = open existing invoice for print */
  variant?: "success" | "view";
  issuedAt?: Date | string | null;
  /** invoice (default) or quote */
  kind?: "invoice" | "quote";
}

function resolvePrintOffset(settings: Settings | null) {
  if (settings && typeof settings.print_offset === "number") {
    return settings.print_offset;
  }

  if (typeof window === "undefined") return 0;

  const savedOffset = localStorage.getItem("receipt_print_offset_mm");
  return savedOffset ? Number(savedOffset) : 0;
}

export function InvoicePreview({
  invoiceNumber,
  cart,
  customer,
  subtotal,
  discount,
  taxAmount,
  total,
  paid,
  paymentMethod,
  cashierName,
  settings,
  onClose,
  variant = "success",
  issuedAt,
  kind = "invoice",
}: InvoicePreviewProps) {
  const [currentDateTime] = useState(
    () => (issuedAt ? new Date(issuedAt) : new Date())
  );
  const printAreaRef = useRef<HTMLDivElement>(null);
  const printOffset = useMemo(() => resolvePrintOffset(settings), [settings]);
  const printOpts = useMemo(
    () => resolvePrintFormats(settings?.print_formats),
    [settings?.print_formats]
  );
  const receiptWidthMm = getReceiptWidthMm(printOpts);
  const canPortal = typeof document !== "undefined";
  const isView = variant === "view";
  const isQuote = kind === "quote";
  const docLabel = isQuote ? "عرض السعر" : "الفاتورة";
  const docLabelShort = isQuote ? "عرض سعر" : "فاتورة";
  const copies = Math.min(3, Math.max(1, printOpts.print_copies || 1));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    applyReceiptPrintWidth(receiptWidthMm);
    return () => {
      document.body.style.overflow = previousOverflow;
      clearReceiptPrintWidth();
    };
  }, [receiptWidthMm]);

  function handlePrint() {
    const el = printAreaRef.current;
    if (!el) return;
    printReceiptElement(el, receiptWidthMm);
  }

  useEffect(() => {
    if (variant !== "success" || isQuote || !printOpts.auto_print_sale) return;
    const t = window.setTimeout(() => {
      const el = printAreaRef.current;
      if (el) printReceiptElement(el, receiptWidthMm);
    }, 450);
    return () => window.clearTimeout(t);
  }, [variant, isQuote, printOpts.auto_print_sale, receiptWidthMm]);

  let storeName = settings?.store_name?.trim() || "ويندور";
  if (storeName === "محل الخامات") {
    storeName = "ويندور";
  }

  const storePhone = settings?.phone?.trim() || "";
  const storeAddress = settings?.address?.trim() || "";
  const invoiceTagline = settings?.invoice_tagline?.trim() || "";
  const logoUrl = settings?.logo_url?.trim() || "";
  const taxNumber = settings?.tax_number?.trim() || "";
  const commercialRegister = settings?.commercial_register?.trim() || "";
  const receiptFooter = settings?.receipt_footer?.trim() || "";
  const currencySymbol = settings?.currency || "ج.م";

  const formattedTime = currentDateTime.toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const offsetStyle = {
    paddingLeft: printOffset > 0 ? `${printOffset}mm` : undefined,
    paddingRight: printOffset < 0 ? `${Math.abs(printOffset)}mm` : undefined,
    transition: "padding 0.15s ease",
  };

  const contentProps: InvoiceContentProps = {
    invoiceNumber,
    cart,
    customer,
    subtotal,
    discount,
    taxAmount,
    total,
    paid,
    paymentMethod,
    cashierName,
    storeName,
    storePhone,
    storeAddress,
    invoiceTagline,
    logoUrl,
    taxNumber,
    commercialRegister,
    receiptFooter,
    currencySymbol,
    formattedTime,
    currentDateTime,
    kind,
    printOpts,
    // From sales history the DB balance already includes this invoice's remaining.
    // After POS save, selectedCustomer still holds the pre-posting balance.
    balanceIncludesInvoice: isView,
  };

  if (!canPortal) return null;

  return createPortal(
    <div className="print-portal fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-[400px] overflow-hidden rounded-2xl bg-slate-100 shadow-2xl transition-all border border-slate-200 no-print my-8">
        
        {/* Header Action panel */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                isView ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
              }`}
            >
              {isView ? <Printer className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">
                {isView ? `معاينة ${docLabel}` : `تم حفظ ${docLabel}`}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isView ? invoiceNumber : "جاهز للطباعة الآن"}
                <span className="mr-2 inline-flex rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white">
                  {receiptWidthMm}مم
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action buttons bar */}
        <div className="flex gap-3 bg-white px-5 pb-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-300 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            {isView ? "إغلاق" : isQuote ? "عرض سعر جديد" : "فاتورة جديدة"}
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-xs font-bold text-white hover:bg-blue-800 shadow-lg shadow-blue-700/20 transition"
          >
            <Printer className="h-4 w-4" />
            طباعة {docLabelShort}
            {copies > 1 ? ` ×${copies}` : ""}
          </button>
        </div>



        {/* Paper receipt viewport — scroll on the gray area; do NOT use flex here.
            A flex scrollport stretches/clips the white sheet to the visible max-h,
            so content scrolled outside the paper. mx-auto centers; sheet height = content. */}
        <div className="max-h-[45vh] overflow-y-auto p-4 bg-slate-200">
          <div
            className="print-paper mx-auto max-w-full px-4 py-6 shadow-md border-b-4 border-slate-300/50 text-black leading-tight select-none"
            style={{ width: `${receiptWidthMm}mm` }}
          >
            {/* The printable invoice content wrapped in offset aligner */}
            <div style={offsetStyle}>
              <InvoiceContent {...contentProps} />
            </div>
          </div>
        </div>
      </div>

      {/* Source for iframe receipt print (cloned, not window.print) */}
      <div ref={printAreaRef} className="hidden" aria-hidden>
        {Array.from({ length: copies }, (_, i) => (
          <div
            key={i}
            className={copies > 1 ? "print-copy-break" : undefined}
            style={offsetStyle}
          >
            <InvoiceContent {...contentProps} />
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

// Extracted invoice content component to reuse for both screen preview and print
interface InvoiceContentProps {
  invoiceNumber: string;
  cart: CartItem[];
  customer: Customer | null;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  paid: number;
  paymentMethod: "cash" | "credit";
  cashierName: string;
  storeName: string;
  storePhone: string;
  storeAddress: string;
  invoiceTagline: string;
  logoUrl: string;
  taxNumber: string;
  commercialRegister: string;
  receiptFooter: string;
  currencySymbol: string;
  formattedTime: string;
  currentDateTime: Date | null;
  kind?: "invoice" | "quote";
  printOpts: PrintFormatsConfig;
  /** When true, customer.balance already includes this invoice's remaining (reprint). */
  balanceIncludesInvoice?: boolean;
}

function InvoiceContent({
  invoiceNumber,
  cart,
  customer,
  subtotal,
  discount,
  taxAmount,
  total,
  paid,
  paymentMethod,
  cashierName,
  storeName,
  storePhone,
  storeAddress,
  invoiceTagline,
  logoUrl,
  taxNumber,
  commercialRegister,
  receiptFooter,
  currencySymbol,
  formattedTime,
  currentDateTime,
  kind = "invoice",
  printOpts,
  balanceIncludesInvoice = false,
}: InvoiceContentProps) {
  const isQuote = kind === "quote";
  const headerLine = isQuote ? "عرض سعر" : invoiceTagline;
  const defaultFooter = isQuote
    ? "هذا عرض سعر وليس فاتورة — الأسعار صالحة حسب مدة العرض المتفق عليها."
    : "البضاعة المباعة لا ترد ولا تستبدل إلا خلال 14 يوماً مع وجود الفاتورة الأصلية.";
  const fonts = RECEIPT_FONT_CLASSES[printOpts.font_size] || RECEIPT_FONT_CLASSES.normal;
  const showContact =
    printOpts.show_address && (storeAddress || storePhone);
  const showTax =
    printOpts.show_tax_info && (taxNumber || commercialRegister);
  const invoiceRemaining = Math.max(0, total - paid);
  const customerBalance = Number(customer?.balance) || 0;
  // Reprint from history: balance already posted. Fresh POS save: balance is pre-posting.
  const previousCustomerBalance = balanceIncludesInvoice
    ? customerBalance - invoiceRemaining
    : customerBalance;
  const newCustomerBalance = balanceIncludesInvoice
    ? customerBalance
    : customerBalance + invoiceRemaining;

  return (
    <div className={`print-paper w-full text-black flex flex-col ${fonts.body}`} dir="rtl">
      {/* 1. Header */}
      <div className="flex flex-col items-center text-center">
        {printOpts.show_logo && logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="mx-auto mb-1 max-h-12 max-w-[120px] object-contain"
          />
        ) : null}
        <h1 className={`${fonts.title} font-black text-slate-950 mb-1 tracking-wide`}>
          {storeName}
        </h1>
        {headerLine ? (
          <p className={`${fonts.meta} text-slate-500 font-bold`}>{headerLine}</p>
        ) : null}
      </div>

      {/* 2. Store Contact Details */}
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

      {/* 3. Invoice Metadata */}
      <div className={`my-2 ${fonts.meta} text-slate-700 space-y-1`}>
        <div className="flex justify-between">
          <span className="font-semibold text-slate-500">
            {isQuote ? "رقم العرض:" : "رقم الفاتورة:"}
          </span>
          <span className="font-extrabold text-slate-900">{invoiceNumber}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-semibold text-slate-500">التاريخ والوقت:</span>
          <span className="font-bold text-slate-800">
            {currentDateTime ? formatDateShort(currentDateTime) : ""} - {formattedTime}
          </span>
        </div>
        {printOpts.show_cashier ? (
          <div className="flex justify-between">
            <span className="font-semibold text-slate-500">الكاشير:</span>
            <span className="font-medium text-slate-800">{cashierName}</span>
          </div>
        ) : null}
        {customer && (
          <div className="mt-1.5 rounded bg-slate-100 p-1.5 space-y-0.5 border border-slate-200">
            <div className="flex justify-between">
              <span className="text-slate-500">العميل:</span>
              <span className="font-bold text-slate-900">{customer.name}</span>
            </div>
            {customer.phone && (
              <div className="flex justify-between">
                <span className="text-slate-500">الهاتف:</span>
                <span className="font-medium text-slate-700" dir="ltr">{customer.phone}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Cart items — stacked POS layout (full width names on 80mm) */}
      <div className={`receipt-divider-top pt-1.5 ${fonts.table}`}>
        <div className="mb-1 flex justify-between font-extrabold text-slate-900">
          <span>الصنف</span>
          <span>الإجمالي</span>
        </div>
        <div className="space-y-1">
          {cart.map((item, index) => (
            <div
              key={index}
              className={`receipt-line pb-1 ${
                index < cart.length - 1 ? "receipt-item-sep border-b border-slate-300" : ""
              }`}
            >
              <p className="font-bold text-slate-950 leading-snug">{item.product.name}</p>
              {printOpts.show_sku && item.product.sku ? (
                <p className="text-[8px] font-normal text-slate-400" dir="ltr">
                  {item.product.sku}
                </p>
              ) : null}
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-slate-700">
                  {item.quantity} × {formatCurrency(item.unit_price)}
                </span>
                <span className="shrink-0 font-extrabold text-slate-950">
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
      </div>

      {/* 5. Totals Breakdown */}
      <div className={`receipt-divider-top mt-2 pt-2 space-y-1 ${fonts.table}`}>
        <div className="flex justify-between text-slate-600">
          <span>المجموع الفرعي (قبل الخصم)</span>
          <span className="font-semibold">{formatCurrency(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>إجمالي الخصم</span>
            <span className="font-semibold">- {formatCurrency(discount)}</span>
          </div>
        )}
        {taxAmount > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>ضريبة القيمة المضافة</span>
            <span className="font-semibold">{formatCurrency(taxAmount)}</span>
          </div>
        )}
        
        {/* Grand Total */}
        <div className={`receipt-total-line flex justify-between items-center py-1.5 ${fonts.total} font-extrabold text-slate-900`}>
          <span>الإجمالي النهائي (شامل الضريبة)</span>
          <span className="text-sm font-black">
            {formatCurrency(total)}
          </span>
        </div>

        {/* Payment info */}
        {!isQuote && (
        <div className={`receipt-divider-top mt-1 space-y-0.5 ${fonts.meta} pt-1.5`}>
          <div className="flex justify-between text-slate-600">
            <span>طريقة الدفع:</span>
            <span className="font-bold text-slate-800">
              {paymentMethod === "cash" ? "نقدي" : "آجل (على الحساب)"}
            </span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>المبلغ المدفوع:</span>
            <span className="font-bold text-green-700">{formatCurrency(paid)}</span>
          </div>

          {/* Change or Remaining balance */}
          {paymentMethod === "credit" && total - paid > 0 && (
            <div className="flex justify-between text-red-600 font-extrabold">
              <span>المتبقي (آجل):</span>
              <span>{formatCurrency(total - paid)}</span>
            </div>
          )}
          {paymentMethod === "cash" && paid - total > 0 && (
            <div className="flex justify-between text-green-700 font-extrabold">
              <span>الباقي للعميل:</span>
              <span>{formatCurrency(paid - total)}</span>
            </div>
          )}
        </div>
        )}

        {/* الحساب الإجمالي للعميل في العمليات الآجلة */}
        {!isQuote &&
          customer &&
          invoiceRemaining > 0.001 &&
          (paymentMethod === "credit" || total - paid > 0) && (
          <div className={`receipt-divider-top mt-2 pt-1.5 space-y-1 ${fonts.meta}`}>
            <div className="flex justify-between text-slate-600">
              <span>الحساب السابق للعميل:</span>
              <span className="font-semibold">{formatCurrency(previousCustomerBalance)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>حساب هذه الفاتورة (آجل):</span>
              <span className="font-semibold text-red-600">+{formatCurrency(invoiceRemaining)}</span>
            </div>
            <div className="flex justify-between font-bold text-slate-900 text-[10px]">
              <span>إجمالي الحساب الجديد للعميل:</span>
              <span>{formatCurrency(newCustomerBalance)}</span>
            </div>
          </div>
        )}
      </div>

      {/* 6. Footer Policy and Thank You */}
      <div className="receipt-divider-top mt-3 pt-2 text-center space-y-1">
        <p className="text-[8.5px] font-bold text-slate-800 leading-tight">
          {receiptFooter || defaultFooter}
        </p>
        <div className="pt-1.5">
          <p className="text-[10px] font-black text-slate-900 leading-none">شكراً لزيارتكم! ونأمل رؤيتكم قريباً</p>
        </div>
      </div>
    </div>
  );
}

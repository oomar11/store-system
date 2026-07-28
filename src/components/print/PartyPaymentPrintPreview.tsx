"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { printReceiptElement } from "@/lib/print";
import type { Settings } from "@/types";
import type { PartyPaymentRow } from "@/lib/party-payments";
import { partyPaymentDocNumber } from "@/lib/party-payments";
import { resolveStoreName } from "./report-columns";
import { PrintBrandMark } from "./PrintBrandMark";

type PartyPaymentPrintPreviewProps = {
  payment: PartyPaymentRow;
  partyName: string;
  partyPhone?: string | null;
  settings: Settings | null;
  onClose: () => void;
};

export function PartyPaymentPrintPreview({
  payment,
  partyName,
  partyPhone,
  settings,
  onClose,
}: PartyPaymentPrintPreviewProps) {
  const [mounted] = useState(() => typeof document !== "undefined");
  const printAreaRef = useRef<HTMLDivElement>(null);
  const printedAt = useMemo(() => new Date(), []);
  const isCollection = payment.party_type === "customer";
  const title = isCollection ? "إيصال تحصيل" : "إيصال سداد";
  const partyLabel = isCollection ? "العميل" : "المورد";
  const docNumber = partyPaymentDocNumber(payment.id, payment.party_type);
  const storeName = resolveStoreName(settings);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;

  const body = (
    <div className="print-paper w-full text-black" dir="rtl">
      <div className="mb-3 border-b border-dashed border-slate-400 pb-2 text-center">
        <PrintBrandMark sizeClassName="h-8 w-8" />
        <h1 className="text-base font-black">{storeName}</h1>
        {(settings?.address || settings?.phone) && (
          <p className="mt-0.5 text-[10px] text-slate-600">
            {[settings?.address, settings?.phone].filter(Boolean).join(" · ")}
          </p>
        )}
        <h2 className="mt-2 text-sm font-bold">{title}</h2>
        <p className="mt-0.5 font-mono text-[11px]">{docNumber}</p>
      </div>

      <div className="mb-3 space-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">{partyLabel}:</span>
          <span className="font-bold">{partyName}</span>
        </div>
        {partyPhone ? (
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">الهاتف:</span>
            <span dir="ltr">{partyPhone}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">التاريخ:</span>
          <span>{formatDateShort(payment.created_at)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-slate-500">الخزنة:</span>
          <span>{payment.safe_name || "—"}</span>
        </div>
      </div>

      <div className="mb-3 rounded border border-slate-300 px-3 py-2 text-center">
        <p className="text-[10px] text-slate-500">المبلغ</p>
        <p className="text-lg font-black">{formatCurrency(payment.amount)}</p>
      </div>

      {(payment.allocations || []).length > 0 ? (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-bold">توزيع على الفواتير:</p>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-1 text-right font-bold">الفاتورة</th>
                <th className="py-1 text-right font-bold">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {(payment.allocations || []).map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-1 font-mono">
                    {a.invoice_number || a.invoice_id.slice(0, 8)}
                  </td>
                  <td className="py-1 font-semibold">
                    {formatCurrency(a.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {payment.notes ? (
        <p className="mb-2 text-[10px] text-slate-600">
          ملاحظة: {payment.notes}
        </p>
      ) : null}

      <p className="mt-4 text-center text-[9px] text-slate-400">
        طُبع: {formatDateShort(printedAt)}
      </p>
    </div>
  );

  return createPortal(
    <div className="print-portal fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-[400px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl no-print">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">معاينة الطباعة</h3>
              <p className="text-[11px] text-slate-500">
                {title} · {docNumber}
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

        <div className="flex gap-3 bg-white px-5 pb-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-300 py-3 text-xs font-semibold"
          >
            إغلاق
          </button>
          <button
            type="button"
            onClick={() => {
              const el = printAreaRef.current;
              if (el) printReceiptElement(el, 80);
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-xs font-bold text-white hover:bg-blue-800"
          >
            <Printer className="h-4 w-4" />
            طباعة
          </button>
        </div>

        <div className="max-h-[45vh] overflow-y-auto bg-slate-200 p-4">
          <div className="print-paper mx-auto w-[80mm] max-w-full px-4 py-6 shadow-md">
            {body}
          </div>
        </div>
      </div>

      <div ref={printAreaRef} className="hidden" aria-hidden>
        <div className="print-paper mx-auto w-[80mm] p-2">{body}</div>
      </div>
    </div>,
    document.body
  );
}

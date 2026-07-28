"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { invoiceOperationHref, invoiceTypeLabel } from "@/lib/history";
import { Modal } from "@/components/ui/Modal";
import {
  DocumentPrintPreview,
  type DocumentPrintKind,
  type PrintLineItem,
} from "@/components/print/DocumentPrintPreview";
import type { Safe, Settings } from "@/types";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  applySafeMovement,
  invoicePaymentMovementType,
  pickDefaultSafeId,
  type InvoiceSafeDirection,
} from "@/lib/safe-transactions";
import { safesOrderQuery } from "@/lib/safes-order";
import {
  adjustCustomerBalance,
  adjustSupplierBalance,
} from "@/lib/party-balance";
import { useAuth } from "@/hooks/useAuth";
import { Pencil, Printer, Wallet } from "lucide-react";

export type InvoiceOpSelection = {
  invoiceId: string;
  invoiceNumber: string;
  type: string;
  party: string;
  createdAt: string;
};

type PrintState = {
  kind: DocumentPrintKind;
  documentNumber: string;
  items: PrintLineItem[];
  partyName?: string;
  partyPhone?: string;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  paid: number;
  paymentMethod?: string;
  notes?: string;
  issuedAt: string;
};

type InvoiceDetails = {
  total: number;
  paid_amount: number;
  customer_id?: string | null;
  supplier_id?: string | null;
  payment_method?: string;
};

interface InvoiceOperationModalProps {
  selected: InvoiceOpSelection | null;
  settings: Settings | null;
  onClose: () => void;
  /** Called after a successful payment so the parent can refresh lists. */
  onInvoiceUpdated?: () => void;
  /** Notifies parent when payment submit is in progress. */
  onPaymentBusyChange?: (busy: boolean) => void;
  /** رسالة عند اختيار رصيد افتتاحي (يُستدعى من الصفحة قبل فتح المودال عادة) */
  openingHint?: string;
}

export function InvoiceOperationModal({
  selected,
  settings,
  onClose,
  onInvoiceUpdated,
  onPaymentBusyChange,
}: InvoiceOperationModalProps) {
  const router = useRouter();
  const supabase = createClient();
  const { profile } = useAuth();
  const {
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
  } = useToast();
  const { confirm } = useConfirm();
  const [actionLoading, setActionLoading] = useState(false);
  const [printState, setPrintState] = useState<PrintState | null>(null);
  const [invoiceDetails, setInvoiceDetails] = useState<InvoiceDetails | null>(
    null
  );
  const [safes, setSafes] = useState<Safe[]>([]);
  const [payAmount, setPayAmount] = useState("");
  const [selectedSafeId, setSelectedSafeId] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);

  const canCollectPayment =
    selected &&
    (selected.type === "sale" || selected.type === "purchase") &&
    invoiceDetails &&
    Number(invoiceDetails.total) - Number(invoiceDetails.paid_amount) > 0.001;

  const remaining = invoiceDetails
    ? Math.max(
        0,
        Number(invoiceDetails.total) - Number(invoiceDetails.paid_amount)
      )
    : 0;

  useEffect(() => {
    if (!selected) {
      setInvoiceDetails(null);
      setPayAmount("");
      setSelectedSafeId("");
      return;
    }

    let cancelled = false;

    async function load() {
      const [invRes, safesRes] = await Promise.all([
        supabase
          .from("invoices")
          .select("total, paid_amount, customer_id, supplier_id, payment_method")
          .eq("id", selected!.invoiceId)
          .maybeSingle(),
        safesOrderQuery(
          supabase.from("safes").select("*").eq("is_active", true)
        ),
      ]);

      if (cancelled) return;

      if (invRes.data) {
        setInvoiceDetails(invRes.data as InvoiceDetails);
        const rem = Math.max(
          0,
          Number(invRes.data.total) - Number(invRes.data.paid_amount)
        );
        setPayAmount(rem > 0 ? String(rem) : "");
      } else {
        setInvoiceDetails(null);
        setPayAmount("");
      }

      const safeList = (safesRes.data || []) as Safe[];
      setSafes(safeList);
      setSelectedSafeId(
        pickDefaultSafeId(safeList, invRes.data?.payment_method)
      );
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.invoiceId]);

  async function confirmEdit() {
    if (!selected) return;
    const canEdit = selected.type === "sale" || selected.type === "purchase";
    if (!canEdit) {
      toastInfo("المرتجعات تُعرض من صفحة المرتجعات — سيتم نقلك هناك.");
      router.push(invoiceOperationHref(selected.type, selected.invoiceId));
      onClose();
      return;
    }

    if (
      !(await confirm({
        message: `هل تريد تعديل الفاتورة ${selected.invoiceNumber}؟\n\nسيتم فتحها في نقطة البيع للتعديل.`,
      }))
    )
      return;

    router.push(invoiceOperationHref(selected.type, selected.invoiceId));
    onClose();
  }

  async function printSelected() {
    if (!selected) return;
    setActionLoading(true);
    try {
      const { data: invoice, error } = await supabase
        .from("invoices")
        .select(
          "*, customer:customers(name, phone), supplier:suppliers(name, phone)"
        )
        .eq("id", selected.invoiceId)
        .single();

      if (error || !invoice) {
        toastError("تعذر تحميل الفاتورة للطباعة");
        return;
      }

      const { data: lines } = await supabase
        .from("invoice_items")
        .select("*, product:products(name, sku)")
        .eq("invoice_id", selected.invoiceId);

      const kind = (invoice.type as DocumentPrintKind) || "sale";
      setPrintState({
        kind,
        documentNumber: invoice.invoice_number,
        items:
          lines?.map((line) => ({
            name: line.product?.name || "صنف",
            sku: line.product?.sku || "",
            quantity: Number(line.quantity),
            unit_price: Number(line.unit_price),
            discount: Number(line.discount) || 0,
            total: Number(line.total),
          })) || [],
        partyName: invoice.customer?.name || invoice.supplier?.name,
        partyPhone: invoice.customer?.phone || invoice.supplier?.phone,
        subtotal:
          Number(invoice.subtotal) ||
          (lines || []).reduce((s, l) => s + Number(l.total), 0),
        discount: Number(invoice.discount_amount) || 0,
        taxAmount: Number(invoice.tax_amount) || 0,
        total: Number(invoice.total),
        paid: Number(invoice.paid_amount) || 0,
        paymentMethod: invoice.payment_method,
        notes: invoice.notes || undefined,
        issuedAt: invoice.created_at,
      });
      onClose();
    } finally {
      setActionLoading(false);
    }
  }

  async function collectPayment() {
    if (!selected || !invoiceDetails || !canCollectPayment) return;

    const amount = Number(payAmount) || 0;
    if (amount <= 0) {
      toastError("أدخل مبلغاً أكبر من صفر.");
      return;
    }
    if (amount > remaining + 0.001) {
      toastError(`المبلغ أكبر من المتبقي (${formatCurrency(remaining)}).`);
      return;
    }
    if (!selectedSafeId) {
      toastError("الرجاء تحديد الخزنة.");
      return;
    }

    setPaymentLoading(true);
    onPaymentBusyChange?.(true);
    try {
      // Re-read paid_amount to avoid stale UI race with party payments / concurrent collect
      const { data: fresh, error: freshErr } = await supabase
        .from("invoices")
        .select("id, paid_amount, total, customer_id, supplier_id")
        .eq("id", selected.invoiceId)
        .single();
      if (freshErr || !fresh) throw new Error(freshErr?.message || "الفاتورة غير موجودة");

      const oldPaid = Number(fresh.paid_amount) || 0;
      const total = Number(fresh.total) || 0;
      const currentRemaining = Math.max(0, total - oldPaid);
      if (amount > currentRemaining + 0.001) {
        throw new Error(`المبلغ أكبر من المتبقي (${formatCurrency(currentRemaining)}).`);
      }

      const newPaid = oldPaid + amount;
      const invoiceType = selected.type as InvoiceSafeDirection;
      const movementType = invoicePaymentMovementType(invoiceType);

      await applySafeMovement(supabase, {
        safeId: selectedSafeId,
        type: movementType,
        amount,
        description:
          selected.type === "sale"
            ? `تحصيل بيع رقم ${selected.invoiceNumber}`
            : `سداد شراء رقم ${selected.invoiceNumber}`,
        referenceType: "invoice",
        referenceId: selected.invoiceId,
      });

      if (selected.type === "sale" && fresh.customer_id) {
        await adjustCustomerBalance(supabase, fresh.customer_id, -amount);
      } else if (selected.type === "purchase" && fresh.supplier_id) {
        await adjustSupplierBalance(supabase, fresh.supplier_id, -amount);
      }

      const { data: updated, error: updateError } = await supabase
        .from("invoices")
        .update({ paid_amount: newPaid })
        .eq("id", selected.invoiceId)
        .lte("paid_amount", total - amount + 0.001)
        .select("paid_amount, total, customer_id, supplier_id")
        .maybeSingle();

      if (updateError) throw new Error(updateError.message);
      if (!updated) {
        // Compensating reverse if concurrent payment won the race
        await applySafeMovement(supabase, {
          safeId: selectedSafeId,
          type: movementType === "deposit" ? "withdrawal" : "deposit",
          amount,
          description: `عكس تحصيل متزامن - ${selected.invoiceNumber}`,
          referenceType: "invoice",
          referenceId: selected.invoiceId,
        });
        if (selected.type === "sale" && fresh.customer_id) {
          await adjustCustomerBalance(supabase, fresh.customer_id, amount);
        } else if (selected.type === "purchase" && fresh.supplier_id) {
          await adjustSupplierBalance(supabase, fresh.supplier_id, amount);
        }
        throw new Error("تم تسجيل دفعة أخرى على الفاتورة في نفس الوقت. أعد المحاولة.");
      }

      toastSuccess(
        selected.type === "sale"
          ? `تم تحصيل ${formatCurrency(amount)} بنجاح`
          : `تم سداد ${formatCurrency(amount)} بنجاح`
      );

      setInvoiceDetails({ ...invoiceDetails, paid_amount: Number(updated.paid_amount) });
      const newRemaining = Math.max(0, total - Number(updated.paid_amount));
      setPayAmount(newRemaining > 0 ? String(newRemaining) : "");
      onInvoiceUpdated?.();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر تسجيل الدفع");
    } finally {
      setPaymentLoading(false);
      onPaymentBusyChange?.(false);
    }
  }

  return (
    <>
      <Modal
        open={!!selected}
        onClose={onClose}
        title={selected ? `المستند ${selected.invoiceNumber}` : "المستند"}
      >
        {selected && (
          <div className="space-y-4" dir="rtl">
            <div className="space-y-2 rounded-xl border border-[#e1e6ee] bg-[#f8fafc] p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-[#687386]">النوع</span>
                <span className="font-bold">{invoiceTypeLabel(selected.type)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#687386]">التاريخ</span>
                <span className="font-semibold">
                  {formatDateShort(selected.createdAt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#687386]">الطرف</span>
                <span className="font-semibold">{selected.party}</span>
              </div>
              {invoiceDetails && (
                <>
                  <div className="flex justify-between border-t border-[#e1e6ee] pt-2">
                    <span className="text-[#687386]">الإجمالي</span>
                    <span className="font-bold">
                      {formatCurrency(Number(invoiceDetails.total))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#687386]">المدفوع</span>
                    <span className="font-semibold text-emerald-700">
                      {formatCurrency(Number(invoiceDetails.paid_amount))}
                    </span>
                  </div>
                  {remaining > 0.001 && (
                    <div className="flex justify-between">
                      <span className="text-[#687386]">المتبقي</span>
                      <span className="font-bold text-orange-700">
                        {formatCurrency(remaining)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {canCollectPayment && (
              <div className="space-y-3 rounded-xl border border-[#cfe2fa] bg-[#eef6ff] p-4">
                <p className="text-sm font-bold text-[#1473e6]">
                  {selected.type === "sale" ? "تحصيل من العميل" : "سداد للمورد"}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={remaining}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="المبلغ"
                    className="flex-1 rounded-lg border border-[#cfe2fa] bg-white px-3 py-2 text-sm focus:border-[#9ac7fa] focus:outline-none"
                    dir="ltr"
                  />
                  <select
                    value={selectedSafeId}
                    onChange={(e) => setSelectedSafeId(e.target.value)}
                    className="rounded-lg border border-[#cfe2fa] bg-white px-3 py-2 text-sm focus:border-[#9ac7fa] focus:outline-none"
                  >
                    <option value="">اختر الخزنة</option>
                    {safes.map((safe) => (
                      <option key={safe.id} value={safe.id}>
                        {safe.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={paymentLoading || actionLoading}
                  onClick={() => void collectPayment()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1473e6] py-2.5 text-sm font-bold text-white hover:bg-[#0b65d1] disabled:opacity-50"
                >
                  <Wallet className="h-4 w-4" />
                  {paymentLoading ? "جاري التسجيل..." : "تسجيل الدفع"}
                </button>
              </div>
            )}

            <p className="text-sm text-[#526176]">
              اختر الإجراء المطلوب لهذه الفاتورة:
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={actionLoading || paymentLoading}
                onClick={() => void printSelected()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                {actionLoading ? "جاري التحميل..." : "طباعة الفاتورة"}
              </button>
              <button
                type="button"
                disabled={actionLoading || paymentLoading}
                onClick={confirmEdit}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1473e6] py-3 text-sm font-bold text-white hover:bg-[#0b65d1] disabled:opacity-50"
              >
                <Pencil className="h-4 w-4" />
                تعديل الفاتورة
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-[#e1e6ee] py-2.5 text-sm font-semibold text-[#687386] hover:bg-[#f7f9fc]"
            >
              إلغاء
            </button>
          </div>
        )}
      </Modal>

      {printState && (
        <DocumentPrintPreview
          kind={printState.kind}
          documentNumber={printState.documentNumber}
          items={printState.items}
          partyName={printState.partyName}
          partyPhone={printState.partyPhone}
          subtotal={printState.subtotal}
          discount={printState.discount}
          taxAmount={printState.taxAmount}
          total={printState.total}
          paid={printState.paid}
          paymentMethod={printState.paymentMethod}
          notes={printState.notes}
          cashierName={profile?.full_name || "الكاشير"}
          settings={settings}
          issuedAt={printState.issuedAt}
          onClose={() => setPrintState(null)}
        />
      )}
    </>
  );
}

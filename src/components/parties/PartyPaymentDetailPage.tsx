"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { invoiceTypeLabel } from "@/lib/history";
import { safesOrderQuery } from "@/lib/safes-order";
import { pickDefaultSafeId } from "@/lib/safe-transactions";
import {
  applyPartyPayment,
  deletePartyPayment,
  fetchOpenInvoicesForParty,
  getPartyPayment,
  partyPaymentDocNumber,
  previewFifoAllocation,
  updatePartyPayment,
  type AllocationPreview,
  type OpenInvoiceForPayment,
  type PartyPaymentKind,
  type PartyPaymentRow,
} from "@/lib/party-payments";
import { applyPartyPaymentOnlineOrQueue } from "@/lib/offline";
import {
  InvoiceOperationModal,
  type InvoiceOpSelection,
} from "@/components/history/InvoiceOperationModal";
import { PartyPaymentPrintPreview } from "@/components/print/PartyPaymentPrintPreview";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
import type { Customer, Safe, Settings, Supplier } from "@/types";
import {
  ArrowRight,
  ExternalLink,
  Printer,
  Trash2,
  Wallet,
} from "lucide-react";

type PartyPaymentDetailPageProps = {
  kind: PartyPaymentKind;
  partyId: string;
  /** null = صفحة تحصيل/سداد جديد */
  paymentId: string | null;
};

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function PartyPaymentDetailPage({
  kind,
  partyId,
  paymentId,
}: PartyPaymentDetailPageProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const { profile, loading: authLoading } = useAuth();
  const subject = profileSubject(profile);
  const canManagePayment =
    (kind === "customer" &&
      (canAccess(subject, "customers") ||
        canAccess(subject, "customers.write") ||
        canAccess(subject, "treasury"))) ||
    (kind === "supplier" &&
      (canAccess(subject, "suppliers") || canAccess(subject, "treasury")));

  const isNew = !paymentId;
  const actionLabel = kind === "customer" ? "تحصيل" : "سداد";
  const partyHref = kind === "customer" ? `/customers/${partyId}` : `/suppliers/${partyId}`;
  const partyListLabel = kind === "customer" ? "العميل" : "المورد";

  const [party, setParty] = useState<(Customer | Supplier) | null>(null);
  const [payment, setPayment] = useState<PartyPaymentRow | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceForPayment[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [amount, setAmount] = useState("");
  const [safeId, setSafeId] = useState("");
  const [notes, setNotes] = useState("");
  const [showPrint, setShowPrint] = useState(false);
  const [selectedOp, setSelectedOp] = useState<InvoiceOpSelection | null>(null);

  async function load() {
    setLoading(true);
    try {
      const table = kind === "customer" ? "customers" : "suppliers";
      const [partyRes, settingsRes, safesRes, paymentData] = await Promise.all([
        supabase.from(table).select("*").eq("id", partyId).maybeSingle(),
        supabase.from("settings").select("*").limit(1).maybeSingle(),
        safesOrderQuery(
          supabase.from("safes").select("*").eq("is_active", true)
        ),
        paymentId ? getPartyPayment(supabase, paymentId) : Promise.resolve(null),
      ]);

      if (!partyRes.data) {
        setParty(null);
        setLoading(false);
        return;
      }

      const partyData = partyRes.data as Customer | Supplier;
      setParty(partyData);
      if (settingsRes.data) setSettings(settingsRes.data as Settings);

      const safeList = (safesRes.data || []) as Safe[];
      setSafes(safeList);

      if (paymentId) {
        if (!paymentData || paymentData.party_id !== partyId) {
          toastError("الدفعة غير موجودة");
          router.replace(partyHref);
          return;
        }
        if (paymentData.party_type !== kind) {
          toastError("نوع الدفعة غير مطابق");
          router.replace(partyHref);
          return;
        }
        setPayment(paymentData);
        setAmount(String(paymentData.amount));
        setSafeId(
          pickDefaultSafeId(safeList, undefined, paymentData.safe_id)
        );
        setNotes(paymentData.notes || "");

        const invoices = await fetchOpenInvoicesForParty(
          supabase,
          kind,
          partyId,
          {
            creditAllocations: (paymentData.allocations || []).map((a) => ({
              invoice_id: a.invoice_id,
              amount: a.amount,
            })),
          }
        );
        setOpenInvoices(invoices);
      } else {
        setPayment(null);
        setNotes("");
        setSafeId(pickDefaultSafeId(safeList));
        const invoices = await fetchOpenInvoicesForParty(
          supabase,
          kind,
          partyId
        );
        setOpenInvoices(invoices);
        const totalOpen = invoices.reduce((s, i) => s + i.remaining, 0);
        setAmount(totalOpen > 0 ? String(totalOpen) : "");
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر التحميل");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, partyId, paymentId]);

  const payAmount = Number(amount) || 0;
  const preview = useMemo(
    () => previewFifoAllocation(openInvoices, payAmount),
    [openInvoices, payAmount]
  );
  const totalOpen = preview.totalOpen;
  const remainingAfter = money(totalOpen - payAmount);
  const balanceAfter = money(
    Number(party?.balance || 0) -
      (isNew ? payAmount : payAmount - Number(payment?.amount || 0))
  );

  const isDirty = useMemo(() => {
    if (isNew) {
      return payAmount > 0 || !!notes.trim() || !!safeId;
    }
    if (!payment) return false;
    return (
      money(payAmount) !== money(payment.amount) ||
      safeId !== payment.safe_id ||
      (notes.trim() || "") !== (payment.notes || "")
    );
  }, [isNew, payAmount, notes, safeId, payment]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const docNumber = payment
    ? partyPaymentDocNumber(payment.id, kind)
    : `جديد — ${actionLabel}`;

  async function handleSave() {
    if (saving || !party) return;
    if (!canManagePayment) {
      toastError("تحصيل/سداد الأطراف غير مسموح لصلاحياتك");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const { paymentId: newId, offline, tempNumber } =
          await applyPartyPaymentOnlineOrQueue(supabase, {
            kind,
            partyId,
            partyName: party.name,
            amount: payAmount,
            safeId,
            notes,
            createdAt: new Date().toISOString(),
          });
        toastSuccess(
          offline
            ? `تم الحفظ أوفلاين ${tempNumber || ""} — سيُزامن عند عودة النت`
            : kind === "customer"
              ? `تم تحصيل ${formatCurrency(payAmount)} بنجاح`
              : `تم سداد ${formatCurrency(payAmount)} بنجاح`
        );
        if (offline) {
          router.replace(
            kind === "customer"
              ? `/customers/${partyId}`
              : `/suppliers/${partyId}`
          );
          return;
        }
        router.replace(
          kind === "customer"
            ? `/customers/${partyId}/payments/${newId}`
            : `/suppliers/${partyId}/payments/${newId}`
        );
      } else if (payment) {
        await updatePartyPayment(supabase, {
          paymentId: payment.id,
          partyName: party.name,
          amount: payAmount,
          safeId,
          notes,
        });
        toastSuccess(
          kind === "customer"
            ? `تم تعديل التحصيل إلى ${formatCurrency(payAmount)}`
            : `تم تعديل السداد إلى ${formatCurrency(payAmount)}`
        );
        await load();
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر حفظ الدفعة");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!payment || deleting) return;
    if (!canManagePayment) {
      toastError("تحصيل/سداد الأطراف غير مسموح لصلاحياتك");
      return;
    }
    if (
      !(await confirm({
        message:
          kind === "customer"
            ? `حذف تحصيل ${formatCurrency(payment.amount)}؟ سترجع الفواتير والرصيد والخزنة كما كانوا.`
            : `حذف سداد ${formatCurrency(payment.amount)}؟ سترجع الفواتير والرصيد والخزنة كما كانوا.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    )
      return;
    setDeleting(true);
    try {
      await deletePartyPayment(supabase, payment.id);
      toastSuccess("تم حذف الدفعة وعكس التوزيع");
      router.replace(partyHref);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "تعذر حذف الدفعة");
      setDeleting(false);
    }
  }

  function openInvoice(alloc: NonNullable<PartyPaymentRow["allocations"]>[number]) {
    if (!alloc.invoice_id) return;
    setSelectedOp({
      invoiceId: alloc.invoice_id,
      invoiceNumber: alloc.invoice_number || "—",
      type: alloc.invoice_type || (kind === "customer" ? "sale" : "purchase"),
      party: party?.name || "—",
      createdAt: alloc.invoice_created_at || payment?.created_at || new Date().toISOString(),
    });
  }

  if (loading || authLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
      </div>
    );
  }

  if (!canManagePayment) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
        <p className="font-bold text-amber-900">
          تحصيل/سداد الأطراف غير مسموح لصلاحياتك
        </p>
        <Link
          href={partyHref}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#1473e6]"
        >
          <ArrowRight className="h-4 w-4" />
          العودة
        </Link>
      </div>
    );
  }

  if (!party) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
        <p className="font-bold text-rose-800">{partyListLabel} غير موجود</p>
        <Link
          href={kind === "customer" ? "/customers" : "/suppliers"}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#1473e6]"
        >
          <ArrowRight className="h-4 w-4" />
          العودة
        </Link>
      </div>
    );
  }

  const canSave =
    payAmount > 0 &&
    !!safeId &&
    openInvoices.length > 0 &&
    preview.leftover <= 0.001 &&
    !saving;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={async () => {
              if (
                isDirty &&
                !(await confirm({
                  message: "فيه تعديلات غير محفوظة. تخرج بدون حفظ؟",
                }))
              ) {
                return;
              }
              router.push(partyHref);
            }}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-[#1473e6] hover:underline"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            العودة لـ{party.name}
          </button>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eaf4ff] text-[#1473e6]">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#172033]">
                {isNew ? `${actionLabel} جديد` : actionLabel}
              </h1>
              <p className="font-mono text-sm text-[#687386]">{docNumber}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isNew && payment ? (
            <>
              <button
                type="button"
                onClick={() => setShowPrint(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                <Printer className="h-4 w-4" />
                طباعة
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "..." : "حذف"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label={kind === "customer" ? "العميل" : "المورد"}
          value={party.name}
        />
        <SummaryCard
          label={!isNew ? `مبلغ ال${actionLabel}` : "المبلغ"}
          value={
            !isNew && payment
              ? formatCurrency(payment.amount)
              : payAmount > 0
                ? formatCurrency(payAmount)
                : "—"
          }
        />
        <SummaryCard
          label="الرصيد الحالي"
          value={`${formatCurrency(Math.abs(party.balance))}${
            party.balance > 0
              ? kind === "customer"
                ? " (عليه)"
                : " (علينا)"
              : party.balance < 0
                ? kind === "customer"
                  ? " (له)"
                  : " (لنا)"
                : ""
          }`}
        />
        <SummaryCard
          label="متبقي الفواتير المفتوحة"
          value={formatCurrency(totalOpen)}
        />
      </div>

      {!isNew && payment ? (
        <div className="rounded-xl border border-[#e1e6ee] bg-white px-4 py-3 text-sm text-[#526176] shadow-sm">
          <span>التاريخ: </span>
          <span className="font-bold text-[#172033]">
            {formatDateShort(payment.created_at)}
            {" · "}
            {new Date(payment.created_at).toLocaleTimeString("ar-EG", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="mx-2 text-[#c5ccd8]">·</span>
          <span>الخزنة: </span>
          <span className="font-bold text-[#172033]">
            {payment.safe_name || "—"}
          </span>
          {payment.created_by_name ? (
            <>
              <span className="mx-2 text-[#c5ccd8]">·</span>
              <span>بواسطة: </span>
              <span className="font-bold text-[#172033]">
                {payment.created_by_name}
              </span>
            </>
          ) : null}
          {payment.notes ? (
            <>
              <span className="mx-2 text-[#c5ccd8]">·</span>
              <span>ملاحظة: </span>
              <span className="font-semibold text-[#172033]">
                {payment.notes}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-[#e1e6ee] bg-white p-4 shadow-sm">
          <h2 className="font-bold text-[#172033]">
            {isNew ? `بيانات ال${actionLabel}` : `تعديل ال${actionLabel}`}
          </h2>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-[#e1e6ee] bg-[#f8fafc] px-3 py-2.5">
              <p className="text-[11px] font-semibold text-[#687386]">
                إجمالي المتبقي
              </p>
              <p className="mt-0.5 text-base font-bold text-[#172033]">
                {formatCurrency(totalOpen)}
              </p>
            </div>
            <div
              className={`rounded-xl border px-3 py-2.5 ${
                remainingAfter > 0.001
                  ? "border-amber-200 bg-amber-50"
                  : "border-emerald-200 bg-emerald-50"
              }`}
            >
              <p className="text-[11px] font-semibold text-[#687386]">
                فاضل بعد العملية
              </p>
              <p
                className={`mt-0.5 text-base font-bold ${
                  remainingAfter > 0.001
                    ? "text-amber-800"
                    : "text-emerald-800"
                }`}
              >
                {formatCurrency(Math.max(0, remainingAfter))}
              </p>
            </div>
          </div>

          <p className="text-xs text-[#526176]">
            رصيد الطرف بعد العملية تقريباً:{" "}
            <span className="font-bold text-[#172033]">
              {formatCurrency(Math.abs(balanceAfter))}
              {balanceAfter > 0.001
                ? kind === "customer"
                  ? " (عليه)"
                  : " (علينا)"
                : balanceAfter < -0.001
                  ? kind === "customer"
                    ? " (له)"
                    : " (لنا)"
                  : ""}
            </span>
          </p>

          <label className="block space-y-1.5 text-sm">
            <span className="font-semibold text-[#172033]">المبلغ</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
            {totalOpen > 0 ? (
              <button
                type="button"
                onClick={() => setAmount(String(totalOpen))}
                className="text-[11px] font-semibold text-[#1473e6] hover:underline"
              >
                تحصيل كامل المتبقي ({formatCurrency(totalOpen)})
              </button>
            ) : null}
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="font-semibold text-[#172033]">الخزنة</span>
            <select
              value={safeId}
              onChange={(e) => setSafeId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="">اختر الخزنة</option>
              {safes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({formatCurrency(s.balance)})
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="font-semibold text-[#172033]">ملاحظة</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              placeholder="اختياري"
            />
          </label>

          <AllocationPreview
            allocations={preview.allocations}
            leftover={preview.leftover}
            totalOpen={totalOpen}
            payAmount={payAmount}
            remainingAfter={remainingAfter}
          />

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave || (!isNew && !isDirty)}
            className="w-full rounded-xl bg-[#1473e6] py-3 text-sm font-bold text-white hover:bg-[#0b5fc4] disabled:opacity-50"
          >
            {saving
              ? "جاري الحفظ..."
              : isNew
                ? `تأكيد ${actionLabel}`
                : isDirty
                  ? "حفظ التعديل"
                  : "لا توجد تعديلات"}
          </button>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e1e6ee] bg-white shadow-sm">
          <div className="border-b border-[#e1e6ee] px-4 py-3">
            <h2 className="font-bold text-[#172033]">الفواتير المتأثرة</h2>
            <p className="text-xs text-[#687386]">
              {isNew
                ? "معاينة التوزيع قبل الحفظ (من الأقدم للأحدث)"
                : "الفواتير اللي الدفعة سدّدت عليها — اضغط لفتح المستند"}
            </p>
          </div>

          {!isNew && payment && (payment.allocations || []).length > 0 ? (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-[#f3f6fa] text-[#526176]">
                  <tr>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      الفاتورة
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      من الدفعة
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      الإجمالي
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      المدفوع
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      المتبقي
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      فتح
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef1f6]">
                  {(payment.allocations || []).map((a) => {
                    const total = Number(a.invoice_total) || 0;
                    const paid = Number(a.invoice_paid_amount) || 0;
                    const remaining = Math.max(0, total - paid);
                    return (
                      <tr
                        key={a.id}
                        className="cursor-pointer hover:bg-[#eef6ff]"
                        onClick={() => openInvoice(a)}
                      >
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs font-semibold text-[#1473e6]">
                            {a.invoice_number || "—"}
                          </span>
                          {a.invoice_type ? (
                            <span className="mt-0.5 block text-[11px] text-[#687386]">
                              {invoiceTypeLabel(a.invoice_type)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 font-bold text-emerald-700">
                          {formatCurrency(a.amount)}
                        </td>
                        <td className="px-3 py-2.5">
                          {formatCurrency(total)}
                        </td>
                        <td className="px-3 py-2.5">
                          {formatCurrency(paid)}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-rose-700">
                          {formatCurrency(remaining)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 rounded-lg border border-[#9ec5f5] bg-[#eaf4ff] px-2 py-1 text-[11px] font-bold text-[#0b5fc4]">
                            <ExternalLink className="h-3.5 w-3.5" />
                            فتح
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : isNew && preview.allocations.length > 0 ? (
            <ul className="divide-y divide-[#eef1f6] px-4 py-2 text-sm">
              {preview.allocations.map((a) => (
                <li
                  key={a.invoiceId}
                  className="flex items-center justify-between gap-2 py-2.5"
                >
                  <span className="text-[#526176]">
                    فاتورة{" "}
                    <span className="font-mono font-semibold text-[#1473e6]">
                      {a.invoiceNumber}
                    </span>
                    {a.remainingAfter <= 0.001 ? (
                      <span className="mr-1 text-emerald-700"> · تتقفل</span>
                    ) : (
                      <span className="mr-1 text-[#687386]">
                        {" "}
                        · متبقي {formatCurrency(a.remainingAfter)}
                      </span>
                    )}
                  </span>
                  <span className="font-bold text-[#172033]">
                    {formatCurrency(a.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-[#687386]">
              {isNew
                ? "أدخل مبلغاً لعرض الفواتير اللي هتتأثر"
                : "لا توجد فواتير مرتبطة بهذه الدفعة"}
            </p>
          )}
        </section>
      </div>

      <InvoiceOperationModal
        selected={selectedOp}
        settings={settings}
        onClose={() => setSelectedOp(null)}
        onInvoiceUpdated={() => void load()}
      />

      {showPrint && payment ? (
        <PartyPaymentPrintPreview
          payment={payment}
          partyName={party.name}
          partyPhone={party.phone}
          settings={settings}
          onClose={() => setShowPrint(false)}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#e1e6ee] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-[#687386]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[#172033]">{value}</p>
    </div>
  );
}

function AllocationPreview({
  allocations,
  leftover,
  totalOpen,
  payAmount,
  remainingAfter,
}: {
  allocations: AllocationPreview[];
  leftover: number;
  totalOpen: number;
  payAmount: number;
  remainingAfter: number;
}) {
  if (payAmount <= 0) {
    return (
      <p className="rounded-lg border border-[#eef1f6] bg-[#f8fafc] px-3 py-2 text-xs text-[#687386]">
        أدخل مبلغاً لعرض التوزيع على الفواتير.
      </p>
    );
  }
  if (leftover > 0.001) {
    return (
      <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">
        المبلغ أكبر من إجمالي المتبقي ({formatCurrency(totalOpen)}).
      </p>
    );
  }
  if (allocations.length === 0) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        لا توجد فواتير مفتوحة للتوزيع.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-[#e1e6ee] bg-[#f8fafc] p-3 text-xs">
      <p className="mb-1 font-bold text-[#172033]">معاينة التوزيع</p>
      <p className="text-[#526176]">
        {allocations.length} فاتورة · فاضل بعد العملية{" "}
        <span
          className={
            remainingAfter > 0.001 ? "font-bold text-amber-800" : "font-bold text-emerald-800"
          }
        >
          {formatCurrency(Math.max(0, remainingAfter))}
        </span>
      </p>
    </div>
  );
}

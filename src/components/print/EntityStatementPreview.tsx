"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { printReport } from "@/lib/print";
import type { Settings } from "@/types";
import { resolveStoreName, statementInvoiceColumns } from "./report-columns";
import { PrintBrandMark } from "./PrintBrandMark";
import { DateField } from "@/components/ui/DateField";
import { createClient } from "@/lib/supabase";
import {
  crossAppDetailsSummary,
  parseCrossAppDetails,
} from "@/lib/history";

type PartyKind = "customer" | "supplier";

type StatementInvoice = {
  id: string;
  invoice_number: string;
  type: string;
  total: number;
  paid_amount: number;
  payment_method: string;
  created_at: string;
  status: string;
  notes?: string | null;
  isPartyPayment?: boolean;
  isCrossApp?: boolean;
  /** ملخص بنود شغل الورشة للطباعة */
  workshopLinesSummary?: string | null;
};

interface EntityStatementPreviewProps {
  kind: PartyKind;
  party: {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
    balance: number;
  };
  settings: Settings | null;
  onClose: () => void;
  initialDateFrom?: string;
  initialDateTo?: string;
  /** Optional dual-role counterpart for combined statement */
  linkedParty?: {
    id: string;
    kind: PartyKind;
    name: string;
    balance: number;
  } | null;
  netBalanceLabel?: string;
}

function mapPaymentRows(
  rows: Record<string, unknown>[],
  partyKind: PartyKind
): StatementInvoice[] {
  return rows.map((row) => {
    const safe = Array.isArray(row.safes) ? row.safes[0] : row.safes;
    const allocs = (row.party_payment_allocations || []) as {
      amount: number;
      invoices?:
        | { invoice_number?: string }
        | { invoice_number?: string }[]
        | null;
    }[];
    const allocNote = allocs
      .map((a) => {
        const inv = Array.isArray(a.invoices) ? a.invoices[0] : a.invoices;
        return `${inv?.invoice_number || "فاتورة"}: ${Number(a.amount).toFixed(2)}`;
      })
      .join(" · ");
    const amount = Number(row.amount) || 0;
    const isSettlement = Boolean(row.is_settlement);
    const shortId = String(row.id).replace(/-/g, "").slice(0, 8).toUpperCase();
    const prefix = isSettlement
      ? "مقاصة"
      : partyKind === "customer"
        ? "تحص"
        : "سداد";
    return {
      id: `party-pay-${row.id}`,
      invoice_number: `${prefix}-${shortId}`,
      type: isSettlement
        ? "settlement"
        : partyKind === "customer"
          ? "collection"
          : "disbursement",
      total: amount,
      paid_amount: amount,
      payment_method: isSettlement
        ? "مقاصة"
        : (safe as { name?: string } | null)?.name || "خزنة",
      created_at: row.created_at as string,
      status: "completed",
      notes: [row.notes, allocNote ? `توزيع: ${allocNote}` : null]
        .filter(Boolean)
        .join(" — "),
      isPartyPayment: true,
    };
  });
}

export function EntityStatementPreview({
  kind,
  party,
  settings,
  onClose,
  initialDateFrom,
  initialDateTo,
  linkedParty = null,
  netBalanceLabel,
}: EntityStatementPreviewProps) {
  const supabase = createClient();
  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date();
  monthStart.setDate(1);
  const defaultFrom = monthStart.toISOString().split("T")[0];
  const isDual = Boolean(linkedParty);

  const [dateFrom, setDateFrom] = useState(initialDateFrom || defaultFrom);
  const [dateTo, setDateTo] = useState(initialDateTo || today);
  const [invoices, setInvoices] = useState<StatementInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState(
    isDual
      ? `كشف حساب موحّد — ${party.name}`
      : kind === "customer"
        ? `كشف حساب عميل — ${party.name}`
        : `كشف حساب مورد — ${party.name}`
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

  useEffect(() => {
    void fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, party.id, kind, linkedParty?.id]);

  async function fetchInvoices() {
    setLoading(true);

    async function fetchSide(sideKind: PartyKind, sideId: string) {
      const types =
        sideKind === "customer"
          ? ["sale", "sale_return"]
          : ["purchase", "purchase_return"];

      let query = supabase
        .from("invoices")
        .select(
          "id, invoice_number, type, total, paid_amount, payment_method, created_at, status"
        )
        .in("type", types)
        .eq("status", "completed")
        .order("created_at", { ascending: true });

      if (sideKind === "customer") {
        query = query.eq("customer_id", sideId);
      } else {
        query = query.eq("supplier_id", sideId);
      }
      if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
      if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

      let paymentsQuery = supabase
        .from("party_payments")
        .select(
          "id, party_type, amount, safe_id, notes, created_at, is_settlement, settlement_group_id, safes(name), party_payment_allocations(id, invoice_id, amount, invoices(invoice_number))"
        )
        .eq("party_type", sideKind)
        .eq("party_id", sideId)
        .order("created_at", { ascending: true });
      if (dateFrom) {
        paymentsQuery = paymentsQuery.gte(
          "created_at",
          `${dateFrom}T00:00:00`
        );
      }
      if (dateTo) {
        paymentsQuery = paymentsQuery.lte(
          "created_at",
          `${dateTo}T23:59:59`
        );
      }

      let ledgerQuery = supabase
        .from("cross_app_ledger_entries")
        .select(
          "id, source_system, source_ref, entry_type, amount, direction, occurred_at, notes, project_label, details"
        )
        .eq("party_type", sideKind)
        .eq("party_id", sideId)
        .order("occurred_at", { ascending: true });
      if (dateFrom) {
        ledgerQuery = ledgerQuery.gte("occurred_at", `${dateFrom}T00:00:00`);
      }
      if (dateTo) {
        ledgerQuery = ledgerQuery.lte("occurred_at", `${dateTo}T23:59:59`);
      }

      const [invRes, payRes, ledgerRes] = await Promise.all([
        query,
        paymentsQuery,
        ledgerQuery,
      ]);
      const invoiceRows = ((invRes.data as StatementInvoice[]) || []).map(
        (inv) => ({ ...inv, isPartyPayment: false })
      );
      const paymentRows = mapPaymentRows(
        (payRes.data || []) as Record<string, unknown>[],
        sideKind
      );
      let ledgerRaw = (ledgerRes.data || []) as Record<string, unknown>[];
      if (ledgerRes.error) {
        let fallbackQuery = supabase
          .from("cross_app_ledger_entries")
          .select(
            "id, source_system, source_ref, entry_type, amount, direction, occurred_at, notes, project_label"
          )
          .eq("party_type", sideKind)
          .eq("party_id", sideId)
          .order("occurred_at", { ascending: true });
        if (dateFrom) {
          fallbackQuery = fallbackQuery.gte(
            "occurred_at",
            `${dateFrom}T00:00:00`
          );
        }
        if (dateTo) {
          fallbackQuery = fallbackQuery.lte(
            "occurred_at",
            `${dateTo}T23:59:59`
          );
        }
        const fb = await fallbackQuery;
        ledgerRaw = (fb.data || []) as Record<string, unknown>[];
      }
      const ledgerRows: StatementInvoice[] = ledgerRaw.map((entry) => {
        const amount = Number(entry.amount) || 0;
        const isCredit = entry.direction === "credit";
        const srcLabel =
          entry.source_system === "plisse" ? "بلسية" : "PVC";
        const details = parseCrossAppDetails(entry.details);
        const summary = crossAppDetailsSummary(details);
        const docNo =
          details?.invoice_number != null
            ? String(details.invoice_number)
            : String(entry.source_ref || "").slice(0, 24);
        return {
          id: `xapp-${entry.id}`,
          invoice_number: docNo,
          type: String(entry.entry_type || "workshop_adjustment"),
          total: amount,
          paid_amount: isCredit ? amount : 0,
          payment_method: srcLabel,
          created_at: String(entry.occurred_at || ""),
          status: "completed",
          notes: [srcLabel, entry.project_label, entry.notes]
            .filter(Boolean)
            .join(" — "),
          isCrossApp: true,
          workshopLinesSummary: summary || null,
        };
      });
      return {
        invoiceRows: [...invoiceRows, ...ledgerRows],
        paymentRows,
        rawPayments: payRes.data || [],
      };
    }

    const primary = await fetchSide(kind, party.id);
    let invoiceRows = primary.invoiceRows;
    let paymentRows = primary.paymentRows;

    if (linkedParty) {
      const secondary = await fetchSide(linkedParty.kind, linkedParty.id);
      invoiceRows = [...invoiceRows, ...secondary.invoiceRows];
      const seenGroups = new Set<string>();
      const seenIds = new Set(paymentRows.map((p) => p.id));
      for (const raw of secondary.rawPayments as {
        id: string;
        is_settlement?: boolean;
        settlement_group_id?: string | null;
      }[]) {
        if (raw.is_settlement && raw.settlement_group_id) {
          if (seenGroups.has(raw.settlement_group_id)) continue;
          const already = (primary.rawPayments as typeof secondary.rawPayments).some(
            (p) =>
              (p as { settlement_group_id?: string }).settlement_group_id ===
              raw.settlement_group_id
          );
          if (already) {
            seenGroups.add(raw.settlement_group_id);
            continue;
          }
          seenGroups.add(raw.settlement_group_id);
        }
        const mapped = mapPaymentRows(
          [raw as unknown as Record<string, unknown>],
          linkedParty.kind
        )[0];
        if (mapped && !seenIds.has(mapped.id)) {
          paymentRows.push(mapped);
          seenIds.add(mapped.id);
        }
      }
    }

    const merged = [...invoiceRows, ...paymentRows].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    setInvoices(merged);
    setLoading(false);
  }

  const periodTotal = invoices.reduce((s, inv) => {
    if (
      inv.type === "collection" ||
      inv.type === "disbursement" ||
      inv.type === "settlement" ||
      inv.type === "workshop_collection" ||
      inv.type === "workshop_void"
    )
      return s;
    if (inv.type.includes("return")) return s - Number(inv.total);
    return s + Number(inv.total);
  }, 0);

  const periodPaid = invoices.reduce((s, inv) => {
    if (
      inv.type === "collection" ||
      inv.type === "disbursement" ||
      inv.type === "settlement" ||
      inv.type.startsWith("workshop_")
    )
      return s;
    if (inv.type.includes("return")) return s - Number(inv.paid_amount);
    return s + Number(inv.paid_amount);
  }, 0);

  const periodCollections = invoices.reduce((s, inv) => {
    if (
      inv.type === "collection" ||
      inv.type === "disbursement" ||
      inv.type === "settlement" ||
      inv.type === "workshop_collection"
    ) {
      return s + Number(inv.paid_amount || inv.total);
    }
    return s;
  }, 0);

  const storeName = resolveStoreName(settings);

  if (!canPortal) return null;

  const body = (
    <div
      className="print-paper print-report-sheet w-full text-black"
      data-watermark={storeName}
      dir="rtl"
    >
      <div className="mb-4 border-b border-slate-300 pb-3 text-center">
        <PrintBrandMark />
        <h1 className="text-xl font-black">{storeName}</h1>
        <h2 className="mt-3 text-base font-bold">{title}</h2>
        <p className="mt-1 text-[11px] text-slate-600">
          الفترة: {formatDateShort(dateFrom)} — {formatDateShort(dateTo)}
        </p>
        <p className="mt-1 text-[10px] text-slate-500">
          تاريخ الطباعة: {formatDateShort(printedAt)}
        </p>
      </div>

      <div className="mb-3 rounded border border-slate-200 p-3 text-[11px] space-y-1">
        <div className="flex justify-between">
          <span className="text-slate-500">
            {kind === "customer" ? "العميل" : "المورد"}:
          </span>
          <span className="font-bold">{party.name}</span>
        </div>
        {party.phone && (
          <div className="flex justify-between">
            <span className="text-slate-500">الهاتف:</span>
            <span dir="ltr">{party.phone}</span>
          </div>
        )}
        {party.address && (
          <div className="flex justify-between">
            <span className="text-slate-500">العنوان:</span>
            <span>{party.address}</span>
          </div>
        )}
        {linkedParty ? (
          <div className="flex justify-between text-slate-600">
            <span>مربوط بـ:</span>
            <span className="font-semibold">{linkedParty.name}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-slate-100 pt-1.5 font-bold">
          <span>{netBalanceLabel ? "الرصيد الصافي:" : "الرصيد الحالي:"}</span>
          <span
            className={
              netBalanceLabel
                ? netBalanceLabel.includes("عليّا")
                  ? "text-red-700"
                  : netBalanceLabel.includes("ليّا")
                    ? "text-green-700"
                    : ""
                : party.balance > 0
                  ? "text-red-700"
                  : party.balance < 0
                    ? "text-green-700"
                    : ""
            }
          >
            {netBalanceLabel || formatCurrency(party.balance)}
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-[11px]">
        <div className="rounded border border-slate-200 px-2 py-1">
          <span className="text-slate-500">عدد الحركات: </span>
          <span className="font-bold">{invoices.length}</span>
        </div>
        <div className="rounded border border-slate-200 px-2 py-1">
          <span className="text-slate-500">إجمالي الفواتير: </span>
          <span className="font-bold">{formatCurrency(periodTotal)}</span>
        </div>
        <div className="rounded border border-slate-200 px-2 py-1">
          <span className="text-slate-500">المدفوع على الفواتير: </span>
          <span className="font-bold">{formatCurrency(periodPaid)}</span>
        </div>
        <div className="rounded border border-slate-200 px-2 py-1">
          <span className="text-slate-500">
            {kind === "customer" ? "تحصيلات مجمّعة: " : "سدادات مجمّعة: "}
          </span>
          <span className="font-bold">{formatCurrency(periodCollections)}</span>
        </div>
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2 border-slate-800">
            <th className="px-1 py-1.5 text-right font-bold">#</th>
            {statementInvoiceColumns.map((col) => (
              <th key={col.key} className="px-1 py-1.5 text-right font-bold">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoices.length === 0 ? (
            <tr>
              <td
                colSpan={statementInvoiceColumns.length + 1}
                className="py-6 text-center text-slate-500"
              >
                لا توجد حركات في هذه الفترة
              </td>
            </tr>
          ) : (
            invoices.map((inv, index) => (
              <Fragment key={inv.id}>
                <tr className="border-b border-slate-200">
                  <td className="px-1 py-1.5 text-slate-500">{index + 1}</td>
                  {statementInvoiceColumns.map((col) => (
                    <td key={col.key} className="px-1 py-1.5">
                      {col.getValue(inv as unknown as Record<string, unknown>)}
                    </td>
                  ))}
                </tr>
                {inv.workshopLinesSummary ? (
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <td />
                    <td
                      colSpan={statementInvoiceColumns.length}
                      className="px-1 py-1 text-[10px] text-slate-600"
                    >
                      {inv.workshopLinesSummary}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))
          )}
        </tbody>
      </table>

      {notes.trim() && (
        <div className="mt-4 border-t border-dashed border-slate-300 pt-2 text-[11px]">
          <p className="font-bold text-slate-700">ملاحظات:</p>
          <p className="mt-1 whitespace-pre-wrap">{notes}</p>
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
              <h3 className="text-sm font-bold text-slate-800">كشف حساب</h3>
              <p className="text-[11px] text-slate-500">{party.name}</p>
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
              <span className="mb-1 block font-semibold text-slate-600">من</span>
              <DateField
                value={dateFrom}
                onChange={setDateFrom}
                className="w-auto min-w-[150px]"
                inputClassName="border-slate-300"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-semibold text-slate-600">إلى</span>
              <DateField
                value={dateTo}
                onChange={setDateTo}
                className="w-auto min-w-[150px]"
                inputClassName="border-slate-300"
              />
            </label>
            <button
              type="button"
              onClick={() => void fetchInvoices()}
              className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white"
            >
              تحديث
            </button>
          </div>

          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-slate-600">العنوان</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-slate-600">
              ملاحظات
            </span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="اختياري"
            />
          </label>

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
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              طباعة الكشف
            </button>
          </div>
        </div>

        <div className="max-h-[40vh] overflow-y-auto bg-slate-200 p-4">
          <div className="print-paper mx-auto max-w-[210mm] rounded p-6 shadow-md">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
              </div>
            ) : (
              body
            )}
          </div>
        </div>
      </div>

      {!loading && (
        <div className="hidden print:block print-report">{body}</div>
      )}
    </div>,
    document.body
  );
}

"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, Printer, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { printReport } from "@/lib/print";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import {
  buildPartyStatement,
  daysAgoIsoDate,
  monthStartIsoDate,
  todayIsoDate,
  type PartyKind,
  type PartyStatement,
} from "@/lib/party-statement";
import type { Settings } from "@/types";
import { DateField } from "@/components/ui/DateField";
import { PartyStatementDocument } from "@/components/mobile/PartyStatementDocument";
import { MobileStatementShare } from "@/components/mobile/MobileStatementShare";

type Props = {
  kind: PartyKind;
  partyId: string;
  partyName: string;
  settings: Settings | null;
  onClose: () => void;
  initialDateFrom?: string;
  initialDateTo?: string;
};

function moneyCell(value: number) {
  if (Math.abs(value) < 0.0005) return "—";
  return formatCurrency(value);
}

export function PartyStatementPreview({
  kind,
  partyId,
  partyName,
  settings,
  onClose,
  initialDateFrom,
  initialDateTo,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const today = todayIsoDate();
  const defaultFrom = monthStartIsoDate();

  const [preset, setPreset] = useState<"month" | "days30" | "all">("month");
  const [dateFrom, setDateFrom] = useState(initialDateFrom || defaultFrom);
  const [dateTo, setDateTo] = useState(initialDateTo || today);
  const [showLines, setShowLines] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statement, setStatement] = useState<PartyStatement | null>(null);
  const issuedAt = useMemo(() => new Date(), []);
  const canPortal = typeof document !== "undefined";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const from = preset === "all" ? null : dateFrom || null;
        const to = dateTo || todayIsoDate();
        const next = await buildPartyStatement(supabase, {
          kind,
          partyId,
          dateFrom: from,
          dateTo: to,
          includeLines: true,
        });
        if (!cancelled) setStatement(next);
      } catch (e) {
        if (!cancelled) {
          setStatement(null);
          setError(e instanceof Error ? e.message : "تعذر تجهيز كشف الحساب");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, kind, partyId, preset, supabase]);

  function applyPreset(next: "month" | "days30" | "all") {
    setPreset(next);
    const end = todayIsoDate();
    setDateTo(end);
    if (next === "month") setDateFrom(monthStartIsoDate());
    if (next === "days30") setDateFrom(daysAgoIsoDate(30));
    if (next === "all") setDateFrom("");
  }

  if (!canPortal) return null;

  return createPortal(
    <div className="print-portal fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl no-print">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">كشف حساب</h3>
              <p className="text-[11px] text-slate-500">{partyName}</p>
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
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["month", "هذا الشهر"],
                ["days30", "آخر 30 يوم"],
                ["all", "الكل"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => applyPreset(id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  preset === id
                    ? "bg-slate-800 text-white"
                    : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              <span className="mb-1 block font-semibold text-slate-600">من</span>
              <DateField
                value={dateFrom}
                onChange={setDateFrom}
                disabled={preset === "all" || loading}
                className="w-auto min-w-[150px]"
                inputClassName="border-slate-300"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-semibold text-slate-600">إلى</span>
              <DateField
                value={dateTo}
                onChange={setDateTo}
                disabled={loading}
                className="w-auto min-w-[150px]"
                inputClassName="border-slate-300"
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={showLines}
                onChange={(e) => setShowLines(e.target.checked)}
                className="h-4 w-4"
              />
              عرض البنود
            </label>
          </div>

          {error ? (
            <p className="text-sm font-bold text-red-600">{error}</p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => printReport()}
              disabled={loading || !statement}
              className="flex items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              طباعة
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 py-3 text-xs font-semibold"
            >
              إغلاق
            </button>
          </div>

          {!loading && statement ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-bold text-slate-600">
                إرسال مثل الموبايل
              </p>
              <MobileStatementShare
                statement={statement}
                settings={settings}
                showLines={showLines}
                disabled={loading}
              />
            </div>
          ) : null}
        </div>

        <div className="max-h-[52vh] space-y-4 overflow-y-auto bg-slate-200 p-4">
          {loading || !statement ? (
            <div className="flex justify-center bg-white py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
            </div>
          ) : (
            <>
              <div className="stmt-table-wrap bg-white">
                <table className="stmt-summary">
                  <tbody>
                    <tr>
                      <th>رصيد سابق</th>
                      <td>{formatCurrency(statement.openingBalance)}</td>
                    </tr>
                    <tr>
                      <th>
                        {statement.kind === "customer"
                          ? "مدين (عليه)"
                          : "مدين (مدفوع)"}
                      </th>
                      <td className="stmt-table__debit">
                        {formatCurrency(statement.periodDebit)}
                      </td>
                    </tr>
                    <tr>
                      <th>
                        {statement.kind === "customer"
                          ? "دائن (له)"
                          : "دائن (علينا)"}
                      </th>
                      <td className="stmt-table__credit">
                        {formatCurrency(statement.periodCredit)}
                      </td>
                    </tr>
                    <tr>
                      <th>الرصيد الختامي</th>
                      <td className="stmt-table__balance">
                        {formatCurrency(statement.closingBalance)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="stmt-table-wrap bg-white">
                <table className="stmt-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>التاريخ</th>
                      <th>النوع</th>
                      <th>المستند</th>
                      <th>مدين</th>
                      <th>دائن</th>
                      <th>رصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.rows.map((row, index) => (
                      <Fragment key={row.id}>
                        <tr
                          className={
                            row.type === "opening"
                              ? "stmt-table__opening"
                              : undefined
                          }
                        >
                          <td>{index + 1}</td>
                          <td className="whitespace-nowrap">
                            {row.type === "opening"
                              ? "—"
                              : formatDateShort(row.occurredAt)}
                          </td>
                          <td className="font-extrabold">{row.label}</td>
                          <td>
                            <div>{row.reference}</div>
                            {row.notes ? (
                              <div className="mt-0.5 text-[10px] font-semibold text-[var(--muted)]">
                                {row.notes}
                              </div>
                            ) : null}
                          </td>
                          <td className="stmt-table__debit">
                            {moneyCell(row.debit)}
                          </td>
                          <td className="stmt-table__credit">
                            {moneyCell(row.credit)}
                          </td>
                          <td className="stmt-table__balance">
                            {formatCurrency(row.runningBalance)}
                          </td>
                        </tr>
                        {showLines && row.lines.length > 0 ? (
                          <tr className="stmt-table__nested">
                            <td colSpan={7}>
                              <table className="stmt-table stmt-table--compact">
                                <thead>
                                  <tr>
                                    <th>الصنف</th>
                                    <th>المواصفات</th>
                                    <th>الكمية</th>
                                    <th>سعر الوحدة</th>
                                    <th>الإجمالي</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.lines.map((line, idx) => (
                                    <tr key={`${row.id}-l-${idx}`}>
                                      <td className="font-bold">{line.name}</td>
                                      <td>{line.detail || "—"}</td>
                                      <td className="whitespace-nowrap">
                                        {line.qty || "—"}
                                      </td>
                                      <td className="whitespace-nowrap">
                                        {line.unitPrice != null
                                          ? formatCurrency(line.unitPrice)
                                          : "—"}
                                      </td>
                                      <td className="stmt-table__balance">
                                        {line.total != null
                                          ? formatCurrency(line.total)
                                          : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                    <tr className="stmt-table__foot">
                      <td colSpan={4}>الإجمالي</td>
                      <td>{formatCurrency(statement.periodDebit)}</td>
                      <td>{formatCurrency(statement.periodCredit)}</td>
                      <td>{formatCurrency(statement.closingBalance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mx-auto max-w-[210mm] overflow-hidden rounded shadow-md">
                <PartyStatementDocument
                  statement={statement}
                  settings={settings}
                  showLines={showLines}
                  issuedAt={issuedAt}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {!loading && statement ? (
        <div className="hidden print:block print-report party-statement-print">
          <PartyStatementDocument
            statement={statement}
            settings={settings}
            showLines={showLines}
            issuedAt={issuedAt}
          />
        </div>
      ) : null}
    </div>,
    document.body
  );
}

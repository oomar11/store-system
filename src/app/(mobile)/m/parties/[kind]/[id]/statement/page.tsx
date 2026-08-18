"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
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
import { MobileBackLink } from "@/components/mobile/MobileDetail";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileChip,
  MobileEmpty,
  MobileSection,
  MobileSkeleton,
} from "@/components/mobile/MobileUI";
import { MobileStatementShare } from "@/components/mobile/MobileStatementShare";

type Preset = "month" | "days30" | "all";

function moneyCell(value: number) {
  if (Math.abs(value) < 0.0005) return "—";
  return formatCurrency(value);
}

export default function MobilePartyStatementPage() {
  const params = useParams<{ kind: string; id: string }>();
  const kind = (params.kind === "supplier" ? "supplier" : "customer") as PartyKind;
  const id = params.id;
  const supabase = useMemo(() => createClient(), []);
  const { profile, loading: authLoading } = useAuth();
  const subject = profileSubject(profile);
  const allowed =
    canAccess(subject, "customers") || canAccess(subject, "suppliers");

  const [preset, setPreset] = useState<Preset>("month");
  const [dateFrom, setDateFrom] = useState(monthStartIsoDate);
  const [dateTo, setDateTo] = useState(todayIsoDate);
  const [showLines, setShowLines] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statement, setStatement] = useState<PartyStatement | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const from = preset === "all" ? null : dateFrom || null;
      const to = dateTo || todayIsoDate();
      const [next, settingsRes] = await Promise.all([
        buildPartyStatement(supabase, {
          kind,
          partyId: id,
          dateFrom: from,
          dateTo: to,
          includeLines: true,
        }),
        supabase.from("settings").select("*").limit(1).maybeSingle(),
      ]);
      setStatement(next);
      if (!settingsRes.error && settingsRes.data) {
        setSettings(settingsRes.data as Settings);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تجهيز كشف الحساب");
      setStatement(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, id, kind, preset, supabase]);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [allowed, authLoading, load]);

  function applyPreset(next: Preset) {
    setPreset(next);
    const today = todayIsoDate();
    setDateTo(today);
    if (next === "month") setDateFrom(monthStartIsoDate());
    if (next === "days30") setDateFrom(daysAgoIsoDate(30));
    if (next === "all") setDateFrom("");
  }

  const backHref = `/m/parties/${kind}/${id}`;

  return (
    <>
      <MobileHeader
        title="كشف حساب مفصّل"
        subtitle={statement?.party.name || (kind === "customer" ? "عميل" : "مورد")}
        onRefresh={load}
        refreshing={loading}
      />
      <div className="mobile-page">
        <MobileBackLink href={backHref} label="حساب الطرف" />

        {error ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
        ) : null}

        <MobileSection title="الفترة">
          <div className="mobile-chip-row mb-3">
            <MobileChip active={preset === "month"} onClick={() => applyPreset("month")}>
              هذا الشهر
            </MobileChip>
            <MobileChip
              active={preset === "days30"}
              onClick={() => applyPreset("days30")}
            >
              آخر 30 يوم
            </MobileChip>
            <MobileChip active={preset === "all"} onClick={() => applyPreset("all")}>
              الكل
            </MobileChip>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="mobile-field">
              <span>من</span>
              <DateField
                value={dateFrom}
                onChange={(value) => {
                  setDateFrom(value);
                }}
                disabled={preset === "all" || loading}
                inputClassName="min-h-11"
              />
            </label>
            <label className="mobile-field">
              <span>إلى</span>
              <DateField
                value={dateTo}
                onChange={(value) => {
                  setDateTo(value);
                }}
                disabled={loading}
                inputClassName="min-h-11"
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              checked={showLines}
              onChange={(e) => setShowLines(e.target.checked)}
              className="h-4 w-4"
            />
            عرض البنود
          </label>
        </MobileSection>

        {authLoading || loading || !statement ? (
          <MobileSkeleton rows={8} />
        ) : (
          <>
            <MobileSection title="ملخص الكشف">
            <div className="stmt-table-wrap">
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
            </MobileSection>

            <MobileSection title="جدول الحركات">
              <div className="stmt-table-wrap">
                {statement.rows.length === 0 ? (
                  <MobileEmpty message="لا توجد حركات في هذه الفترة" />
                ) : (
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
                              row.type === "opening" ? "stmt-table__opening" : undefined
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
                )}
              </div>
            </MobileSection>

            <MobileSection title="إرسال الكشف">
              <MobileStatementShare
                statement={statement}
                settings={settings}
                showLines={showLines}
                disabled={loading}
              />
            </MobileSection>
          </>
        )}
      </div>
    </>
  );
}

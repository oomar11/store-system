"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
            <div className="mobile-money-hero mb-3">
              <p className="mobile-money-hero__label">الرصيد الختامي</p>
              <p className="mobile-money-hero__amount">
                {formatCurrency(statement.closingBalance)}
              </p>
              <p className="mobile-money-hero__meta">
                رصيد سابق {formatCurrency(statement.openingBalance)}
              </p>
              <p className="mobile-money-hero__note">
                مدين {formatCurrency(statement.periodDebit)} · دائن{" "}
                {formatCurrency(statement.periodCredit)}
              </p>
            </div>

            <MobileSection title="الحركات">
              <div className="mobile-panel overflow-x-auto">
                {statement.rows.length === 0 ? (
                  <MobileEmpty message="لا توجد حركات في هذه الفترة" />
                ) : (
                  <table className="w-full min-w-[520px] border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                        <th className="px-1 py-2 text-right font-bold">التاريخ</th>
                        <th className="px-1 py-2 text-right font-bold">البيان</th>
                        <th className="px-1 py-2 text-right font-bold">مدين</th>
                        <th className="px-1 py-2 text-right font-bold">دائن</th>
                        <th className="px-1 py-2 text-right font-bold">رصيد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.rows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-[var(--border)] align-top"
                        >
                          <td className="whitespace-nowrap px-1 py-2">
                            {row.type === "opening"
                              ? "—"
                              : formatDateShort(row.occurredAt)}
                          </td>
                          <td className="px-1 py-2">
                            <div className="font-bold">
                              {row.label}
                              {row.reference && row.reference !== "—"
                                ? ` · ${row.reference}`
                                : ""}
                            </div>
                            {showLines && row.lines.length > 0 ? (
                              <ul className="mt-1 space-y-0.5 text-[10px] font-semibold text-[var(--muted)]">
                                {row.lines.map((line, idx) => (
                                  <li key={`${row.id}-l-${idx}`}>
                                    {[
                                      line.name,
                                      line.qty ? `× ${line.qty}` : null,
                                      line.total != null
                                        ? formatCurrency(line.total)
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-1 py-2">
                            {moneyCell(row.debit)}
                          </td>
                          <td className="whitespace-nowrap px-1 py-2">
                            {moneyCell(row.credit)}
                          </td>
                          <td className="whitespace-nowrap px-1 py-2 font-extrabold">
                            {formatCurrency(row.runningBalance)}
                          </td>
                        </tr>
                      ))}
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

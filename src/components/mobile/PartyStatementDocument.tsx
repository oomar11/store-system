"use client";

import { Fragment } from "react";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { resolveStoreName } from "@/components/print/report-columns";
import { PrintBrandMark } from "@/components/print/PrintBrandMark";
import type { PartyStatement } from "@/lib/party-statement";
import type { Settings } from "@/types";

const FONT =
  'var(--font-cairo), Cairo, "Segoe UI", Tahoma, sans-serif';

function moneyCell(value: number) {
  if (Math.abs(value) < 0.0005) return "—";
  return formatCurrency(value);
}

export function PartyStatementDocument({
  statement,
  settings,
  showLines,
  issuedAt,
}: {
  statement: PartyStatement;
  settings: Settings | null;
  showLines: boolean;
  issuedAt: Date;
}) {
  const storeName = resolveStoreName(settings);
  const period =
    statement.dateFrom && statement.dateTo
      ? `${formatDateShort(statement.dateFrom)} — ${formatDateShort(statement.dateTo)}`
      : statement.dateTo
        ? `حتى ${formatDateShort(statement.dateTo)}`
        : "كل الفترة";

  return (
    <div
      dir="rtl"
      style={{
        width: 794,
        padding: 28,
        background: "#ffffff",
        color: "#142033",
        fontFamily: FONT,
        boxSizing: "border-box",
        textAlign: "right",
        direction: "rtl",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 16, borderBottom: "2px solid #d7e0ea", paddingBottom: 12 }}>
        <PrintBrandMark logoUrl={settings?.logo_url} />
        <div style={{ fontWeight: 900, fontSize: 20, marginTop: 4 }}>{storeName}</div>
        {(settings?.phone || settings?.address) && (
          <div style={{ fontSize: 11, color: "#526176", fontWeight: 600, marginTop: 4 }}>
            {[settings?.address, settings?.phone].filter(Boolean).join(" · ")}
          </div>
        )}
        <div style={{ fontWeight: 800, fontSize: 15, marginTop: 10 }}>{statement.title}</div>
        <div style={{ fontSize: 11, color: "#526176", marginTop: 4 }}>الفترة: {period}</div>
        <div style={{ fontSize: 10, color: "#7a8699", marginTop: 2 }}>
          تاريخ الإصدار: {formatDateShort(issuedAt)}
        </div>
      </div>

      <div
        style={{
          border: "1px solid #d7e0ea",
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
          fontSize: 12,
          lineHeight: 1.7,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#66758a" }}>
            {statement.kind === "customer" ? "العميل" : "المورد"}
          </span>
          <strong>{statement.party.name}</strong>
        </div>
        {statement.party.phone ? (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#66758a" }}>الهاتف</span>
            <span dir="ltr">{statement.party.phone}</span>
          </div>
        ) : null}
        {statement.linkedParty ? (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#66758a" }}>حساب مربوط</span>
            <strong>{statement.linkedParty.name}</strong>
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid #eef1f6",
            marginTop: 6,
            paddingTop: 6,
            fontWeight: 800,
          }}
        >
          <span>الرصيد الختامي</span>
          <span>{formatCurrency(statement.closingBalance)}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, fontSize: 11, flexWrap: "wrap" }}>
        <span style={{ border: "1px solid #d7e0ea", borderRadius: 8, padding: "4px 8px" }}>
          مدين الفترة: <strong>{formatCurrency(statement.periodDebit)}</strong>
        </span>
        <span style={{ border: "1px solid #d7e0ea", borderRadius: 8, padding: "4px 8px" }}>
          دائن الفترة: <strong>{formatCurrency(statement.periodCredit)}</strong>
        </span>
        <span style={{ border: "1px solid #d7e0ea", borderRadius: 8, padding: "4px 8px" }}>
          عدد الحركات: <strong>{Math.max(0, statement.rows.length - 1)}</strong>
        </span>
      </div>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #142033" }}>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>#</th>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>التاريخ</th>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>البيان</th>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>مدين</th>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>دائن</th>
            <th style={{ textAlign: "right", padding: "6px 4px" }}>رصيد</th>
          </tr>
        </thead>
        <tbody>
          {statement.rows.map((row, index) => (
            <Fragment key={row.id}>
              <tr style={{ borderBottom: "1px solid #e2e9f2" }}>
                <td style={{ padding: "6px 4px", color: "#7a8699" }}>{index + 1}</td>
                <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                  {row.type === "opening" ? "—" : formatDateShort(row.occurredAt)}
                </td>
                <td style={{ padding: "6px 4px" }}>
                  <div style={{ fontWeight: 700 }}>
                    {row.label}
                    {row.reference && row.reference !== "—" ? ` · ${row.reference}` : ""}
                  </div>
                  {row.notes ? (
                    <div style={{ fontSize: 10, color: "#66758a" }}>{row.notes}</div>
                  ) : null}
                </td>
                <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                  {moneyCell(row.debit)}
                </td>
                <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                  {moneyCell(row.credit)}
                </td>
                <td style={{ padding: "6px 4px", whiteSpace: "nowrap", fontWeight: 800 }}>
                  {formatCurrency(row.runningBalance)}
                </td>
              </tr>
              {showLines && row.lines.length > 0
                ? row.lines.map((line, lineIdx) => (
                    <tr
                      key={`${row.id}-line-${lineIdx}`}
                      style={{ background: "#f7fafc", borderBottom: "1px solid #eef1f6" }}
                    >
                      <td />
                      <td />
                      <td
                        colSpan={4}
                        style={{ padding: "4px 4px 6px", fontSize: 10, color: "#526176" }}
                      >
                        {[
                          line.name,
                          line.detail,
                          line.qty ? `× ${line.qty}` : null,
                          line.unitPrice != null
                            ? formatCurrency(line.unitPrice)
                            : null,
                          line.total != null ? formatCurrency(line.total) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))
                : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

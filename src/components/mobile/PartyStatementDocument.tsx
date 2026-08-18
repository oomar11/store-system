"use client";

import { Fragment, type CSSProperties } from "react";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { resolveStoreName } from "@/components/print/report-columns";
import { PrintBrandMark } from "@/components/print/PrintBrandMark";
import type { PartyStatement, StatementLine } from "@/lib/party-statement";
import type { Settings } from "@/types";

const FONT =
  'var(--font-cairo), Cairo, "Segoe UI", Tahoma, sans-serif';

const INK = "#142033";
const MUTED = "#526176";
const LINE = "#c4cedb";
const HEAD = "#0b5fc4";
const DEBIT = "#b42318";
const CREDIT = "#027a48";
const ZEBRA = "#f4f8fc";
const OPENING_BG = "#eaf4ff";
const NESTED_BG = "#f8fbff";

function moneyCell(value: number) {
  if (Math.abs(value) < 0.0005) return "—";
  return formatCurrency(value);
}

function thStyle(extra?: CSSProperties): CSSProperties {
  return {
    textAlign: "right",
    padding: "8px 7px",
    fontWeight: 800,
    color: "#ffffff",
    background: HEAD,
    border: `1px solid ${HEAD}`,
    whiteSpace: "nowrap",
    ...extra,
  };
}

function tdStyle(extra?: CSSProperties): CSSProperties {
  return {
    textAlign: "right",
    padding: "7px 7px",
    border: `1px solid ${LINE}`,
    verticalAlign: "top",
    ...extra,
  };
}

function LinesTable({ lines }: { lines: StatementLine[] }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 10,
        background: "#ffffff",
      }}
    >
      <thead>
        <tr>
          {["الصنف", "المواصفات", "الكمية", "سعر الوحدة", "الإجمالي"].map(
            (label) => (
              <th
                key={label}
                style={{
                  textAlign: "right",
                  padding: "5px 6px",
                  background: "#dbeafe",
                  color: INK,
                  border: `1px solid ${LINE}`,
                  fontWeight: 800,
                }}
              >
                {label}
              </th>
            )
          )}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, idx) => (
          <tr key={`${line.name}-${idx}`}>
            <td style={tdStyle({ fontWeight: 700, background: NESTED_BG })}>
              {line.name}
            </td>
            <td style={tdStyle({ color: MUTED, background: NESTED_BG })}>
              {line.detail || "—"}
            </td>
            <td
              style={tdStyle({
                whiteSpace: "nowrap",
                background: NESTED_BG,
              })}
            >
              {line.qty || "—"}
            </td>
            <td
              style={tdStyle({
                whiteSpace: "nowrap",
                background: NESTED_BG,
              })}
            >
              {line.unitPrice != null ? formatCurrency(line.unitPrice) : "—"}
            </td>
            <td
              style={tdStyle({
                whiteSpace: "nowrap",
                fontWeight: 800,
                background: NESTED_BG,
              })}
            >
              {line.total != null ? formatCurrency(line.total) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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
  const debitLabel =
    statement.kind === "customer" ? "مدين (عليه)" : "مدين (مدفوع)";
  const creditLabel =
    statement.kind === "customer" ? "دائن (له)" : "دائن (علينا)";
  const movementCount = Math.max(0, statement.rows.length - 1);

  return (
    <div
      dir="rtl"
      style={{
        width: 794,
        padding: 26,
        background: "#ffffff",
        color: INK,
        fontFamily: FONT,
        boxSizing: "border-box",
        textAlign: "right",
        direction: "rtl",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          borderBottom: `3px solid ${HEAD}`,
          paddingBottom: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <div style={{ fontWeight: 900, fontSize: 22, lineHeight: 1.2 }}>
            {storeName}
          </div>
          {(settings?.phone || settings?.address) && (
            <div
              style={{
                fontSize: 11,
                color: MUTED,
                fontWeight: 600,
                marginTop: 4,
              }}
            >
              {[settings?.address, settings?.phone].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <PrintBrandMark
          className=""
          sizeClassName="h-14 w-14"
          logoUrl={settings?.logo_url}
        />
      </div>

      <div
        style={{
          fontWeight: 900,
          fontSize: 16,
          marginBottom: 10,
          color: HEAD,
        }}
      >
        {statement.title}
      </div>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
          marginBottom: 12,
        }}
      >
        <tbody>
          <tr>
            <th style={tdStyle({ background: ZEBRA, fontWeight: 800, width: "18%" })}>
              {statement.kind === "customer" ? "العميل" : "المورد"}
            </th>
            <td style={tdStyle({ fontWeight: 800 })}>{statement.party.name}</td>
            <th style={tdStyle({ background: ZEBRA, fontWeight: 800, width: "14%" })}>
              الهاتف
            </th>
            <td style={tdStyle({ direction: "ltr", unicodeBidi: "plaintext" })}>
              {statement.party.phone || "—"}
            </td>
          </tr>
          <tr>
            <th style={tdStyle({ background: ZEBRA, fontWeight: 800 })}>الفترة</th>
            <td style={tdStyle()}>{period}</td>
            <th style={tdStyle({ background: ZEBRA, fontWeight: 800 })}>
              تاريخ الإصدار
            </th>
            <td style={tdStyle()}>{formatDateShort(issuedAt)}</td>
          </tr>
          {statement.party.address || statement.linkedParty ? (
            <tr>
              <th style={tdStyle({ background: ZEBRA, fontWeight: 800 })}>
                العنوان
              </th>
              <td style={tdStyle()}>{statement.party.address || "—"}</td>
              <th style={tdStyle({ background: ZEBRA, fontWeight: 800 })}>
                حساب مربوط
              </th>
              <td style={tdStyle({ fontWeight: 700 })}>
                {statement.linkedParty?.name || "—"}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
          marginBottom: 14,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle()}>رصيد سابق</th>
            <th style={thStyle()}>{debitLabel}</th>
            <th style={thStyle()}>{creditLabel}</th>
            <th style={thStyle()}>الرصيد الختامي</th>
            <th style={thStyle()}>عدد الحركات</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={tdStyle({ fontWeight: 800, fontSize: 13 })}>
              {formatCurrency(statement.openingBalance)}
            </td>
            <td
              style={tdStyle({
                fontWeight: 800,
                fontSize: 13,
                color: DEBIT,
              })}
            >
              {formatCurrency(statement.periodDebit)}
            </td>
            <td
              style={tdStyle({
                fontWeight: 800,
                fontSize: 13,
                color: CREDIT,
              })}
            >
              {formatCurrency(statement.periodCredit)}
            </td>
            <td
              style={tdStyle({
                fontWeight: 900,
                fontSize: 13,
                background: OPENING_BG,
              })}
            >
              {formatCurrency(statement.closingBalance)}
            </td>
            <td style={tdStyle({ fontWeight: 800, fontSize: 13 })}>
              {movementCount}
            </td>
          </tr>
        </tbody>
      </table>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle({ width: "6%" })}>#</th>
            <th style={thStyle({ width: "13%" })}>التاريخ</th>
            <th style={thStyle({ width: "16%" })}>النوع</th>
            <th style={thStyle()}>المستند</th>
            <th style={thStyle({ width: "15%" })}>مدين</th>
            <th style={thStyle({ width: "15%" })}>دائن</th>
            <th style={thStyle({ width: "16%" })}>رصيد</th>
          </tr>
        </thead>
        <tbody>
          {statement.rows.map((row, index) => {
            const zebra = index % 2 === 1 ? ZEBRA : "#ffffff";
            const bg = row.type === "opening" ? OPENING_BG : zebra;
            return (
              <Fragment key={row.id}>
                <tr>
                  <td style={tdStyle({ background: bg, color: MUTED })}>
                    {index + 1}
                  </td>
                  <td
                    style={tdStyle({
                      background: bg,
                      whiteSpace: "nowrap",
                    })}
                  >
                    {row.type === "opening"
                      ? "—"
                      : formatDateShort(row.occurredAt)}
                  </td>
                  <td style={tdStyle({ background: bg, fontWeight: 800 })}>
                    {row.label}
                  </td>
                  <td style={tdStyle({ background: bg })}>
                    <div>{row.reference}</div>
                    {row.notes ? (
                      <div
                        style={{
                          fontSize: 10,
                          color: MUTED,
                          marginTop: 2,
                          fontWeight: 600,
                        }}
                      >
                        {row.notes}
                      </div>
                    ) : null}
                  </td>
                  <td
                    style={tdStyle({
                      background: bg,
                      whiteSpace: "nowrap",
                      color: row.debit ? DEBIT : MUTED,
                      fontWeight: 800,
                    })}
                  >
                    {moneyCell(row.debit)}
                  </td>
                  <td
                    style={tdStyle({
                      background: bg,
                      whiteSpace: "nowrap",
                      color: row.credit ? CREDIT : MUTED,
                      fontWeight: 800,
                    })}
                  >
                    {moneyCell(row.credit)}
                  </td>
                  <td
                    style={tdStyle({
                      background: bg,
                      whiteSpace: "nowrap",
                      fontWeight: 900,
                    })}
                  >
                    {formatCurrency(row.runningBalance)}
                  </td>
                </tr>
                {showLines && row.lines.length > 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        padding: 8,
                        background: NESTED_BG,
                        border: `1px solid ${LINE}`,
                      }}
                    >
                      <LinesTable lines={row.lines} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          <tr>
            <td
              colSpan={4}
              style={tdStyle({
                background: HEAD,
                color: "#ffffff",
                fontWeight: 900,
              })}
            >
              الإجمالي
            </td>
            <td
              style={tdStyle({
                background: HEAD,
                color: "#ffffff",
                fontWeight: 900,
                whiteSpace: "nowrap",
              })}
            >
              {formatCurrency(statement.periodDebit)}
            </td>
            <td
              style={tdStyle({
                background: HEAD,
                color: "#ffffff",
                fontWeight: 900,
                whiteSpace: "nowrap",
              })}
            >
              {formatCurrency(statement.periodCredit)}
            </td>
            <td
              style={tdStyle({
                background: HEAD,
                color: "#ffffff",
                fontWeight: 900,
                whiteSpace: "nowrap",
              })}
            >
              {formatCurrency(statement.closingBalance)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

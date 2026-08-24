"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Download,
  Package,
  ReceiptText,
  RefreshCw,
  Users,
  Wallet,
  CircleDollarSign,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { isBrowserOnline, withTimeout } from "@/lib/offline";
import {
  fetchReportsBundle,
  formatRangeLabel,
  isDateRangeInvalid,
  rangeFromPreset,
  type DatePreset,
  type ReportSection,
  type ReportsBundle,
} from "@/lib/reports";
import { exportReportSection } from "@/lib/excel/reports";
import { DateField } from "@/components/ui/DateField";
import { TodayDateChip } from "@/components/ui/TodayDateChip";
import { useToast } from "@/components/ui/Toast";
import { PrintListButton } from "@/components/print/PrintListButton";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import {
  customerProfitColumns,
  expenseColumns,
  invoiceProfitColumns,
  productProfitColumns,
  treasuryColumns,
  type ReportColumn,
} from "@/components/print/report-columns";
import { ReportSummaryCards } from "@/components/reports/ReportSummaryCards";
import { ReportCharts } from "@/components/reports/ReportCharts";
import {
  CustomersReportTable,
  ExpensesReportTable,
  InvoicesReportTable,
  ProductsReportTable,
  TreasuryReportTable,
  sectionTableData,
} from "@/components/reports/ReportTables";
import type { Settings } from "@/types";

const SECTIONS: Array<{
  key: ReportSection;
  name: string;
  icon: typeof BarChart3;
}> = [
  { key: "overview", name: "نظرة عامة", icon: BarChart3 },
  { key: "invoices", name: "الفواتير والأرباح", icon: ReceiptText },
  { key: "customers", name: "أرباح العملاء", icon: Users },
  { key: "products", name: "الأصناف والمخزون", icon: Package },
  { key: "treasury", name: "الخزينة", icon: Wallet },
  { key: "expenses", name: "المصروفات", icon: CircleDollarSign },
];

const PRESETS: Array<{ key: DatePreset; label: string }> = [
  { key: "today", label: "اليوم" },
  { key: "7days", label: "7 أيام" },
  { key: "month", label: "هذا الشهر" },
  { key: "custom", label: "فترة مخصصة" },
];

export default function ReportsPage() {
  const [section, setSection] = useState<ReportSection>("overview");
  const [preset, setPreset] = useState<DatePreset>("7days");
  const initial = rangeFromPreset("7days");
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);
  const [bundle, setBundle] = useState<ReportsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const supabase = createClient();
  const { info: toastInfo } = useToast();

  const activeRange = useMemo(
    () =>
      rangeFromPreset(preset, {
        from: dateFrom,
        to: dateTo,
      }),
    [preset, dateFrom, dateTo]
  );

  const load = useCallback(async () => {
    if (isDateRangeInvalid(activeRange)) {
      toastInfo("تاريخ البداية بعد تاريخ النهاية — صحّح الفترة ثم أعد المحاولة");
      return;
    }
    if (!isBrowserOnline()) {
      setError("التقارير التفصيلية تحتاج اتصال بالإنترنت");
      setBundle(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await withTimeout(fetchReportsBundle(activeRange), 8000);
      setBundle(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "تعذر تحميل التقارير";
      setError(
        message === "timeout"
          ? "انتهت مهلة تحميل التقارير — حاول مرة أخرى"
          : message
      );
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, [activeRange, toastInfo]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    supabase
      .from("settings")
      .select("*")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSettings(data as Settings);
      });
  }, [supabase]);

  function applyPreset(next: DatePreset) {
    setPreset(next);
    if (next !== "custom") {
      const range = rangeFromPreset(next);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  }

  const printMeta = useMemo(() => {
    if (!bundle) {
      return {
        title: "تقرير",
        rows: [] as Record<string, unknown>[],
        columns: [] as ReportColumn[],
        summary: [] as { label: string; value: string }[],
      };
    }

    const subtitle = formatRangeLabel(bundle.range);
    const baseSummary = [
      { label: "الفترة", value: subtitle },
      {
        label: "صافي المبيعات",
        value: formatCurrency(bundle.overview.net_sales),
      },
      {
        label: "الربح",
        value: formatCurrency(bundle.overview.gross_profit),
      },
    ];

    switch (section) {
      case "invoices":
        return {
          title: "تقرير الفواتير والأرباح",
          rows: bundle.invoices,
          columns: invoiceProfitColumns,
          summary: [
            ...baseSummary,
            {
              label: "عدد الفواتير",
              value: String(bundle.overview.invoice_count),
            },
          ],
        };
      case "customers":
        return {
          title: "تقرير أرباح العملاء",
          rows: bundle.customers,
          columns: customerProfitColumns,
          summary: baseSummary,
        };
      case "products":
        return {
          title: "تقرير الأصناف والمخزون",
          rows: bundle.products,
          columns: productProfitColumns,
          summary: [
            ...baseSummary,
            {
              label: "المخزون بالتكلفة",
              value: formatCurrency(bundle.overview.inventory_value),
            },
            {
              label: "المخزون بسعر البيع",
              value: formatCurrency(bundle.overview.inventory_value_sell),
            },
          ],
        };
      case "treasury":
        return {
          title: "تقرير الخزينة",
          rows: bundle.treasury,
          columns: treasuryColumns,
          summary: [
            { label: "الفترة", value: subtitle },
            {
              label: "صافي الخزينة",
              value: formatCurrency(bundle.overview.treasury_net),
            },
            {
              label: "الإيداعات",
              value: formatCurrency(bundle.overview.treasury_deposits),
            },
            {
              label: "السحوبات",
              value: formatCurrency(bundle.overview.treasury_withdrawals),
            },
          ],
        };
      case "expenses":
        return {
          title: "تقرير المصروفات",
          rows: bundle.expenses.map((e) => ({ ...e, id: e.entry_id })),
          columns: expenseColumns,
          summary: [
            { label: "الفترة", value: subtitle },
            {
              label: "إجمالي المصروفات",
              value: formatCurrency(bundle.overview.expenses_total),
            },
            {
              label: "عدد القيود",
              value: String(bundle.overview.expenses_count),
            },
          ],
        };
      default:
        return {
          title: "ملخص التقارير",
          rows: sectionTableData("overview", bundle) ?? [],
          columns: [
            {
              key: "label",
              label: "المؤشر",
              getValue: (r) => String(r.label ?? ""),
            },
            {
              key: "value",
              label: "القيمة",
              getValue: (r) => {
                const v = Number(r.value ?? 0);
                if (String(r.label).includes("%")) return `${v.toFixed(1)}%`;
                return formatCurrency(v);
              },
            },
          ] as ReportColumn[],
          summary: baseSummary,
        };
    }
  }, [bundle, section]);

  function handleExport() {
    if (!bundle) return;
    const rows = sectionTableData(section, bundle) ?? [];
    exportReportSection(section, rows);
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold text-[#1473e6]">التحليلات</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#172033]">
            التقارير والربحية
          </h1>
          <p className="mt-1 text-xs text-[#7d8797]">
            ملخص المبيعات والأرباح والعملاء والمخزون والخزينة بدون تكرار تشغيلي.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7ebf1] bg-white px-3 py-2 text-sm font-medium text-[#687386] hover:bg-[#f8faff] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={loading || !bundle}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7ebf1] bg-white px-3 py-2 text-sm font-medium text-[#687386] hover:bg-[#f8faff] disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            تصدير Excel
          </button>
          <PrintListButton
            onClick={() => setShowPrint(true)}
            disabled={loading || !bundle}
          />
          <Link
            href="/sales"
            className="text-sm font-semibold text-[#1473e6] hover:text-[#0b65d1]"
          >
            إدارة الفواتير ←
          </Link>
        </div>
      </section>

      <div className="surface-card flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                preset === p.key
                  ? "bg-[#1473e6] text-white"
                  : "border border-[#e7ebf1] bg-white text-[#687386] hover:bg-[#f8faff]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-[#7d8797]">من</label>
          <DateField
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v);
              setPreset("custom");
            }}
            className="w-auto min-w-[150px]"
            inputClassName="border-[#e7ebf1]"
          />
          <label className="text-xs text-[#7d8797]">إلى</label>
          <DateField
            value={dateTo}
            onChange={(v) => {
              setDateTo(v);
              setPreset("custom");
            }}
            className="w-auto min-w-[150px]"
            inputClassName="border-[#e7ebf1]"
          />
          <TodayDateChip
            dateFrom={dateFrom}
            dateTo={dateTo}
            onApply={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
              setPreset("today");
            }}
          />
          <button
            type="button"
            onClick={load}
            className="rounded-lg bg-[#1473e6] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b65d1]"
          >
            تطبيق
          </button>
          <span className="text-[11px] text-[#98a2b3]">
            الفترة: {formatRangeLabel(activeRange)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setSection(s.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-[#1473e6] text-white shadow-[0_6px_16px_rgba(20,115,230,0.2)]"
                  : "border border-[#e7ebf1] bg-white text-[#687386] hover:bg-[#f8faff]"
              }`}
            >
              <Icon className="h-4 w-4" />
              {s.name}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#dcecff] border-t-[#1473e6]" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-700">
          <p className="font-semibold">تعذر تحميل التقارير</p>
          <p className="mt-1 text-xs">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {!loading && !error && bundle && (
        <>
          {section === "overview" && (
            <div className="space-y-5">
              <ReportSummaryCards overview={bundle.overview} />
              <ReportCharts
                dailyTrend={bundle.dailyTrend}
                paymentMix={bundle.paymentMix}
                topCustomers={bundle.topCustomers}
                topProducts={bundle.topProducts}
              />
            </div>
          )}

          {section !== "overview" && (
            <div className="surface-card overflow-hidden p-4 sm:p-5">
              {section === "invoices" && (
                <InvoicesReportTable rows={bundle.invoices} onMutated={load} />
              )}
              {section === "customers" && (
                <CustomersReportTable rows={bundle.customers} onMutated={load} />
              )}
              {section === "products" && (
                <ProductsReportTable rows={bundle.products} onMutated={load} />
              )}
              {section === "treasury" && (
                <TreasuryReportTable rows={bundle.treasury} onMutated={load} />
              )}
              {section === "expenses" && (
                <ExpensesReportTable rows={bundle.expenses} onMutated={load} />
              )}
            </div>
          )}
        </>
      )}

      {showPrint && bundle && (
        <PrintReportPreview
          title={printMeta.title}
          rows={printMeta.rows as Array<{ id?: string }>}
          columns={printMeta.columns}
          settings={settings}
          summary={printMeta.summary}
          subtitle={`الفترة: ${formatRangeLabel(bundle.range)}${
            bundle.overview.has_estimated_costs
              ? " · يتضمن تكاليف تقديرية لبعض الفواتير القديمة"
              : ""
          }`}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

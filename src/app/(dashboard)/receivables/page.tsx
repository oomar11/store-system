"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateShort, smartSearchMatch } from "@/lib/utils";
import { BusinessLineBadges } from "@/components/parties/BusinessLineBadges";
import {
  listProjectReceivables,
  type ProjectReceivableRow,
  type ProjectReceivableSource,
  type ProjectReceivablesTotals,
} from "@/lib/project-receivables";
import { useAuth } from "@/hooks/useAuth";

type SourceFilter = "all" | ProjectReceivableSource;

export default function ReceivablesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { canViewReports, canWriteCustomers } = useAuth();
  const canView = canViewReports || canWriteCustomers;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ProjectReceivableRow[]>([]);
  const [totals, setTotals] = useState<ProjectReceivablesTotals>({
    sale: 0,
    paid: 0,
    remaining: 0,
    owedCount: 0,
  });
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");
  const [onlyOwed, setOnlyOwed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listProjectReceivables(supabase, {
        onlyOwed,
        source: sourceFilter,
      });
      setRows(result.rows);
      setTotals(result.totals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الفلوس برا");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [onlyOwed, sourceFilter, supabase]);

  useEffect(() => {
    if (!canView) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [canView, load]);

  const filtered = rows.filter((r) =>
    smartSearchMatch(search, [r.customerName, r.customerPhone, r.projectLabel])
  );

  if (!canView) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900">
        مفيش صلاحية لعرض فلوس لِيا برا
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">فلوس لِيا برا</h1>
          <p className="mt-1 text-sm text-gray-500">
            كل مشروع/فاتورة عليها متبقي — وعند مين
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          تحديث
        </button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="متبقي إجمالي" value={formatCurrency(totals.remaining)} tone="danger" />
        <SummaryCard label="مبيعات" value={formatCurrency(totals.sale)} />
        <SummaryCard label="محصّل" value={formatCurrency(totals.paid)} tone="ok" />
        <SummaryCard label="شغل عليه فلوس" value={String(totals.owedCount)} />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالعميل أو المشروع..."
          className="max-w-md flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
        >
          <option value="all">كل المصادر</option>
          <option value="wire">سلك</option>
          <option value="workshop">ورشة</option>
          <option value="store">محل</option>
        </select>
        <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={onlyOwed}
            onChange={(e) => setOnlyOwed(e.target.checked)}
          />
          عليه فلوس فقط
        </label>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            مفيش فلوس برا مطابقة للفلتر
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">المصدر</th>
                  <th className="px-4 py-3 text-right font-medium">المشروع</th>
                  <th className="px-4 py-3 text-right font-medium">عند مين</th>
                  <th className="px-4 py-3 text-right font-medium">البيع</th>
                  <th className="px-4 py-3 text-right font-medium">المدفوع</th>
                  <th className="px-4 py-3 text-right font-medium">المتبقي</th>
                  <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <BusinessLineBadges lines={[row.source]} />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {row.projectLabel}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${row.customerId}`}
                        className="font-medium text-[#1473e6] hover:underline"
                      >
                        {row.customerName}
                      </Link>
                      {row.customerPhone ? (
                        <div className="text-xs text-gray-500" dir="ltr">
                          {row.customerPhone}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{formatCurrency(row.sale)}</td>
                    <td className="px-4 py-3">{formatCurrency(row.paid)}</td>
                    <td className="px-4 py-3 font-bold text-red-600">
                      {formatCurrency(row.remaining)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.occurredAt ? formatDateShort(row.occurredAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "ok";
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p
        className={`mt-1 text-lg font-bold ${
          tone === "danger"
            ? "text-red-600"
            : tone === "ok"
              ? "text-emerald-700"
              : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

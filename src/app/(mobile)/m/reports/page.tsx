"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchReportsBundle,
  formatRangeLabel,
  rangeFromPreset,
  type DatePreset,
  type ReportsBundle,
} from "@/lib/reports";
import { formatCurrency } from "@/lib/utils";
import { isBrowserOnline } from "@/lib/offline";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileChip,
  MobileEmpty,
  MobileListRow,
  MobileSection,
  MobileSkeleton,
  MobileStatCard,
} from "@/components/mobile/MobileUI";

type Section = "overview" | "invoices" | "customers" | "products" | "treasury" | "expenses";

export default function MobileReportsPage() {
  const [preset, setPreset] = useState<DatePreset>("today");
  const [section, setSection] = useState<Section>("overview");
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<ReportsBundle | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!isBrowserOnline()) {
        setError("التقارير التفصيلية تحتاج اتصال بالإنترنت");
        setBundle(null);
        return;
      }
      const range = rangeFromPreset(preset);
      const data = await fetchReportsBundle(range);
      setBundle(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل التقارير");
      setBundle(null);
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    void load();
  }, [load]);

  const ov = bundle?.overview;

  return (
    <>
      <MobileHeader
        title="التقارير"
        subtitle={bundle ? formatRangeLabel(bundle.range) : "ملخص الفترة"}
        onRefresh={load}
        refreshing={loading}
      />
      <div className="mobile-page">
        <div className="mobile-chip-row">
          {(
            [
              ["today", "اليوم"],
              ["7days", "7 أيام"],
              ["month", "هذا الشهر"],
            ] as const
          ).map(([id, label]) => (
            <MobileChip
              key={id}
              active={preset === id}
              onClick={() => setPreset(id)}
            >
              {label}
            </MobileChip>
          ))}
        </div>

        <div className="mobile-chip-row">
          {(
            [
              ["overview", "نظرة"],
              ["invoices", "فواتير"],
              ["customers", "عملاء"],
              ["products", "أصناف"],
              ["treasury", "خزنة"],
              ["expenses", "مصروف"],
            ] as const
          ).map(([id, label]) => (
            <MobileChip
              key={id}
              active={section === id}
              onClick={() => setSection(id)}
            >
              {label}
            </MobileChip>
          ))}
        </div>

        {error ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
        ) : null}

        {loading || !bundle || !ov ? (
          <MobileSkeleton rows={6} />
        ) : section === "overview" ? (
          <>
            <div className="mobile-stats">
              <MobileStatCard
                tone="blue"
                label="صافي المبيعات"
                value={formatCurrency(ov.net_sales)}
                meta={`${ov.invoice_count} فاتورة`}
              />
              <MobileStatCard
                tone="green"
                label="مجمل الربح"
                value={formatCurrency(ov.gross_profit)}
                meta={`هامش ${ov.margin.toFixed(1)}%`}
              />
              <MobileStatCard
                tone="slate"
                label="محصّل"
                value={formatCurrency(ov.collected)}
                meta={`متبقي ${formatCurrency(ov.remaining)}`}
              />
              <MobileStatCard
                tone="orange"
                label="المصروفات"
                value={formatCurrency(ov.expenses_total)}
                meta={`${ov.expenses_count} قيد`}
              />
            </div>
            <MobileSection title="ملخص إضافي">
              <div className="mobile-panel">
                <MobileListRow
                  title="صافي الخزنة"
                  amount={ov.treasury_net}
                  amountTone={ov.treasury_net >= 0 ? "positive" : "negative"}
                />
                <MobileListRow
                  title="قيمة المخزون"
                  amount={ov.inventory_value}
                />
                <MobileListRow
                  title="ديون العملاء"
                  amount={ov.customer_debt}
                  amountTone="negative"
                />
                <MobileListRow
                  title="نواقص"
                  subtitle={`${ov.low_stock_count} صنف`}
                />
              </div>
            </MobileSection>
          </>
        ) : section === "invoices" ? (
          <div className="mobile-panel">
            {bundle.invoices.length === 0 ? (
              <MobileEmpty message="لا فواتير في الفترة" />
            ) : (
              bundle.invoices.slice(0, 40).map((inv) => (
                <MobileListRow
                  key={inv.id}
                  title={inv.invoice_number}
                  subtitle={`${inv.customer_name || "—"} · ربح ${formatCurrency(inv.profit)}`}
                  amount={inv.revenue}
                />
              ))
            )}
          </div>
        ) : section === "customers" ? (
          <div className="mobile-panel">
            {bundle.topCustomers.length === 0 ? (
              <MobileEmpty message="لا بيانات عملاء" />
            ) : (
              bundle.topCustomers.map((c) => (
                <MobileListRow
                  key={c.id}
                  title={c.name}
                  subtitle={`${c.invoice_count} فاتورة · ربح ${formatCurrency(c.profit)}`}
                  amount={c.revenue}
                />
              ))
            )}
          </div>
        ) : section === "products" ? (
          <div className="mobile-panel">
            {bundle.topProducts.length === 0 ? (
              <MobileEmpty message="لا بيانات أصناف" />
            ) : (
              bundle.topProducts.map((p) => (
                <MobileListRow
                  key={p.id}
                  title={p.name}
                  subtitle={`كمية ${p.qty_sold} · ربح ${formatCurrency(p.profit)}`}
                  amount={p.revenue}
                />
              ))
            )}
          </div>
        ) : section === "treasury" ? (
          <div className="mobile-panel">
            {bundle.treasury.length === 0 ? (
              <MobileEmpty message="لا حركات خزنة" />
            ) : (
              bundle.treasury.slice(0, 40).map((t) => (
                <MobileListRow
                  key={t.id}
                  title={t.description || t.type}
                  subtitle={t.safe?.name || "خزنة"}
                  amount={Number(t.amount)}
                  amountTone={
                    t.type === "deposit" ? "positive" : "negative"
                  }
                />
              ))
            )}
          </div>
        ) : (
          <div className="mobile-panel">
            {bundle.expenses.length === 0 ? (
              <MobileEmpty message="لا مصروفات" />
            ) : (
              bundle.expenses.slice(0, 40).map((e) => (
                <MobileListRow
                  key={e.entry_id || e.safe_transaction_id}
                  title={e.expense_account_name || "مصروف"}
                  subtitle={e.description || e.safe_name}
                  amount={e.amount}
                  amountTone="negative"
                />
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

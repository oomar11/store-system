"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import {
  fetchShiftActivity,
  fetchShiftById,
  SHIFT_VARIANCE_CLASS_LABELS,
  type ShiftActivity,
  type ShiftRow,
} from "@/lib/shifts";
import { formatCurrency, formatDateRelative, formatDateShort } from "@/lib/utils";
import { MobileBackLink } from "@/components/mobile/MobileDetail";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileEmpty,
  MobileListRow,
  MobileSkeleton,
} from "@/components/mobile/MobileUI";

export default function MobileShiftDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [activity, setActivity] = useState<ShiftActivity | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const row = await fetchShiftById(supabase, id);
      if (!row) throw new Error("الوردية غير موجودة");
      setShift(row);
      const act = await fetchShiftActivity(supabase, {
        safeId: row.safe_id,
        openedAt: row.opened_at,
        openingCash: Number(row.opening_cash) || 0,
        closedAt: row.closed_at,
      });
      setActivity(act);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الوردية");
      setShift(null);
      setActivity(null);
    } finally {
      setLoading(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const variance = shift ? Number(shift.variance) || 0 : 0;

  return (
    <>
      <MobileHeader
        title="تفاصيل الوردية"
        subtitle={
          shift?.closed_at
            ? formatDateRelative(shift.closed_at)
            : shift?.opened_at
              ? formatDateRelative(shift.opened_at)
              : "جاري التحميل"
        }
        onRefresh={load}
        refreshing={loading}
      />
      <div className="mobile-page">
        <MobileBackLink href="/m/more/shifts" label="الورديات" />

        {error ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
        ) : null}

        {loading || !shift ? (
          <MobileSkeleton rows={6} />
        ) : (
          <>
            <div className="mobile-money-hero mb-3">
              <p className="mobile-money-hero__label">الفرق</p>
              <p className="mobile-money-hero__amount">
                {formatCurrency(variance)}
              </p>
              <p className="mobile-money-hero__meta">
                متوقع {formatCurrency(Number(shift.expected_cash) || 0)}
                {" · "}
                معدود {formatCurrency(Number(shift.counted_cash) || 0)}
              </p>
              {shift.variance_class ? (
                <p className="mobile-money-hero__note">
                  {SHIFT_VARIANCE_CLASS_LABELS[shift.variance_class] ||
                    shift.variance_class}
                </p>
              ) : null}
            </div>

            <div className="mobile-panel mb-3">
              <MobileListRow
                title="الفتح"
                subtitle={formatDateShort(shift.opened_at)}
                amount={formatCurrency(Number(shift.opening_cash) || 0)}
              />
              <MobileListRow
                title="الإقفال"
                subtitle={
                  shift.closed_at ? formatDateShort(shift.closed_at) : "مفتوحة"
                }
              />
            </div>

            <div className="mobile-panel">
              {(activity?.invoices?.length || 0) === 0 ? (
                <MobileEmpty message="لا فواتير في هذه الوردية" />
              ) : (
                activity!.invoices!.slice(0, 40).map((inv) => (
                  <MobileListRow
                    key={inv.id}
                    title={inv.invoice_number}
                    subtitle={formatDateRelative(inv.created_at)}
                    amount={Number(inv.total)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

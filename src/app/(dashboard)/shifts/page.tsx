"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clock3, Loader2, Lock, Unlock, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { RowAction } from "@/components/ui/TableRowActions";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { formatCurrency, formatDateRelative, formatDateShort } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import {
  isDrawerSafe,
  pickDrawerSafe,
  useOpenShift,
} from "@/hooks/useOpenShift";
import {
  attachOpenersToShifts,
  classifyShiftVariance,
  computeShiftTotals,
  acknowledgeShiftAbandonedNotification,
  isAbandonedCloseReason,
  needsLateCount,
  needsVarianceClassification,
  SHIFT_VARIANCE_CLASS_LABELS,
  type ShiftRow,
  type ShiftTotals,
} from "@/lib/shifts";
import {
  ShiftVarianceClassifyModal,
  suggestedVarianceClass,
  type ClassifyFormState,
} from "@/components/shifts/ShiftVarianceClassifyModal";
import { safesOrderQuery } from "@/lib/safes-order";
import { getSnapshot, isBrowserOnline, withTimeout } from "@/lib/offline";
import type { Safe } from "@/types";

type ShiftsPageProps = {
  /** When true (phone), hide open-shift forms; close/history may remain. */
  blockOpenShift?: boolean;
};

export default function ShiftsPage({
  blockOpenShift = false,
}: ShiftsPageProps = {}) {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const inMobileShell = pathname.startsWith("/m");
  const { profile, isEmployee, can } = useAuth();
  const { openShift, refreshShift, loading: shiftLoading, hasActiveShift } =
    useOpenShift();
  const { success, error: toastError } = useToast();
  const { openMenu, menu: contextMenu } = useRowContextMenu();
  const canSeeHistory =
    (!isEmployee && (can("treasury") || can("reports"))) ||
    (inMobileShell && can("shifts"));
  const canClassify = !isEmployee && can("treasury");
  const shiftDetailBase = inMobileShell ? "/m/more/shifts" : "/shifts";
  const [needShift, setNeedShift] = useState(false);

  useEffect(() => {
    try {
      setNeedShift(
        new URLSearchParams(window.location.search).get("needShift") === "1"
      );
    } catch {
      setNeedShift(false);
    }
  }, []);

  const [busy, setBusy] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(true);
  const [history, setHistory] = useState<ShiftRow[]>([]);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [totals, setTotals] = useState<ShiftTotals | null>(null);

  const [openForm, setOpenForm] = useState({
    safe_id: "",
    opening_cash: "",
    confirmed: false,
  });
  const [closeForm, setCloseForm] = useState({
    counted_cash: "",
    notes: "",
  });
  const [drawerSafeId, setDrawerSafeId] = useState<string | null>(null);
  const [classifyShift, setClassifyShift] = useState<ShiftRow | null>(null);
  const [classifyForm, setClassifyForm] = useState<ClassifyFormState>({
    class: "",
    reason: "",
    relatedSafeId: "",
  });

  const pendingQueue = useMemo(() => {
    return history.filter(
      (s) => needsLateCount(s) || needsVarianceClassification(s)
    );
  }, [history]);

  const refreshExtras = useCallback(async () => {
    setLoadingExtras(true);
    try {
      if (!isBrowserOnline()) {
        const snap = await getSnapshot();
        if (snap?.safes?.length) {
          setSafes(snap.safes.filter((s) => s.is_active) as Safe[]);
        }
        if (snap?.settings) {
          const preferredDrawer =
            (snap.settings as { drawer_safe_id?: string | null }).drawer_safe_id ||
            null;
          setDrawerSafeId(preferredDrawer);
        }
        setHistory([]);
        setTotals(null);
        return;
      }

      const [{ data: safesData }, { data: settingsRow }] = await withTimeout(
        Promise.all([
          safesOrderQuery(
            supabase.from("safes").select("*").eq("is_active", true)
          ),
          supabase
            .from("settings")
            .select("drawer_safe_id")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        ]),
        4000
      );

      const preferredDrawer = settingsRow?.drawer_safe_id || null;
      setDrawerSafeId(preferredDrawer);
      setSafes((safesData as Safe[]) || []);

      if (preferredDrawer) {
        setOpenForm((f) => {
          if (isEmployee || !f.safe_id) {
            return { ...f, safe_id: preferredDrawer };
          }
          return f;
        });
      } else if (!openForm.safe_id && safesData?.length) {
        const drawer = pickDrawerSafe(safesData as Safe[], preferredDrawer);
        if (drawer) {
          setOpenForm((f) => ({
            ...f,
            safe_id: drawer.id,
            opening_cash: "",
            confirmed: false,
          }));
        }
      }

      if (openShift) {
        const t = await withTimeout(
          computeShiftTotals(supabase, {
            safeId: openShift.safe_id,
            openedAt: openShift.opened_at,
            openingCash: Number(openShift.opening_cash) || 0,
          }),
          4000
        );
        setTotals(t);
      } else {
        setTotals(null);
      }

      if (canSeeHistory) {
        let histQuery = supabase
          .from("shifts")
          .select("*, safe:safes!shifts_safe_id_fkey(id, name, balance)")
          .eq("status", "closed")
          .order("closed_at", { ascending: false })
          .limit(50);
        if (isEmployee && profile?.id) {
          histQuery = histQuery.eq("opened_by", profile.id);
        }
        const { data: hist } = await withTimeout(
          Promise.resolve(histQuery) as Promise<{ data: ShiftRow[] | null }>,
          4000
        );
        const withPeople = await withTimeout(
          attachOpenersToShifts(supabase, (hist as ShiftRow[]) || []),
          3000
        );
        setHistory(withPeople);
      } else {
        setHistory([]);
      }
    } catch (e) {
      if (e instanceof Error && e.name !== "TimeoutError") {
        toastError(e.message || "تعذر تحميل الورديات");
      }
      const snap = await getSnapshot();
      if (snap?.safes?.length) {
        setSafes(snap.safes.filter((s) => s.is_active) as Safe[]);
      }
    } finally {
      setLoadingExtras(false);
    }
  }, [
    supabase,
    openShift,
    openForm.safe_id,
    canSeeHistory,
    toastError,
    isEmployee,
    profile?.id,
  ]);

  useEffect(() => {
    if (shiftLoading) return;
    void refreshExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftLoading, openShift?.id, canSeeHistory]);

  async function handleOpenShift(e: React.FormEvent) {
    if (blockOpenShift) {
      e.preventDefault();
      toastError("افتح الوردية من التابلت أو سطح المكتب");
      return;
    }
    e.preventDefault();

    const safeId = isEmployee
      ? drawerSafeId || ""
      : openForm.safe_id || drawerSafeId || "";

    if (!safeId) {
      toastError(
        isEmployee
          ? "درج الكاشير مش مضبوط — بلّغ المدير يحدده من الإعدادات"
          : "حدّد درج الكاشير من الإعدادات أولاً"
      );
      return;
    }
    if (openForm.opening_cash === "" || Number.isNaN(Number(openForm.opening_cash))) {
      toastError("أدخل مبلغ النقدية بعد العد");
      return;
    }
    if (!openForm.confirmed) {
      toastError("لازم تؤكد إنك عدّيت فلوس الدرج بنفسك");
      return;
    }

    const drawer = safes.find((s) => s.id === safeId);
    const balance = Number(drawer?.balance) || 0;

    setBusy(true);
    try {
      const opening = Number(openForm.opening_cash) || 0;
      const { error } = await supabase.from("shifts").insert({
        status: "open",
        safe_id: safeId,
        opened_by: profile?.id || null,
        opening_cash: opening,
        notes: `استلام درج — نظام: ${balance} | معدود: ${opening}`,
      });
      if (error) {
        if (/unique|duplicate|idx_shifts_one_open/i.test(error.message)) {
          await refreshShift();
          throw new Error(
            "فيه وردية مفتوحة بالفعل — تم تحديث الصفحة، اقفل الوردية الحالية"
          );
        }
        throw new Error(error.message);
      }
      success("تم استلام الدرج وبدء الوردية");
      setOpenForm((f) => ({
        ...f,
        safe_id: safeId,
        confirmed: false,
        opening_cash: "",
      }));
      await refreshShift();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر فتح الوردية");
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseShift(e: React.FormEvent) {
    e.preventDefault();
    if (!openShift || !totals) return;
    const counted = Number(closeForm.counted_cash);
    if (Number.isNaN(counted)) {
      toastError("أدخل النقدية المعدودة في الدرج عند التسليم");
      return;
    }

    setBusy(true);
    try {
      const variance = counted - totals.expectedCash;
      const { error } = await supabase
        .from("shifts")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closed_by: profile?.id || null,
          expected_cash: totals.expectedCash,
          counted_cash: counted,
          variance,
          sales_total: totals.salesTotal,
          purchases_total: totals.purchasesTotal,
          cash_in: totals.cashIn,
          cash_out: totals.cashOut,
          notes: closeForm.notes.trim() || openShift.notes,
          close_reason: "normal",
          abandon_requested_at: null,
        })
        .eq("id", openShift.id)
        .eq("status", "open");

      if (error) throw new Error(error.message);
      const closedId = openShift.id;
      success(
        variance === 0
          ? "تم تسليم الدرج بدون فرق"
          : `تم التسليم — فرق الدرج ${formatCurrency(variance)}${
              canClassify
                ? " — صنّف الفرق عشان يتسجل في الخزنة"
                : ""
            }`
      );
      setCloseForm({ counted_cash: "", notes: "" });
      await refreshShift();
      await refreshExtras();
      if (canClassify && variance !== 0) {
        const { data: closed } = await supabase
          .from("shifts")
          .select("*, safe:safes!shifts_safe_id_fkey(id, name, balance)")
          .eq("id", closedId)
          .maybeSingle();
        if (closed) openClassify(closed as ShiftRow);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر إقفال الوردية");
    } finally {
      setBusy(false);
    }
  }

  async function handleClassifyVariance(e: React.FormEvent) {
    e.preventDefault();
    if (!classifyShift || !classifyForm.class) {
      toastError("اختَر نوع الفرق");
      return;
    }
    setBusy(true);
    try {
      await classifyShiftVariance(supabase, {
        shift: classifyShift,
        class: classifyForm.class,
        reason: classifyForm.reason,
        relatedSafeId: classifyForm.relatedSafeId || null,
        classifiedBy: profile?.id || null,
      });
      if (isAbandonedCloseReason(classifyShift.close_reason)) {
        await acknowledgeShiftAbandonedNotification(
          supabase,
          classifyShift.id
        );
      }
      success("تم تسجيل سبب فرق الدرج في الخزنة");
      setClassifyShift(null);
      setClassifyForm({ class: "", reason: "", relatedSafeId: "" });
      await refreshExtras();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذر تصنيف الفرق");
    } finally {
      setBusy(false);
    }
  }

  function openClassify(shift: ShiftRow) {
    setClassifyShift(shift);
    setClassifyForm({
      class: suggestedVarianceClass(Number(shift.variance) || 0),
      reason: "",
      relatedSafeId: "",
    });
  }

  function shiftRowActions(s: ShiftRow): RowAction[] {
    const v = Number(s.variance) || 0;
    const late = s.counted_cash == null;
    const actions: RowAction[] = [];
    if (!inMobileShell) {
      actions.push({
        label: "التفاصيل",
        tone: "view",
        icon: "eye",
        onClick: () => router.push(`${shiftDetailBase}/${s.id}`),
      });
    }
    if (!late && v !== 0 && !s.variance_class && canClassify) {
      actions.push({
        label: "صنّف الفرق",
        tone: "edit",
        icon: "pencil",
        onClick: () => openClassify(s),
      });
    }
    return actions;
  }

  if (shiftLoading || loadingExtras) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#1473e6]" />
      </div>
    );
  }

  // Employee gate: no open shift → start screen only
  if (!openShift && isEmployee) {
    if (blockOpenShift) {
      return (
        <div className="mx-auto max-w-lg space-y-5">
          <div className="rounded-2xl border border-[#cfe0f8] bg-[#eef6ff] p-5">
            <div className="mb-2 flex items-center gap-2 text-[#0f5bb8]">
              <Wallet className="h-5 w-5" />
              <h1 className="text-xl font-bold">افتح الوردية من التابلت أو سطح المكتب</h1>
            </div>
            <p className="text-sm leading-6 text-[#526176]">
              فتح الوردية واستلام الدرج غير متاح من الهاتف. استخدم تابلت أو كمبيوتر
              لبدء الوردية، ثم تقدر تكمّل من الموبايل.
            </p>
          </div>
        </div>
      );
    }

    const lockedDrawer =
      (drawerSafeId && safes.find((s) => s.id === drawerSafeId)) || null;

    return (
      <div className="mx-auto max-w-lg space-y-5">
        <div className="rounded-2xl border border-[#cfe0f8] bg-[#eef6ff] p-5">
          <div className="mb-2 flex items-center gap-2 text-[#0f5bb8]">
            <Wallet className="h-5 w-5" />
            <h1 className="text-xl font-bold">عايز تبدأ وردية؟</h1>
          </div>
          <p className="text-sm leading-6 text-[#526176]">
            قبل أي عملية بيع لازم تستلم <strong>الدرج</strong> وتعدّ الفلوس بنفسك.
            الخزن التانية تقدر تستلم عليها مدفوعات أثناء الوردية، لكن التسليم في
            الإقفال يكون على الدرج.
          </p>
        </div>

        {!lockedDrawer ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-bold">درج الكاشير مش مضبوط</p>
            <p className="mt-2 leading-6">
              بلّغ المدير يختار خزنة الدرج من <strong>الإعدادات ← درج الكاشير</strong>،
              وبعدها تقدر تبدأ الوردية.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleOpenShift}
            className="space-y-4 rounded-xl border border-[#e5eaf1] bg-white p-5"
          >
            <h2 className="font-bold text-[#172033]">استلام الدرج وبدء الوردية</h2>

            <div className="rounded-lg border border-[#e5eaf1] bg-[#fafbfc] px-3 py-3">
              <p className="text-[11px] font-semibold text-[#98a2b3]">درج النقدية</p>
              <p className="mt-0.5 text-sm font-bold text-[#172033]">
                {lockedDrawer.name}
              </p>
              <p className="mt-1 text-xs text-[#687386]">
                رصيد النظام:{" "}
                <span className="font-bold text-[#172033]">
                  {formatCurrency(Number(lockedDrawer.balance) || 0)}
                </span>
                {" — "}للمراجعة فقط، اعتمد على العدّ الفعلي.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[#526176]">
                المبلغ بعد عدّ الدرج بنفسك
              </label>
              <input
                required
                type="number"
                step="0.01"
                value={openForm.opening_cash}
                onChange={(e) =>
                  setOpenForm((f) => ({ ...f, opening_cash: e.target.value }))
                }
                className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2.5 text-base font-semibold"
                placeholder="اكتب المبلغ اللي عدّيته"
                dir="ltr"
              />
              {openForm.opening_cash !== "" && (
                <p
                  className={`mt-1 text-xs font-semibold ${
                    Number(openForm.opening_cash) ===
                    Number(lockedDrawer.balance)
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }`}
                >
                  الفرق عن النظام:{" "}
                  {formatCurrency(
                    Number(openForm.opening_cash) -
                      Number(lockedDrawer.balance || 0)
                  )}
                </p>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[#e5eaf1] bg-[#fafbfc] p-3 text-sm text-[#172033]">
              <input
                type="checkbox"
                className="mt-1"
                checked={openForm.confirmed}
                onChange={(e) =>
                  setOpenForm((f) => ({ ...f, confirmed: e.target.checked }))
                }
              />
              <span>
                أكّد إنك عدّيت فلوس <strong>الدرج</strong> بنفسك وقبلت الاستلام
                بالمبلغ المكتوب. التسليم في نهاية الوردية هيكون على نفس الدرج.
              </span>
            </label>

            <button
              type="submit"
              disabled={busy || !openForm.confirmed}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1473e6] py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              بدء الوردية
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Clock3 className="h-6 w-6 text-[#1473e6]" />
        <div>
          <h1 className="text-2xl font-bold text-[#172033]">الوردية</h1>
          <p className="text-sm text-[#687386]">
            استلام الدرج، العمليات أثناء الوردية، ثم التسليم عند الإقفال
          </p>
        </div>
      </div>

      {(needShift || (isEmployee && !hasActiveShift && !openShift)) && (
        <div className="rounded-[11px] border border-[#f5d89a] bg-[#fff8eb] px-4 py-3">
          <p className="text-sm font-bold text-[#172033]">
            لازم تفتح وردية قبل استخدام نقطة البيع وباقي الشاشات
          </p>
          <p className="mt-1 text-[11px] text-[#687386]">
            استلم الدرج من النموذج بالأسفل عشان تقدر تكمل شغلك.
          </p>
        </div>
      )}

      {openShift ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[#e5eaf1] bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-emerald-700">
                <Unlock className="h-4 w-4" />
                <h2 className="font-bold">وردية مفتوحة</h2>
              </div>
              {!inMobileShell ? (
                <Link
                  href={`${shiftDetailBase}/${openShift.id}`}
                  className="text-xs font-bold text-[#1473e6] hover:underline"
                >
                  عرض التفاصيل والمعاملات
                </Link>
              ) : null}
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[#687386]">الدرج</dt>
                <dd className="font-semibold">{openShift.safe?.name || "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#687386]">وقت الفتح</dt>
                <dd>{formatDateShort(openShift.opened_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#687386]">استلام الدرج</dt>
                <dd className="font-semibold">
                  {formatCurrency(Number(openShift.opening_cash) || 0)}
                </dd>
              </div>
            </dl>

            {totals && (
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#eef1f6] pt-4 text-sm">
                <div className="rounded-lg bg-[#f7f9fc] p-3">
                  <p className="text-[11px] text-[#98a2b3]">مبيعات</p>
                  <p className="font-bold text-[#172033]">
                    {formatCurrency(totals.salesTotal)}
                  </p>
                </div>
                <div className="rounded-lg bg-[#f7f9fc] p-3">
                  <p className="text-[11px] text-[#98a2b3]">مشتريات</p>
                  <p className="font-bold text-[#172033]">
                    {formatCurrency(totals.purchasesTotal)}
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <p className="text-[11px] text-emerald-700">وارد للدرج</p>
                  <p className="font-bold text-emerald-800">
                    {formatCurrency(totals.cashIn)}
                  </p>
                </div>
                <div className="rounded-lg bg-red-50 p-3">
                  <p className="text-[11px] text-red-700">صادر من الدرج</p>
                  <p className="font-bold text-red-800">
                    {formatCurrency(totals.cashOut)}
                  </p>
                </div>
                <div className="col-span-2 rounded-lg border border-[#cfe0f8] bg-[#eef6ff] p-3">
                  <p className="text-[11px] text-[#1473e6]">المتوقع في الدرج الآن</p>
                  <p className="text-lg font-bold text-[#0f5bb8]">
                    {formatCurrency(totals.expectedCash)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={handleCloseShift}
            className="space-y-4 rounded-xl border border-[#e5eaf1] bg-white p-5"
          >
            <div className="flex items-center gap-2 text-[#172033]">
              <Lock className="h-4 w-4" />
              <h2 className="font-bold">تسليم الدرج وإقفال الوردية</h2>
            </div>
            <p className="text-xs leading-5 text-[#687386]">
              عدّ فلوس الدرج قبل التسليم. الخزن التانية مش جزء من تسليم الدرج.
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#526176]">
                النقدية المعدودة في الدرج
              </label>
              <input
                required
                type="number"
                step="0.01"
                value={closeForm.counted_cash}
                onChange={(e) =>
                  setCloseForm((f) => ({ ...f, counted_cash: e.target.value }))
                }
                className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
                placeholder="عدّ الدرج عند التسليم"
                dir="ltr"
              />
              {totals && closeForm.counted_cash !== "" && (
                <p className="mt-1 text-xs text-[#687386]">
                  فرق التسليم:{" "}
                  <span className="font-bold">
                    {formatCurrency(
                      Number(closeForm.counted_cash) - totals.expectedCash
                    )}
                  </span>
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#526176]">
                ملاحظات التسليم
              </label>
              <textarea
                value={closeForm.notes}
                onChange={(e) =>
                  setCloseForm((f) => ({ ...f, notes: e.target.value }))
                }
                rows={3}
                className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#172033] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              تسليم الدرج وإقفال
            </button>
          </form>
        </div>
      ) : blockOpenShift ? (
        <div className="max-w-lg rounded-xl border border-[#cfe0f8] bg-[#eef6ff] p-5">
          <h2 className="font-bold text-[#172033]">
            افتح الوردية من التابلت أو سطح المكتب
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#526176]">
            فتح وردية جديدة غير متاح من الهاتف.
          </p>
        </div>
      ) : (
        <form
          onSubmit={handleOpenShift}
          className="max-w-lg space-y-4 rounded-xl border border-[#e5eaf1] bg-white p-5"
        >
          <h2 className="font-bold text-[#172033]">فتح وردية / استلام درج</h2>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#526176]">
              الدرج
            </label>
            <select
              required
              value={openForm.safe_id}
              onChange={(e) =>
                setOpenForm({
                  safe_id: e.target.value,
                  opening_cash: "",
                  confirmed: false,
                })
              }
              className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
            >
              <option value="">اختر</option>
              {safes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {isDrawerSafe(s.name) ? " (درج)" : ""} —{" "}
                  {formatCurrency(s.balance)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[#526176]">
              المبلغ بعد العد
            </label>
            <input
              required
              type="number"
              step="0.01"
              value={openForm.opening_cash}
              onChange={(e) =>
                setOpenForm((f) => ({ ...f, opening_cash: e.target.value }))
              }
              className="w-full rounded-lg border border-[#e5eaf1] px-3 py-2 text-sm"
              dir="ltr"
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={openForm.confirmed}
              onChange={(e) =>
                setOpenForm((f) => ({ ...f, confirmed: e.target.checked }))
              }
            />
            أكّدت عدّ الدرج والاستلام
          </label>
          <button
            type="submit"
            disabled={busy || !openForm.confirmed}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1473e6] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            بدء الوردية
          </button>
        </form>
      )}

      {canSeeHistory && pendingQueue.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="mb-1 font-bold text-amber-950">فروق درج معلّقة</h2>
          <p className="mb-3 text-xs text-amber-800">
            ورديات محتاجة عدّ لاحق أو تصنيف فرق قبل ما يتقفل الملف.
          </p>
          <ul className="space-y-2">
            {pendingQueue.map((s) => {
              const late = needsLateCount(s);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2.5"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-[#172033]">
                      {s.opener?.full_name || "موظف"} · {s.safe?.name || "الدرج"}
                    </p>
                    <p className="text-xs text-[#687386]">
                      {s.closed_at ? formatDateRelative(s.closed_at) : "—"}
                      {" — "}
                      {late
                        ? "بدون عدّ (خروج بدون تسليم)"
                        : `فرق ${formatCurrency(Number(s.variance) || 0)} بانتظار التصنيف`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!inMobileShell ? (
                      <Link
                        href={`${shiftDetailBase}/${s.id}`}
                        className="rounded-md bg-[#172033] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#243247]"
                      >
                        التفاصيل
                      </Link>
                    ) : null}
                    {!late && canClassify && (
                      <button
                        type="button"
                        onClick={() => openClassify(s)}
                        className="rounded-md bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-200"
                      >
                        صنّف الفرق
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canSeeHistory && (
        <div className="rounded-xl border border-[#e5eaf1] bg-white p-5">
          <h2 className="mb-3 font-bold text-[#172033]">سجل الإقفالات</h2>
          {history.length === 0 ? (
            <p className="text-sm text-[#687386]">لا توجد ورديات مقفلة بعد</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-right text-sm">
                <thead>
                  <tr className="border-b border-[#eef1f6] text-[11px] text-[#98a2b3]">
                    <th className="px-2 py-2">الإقفال</th>
                    <th className="px-2 py-2">الفاتح</th>
                    <th className="px-2 py-2">الدرج</th>
                    <th className="px-2 py-2">متوقع</th>
                    <th className="px-2 py-2">معدود</th>
                    <th className="px-2 py-2">الفرق</th>
                    <th className="px-2 py-2">التسجيل</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((s) => {
                    const v = Number(s.variance) || 0;
                    return (
                      <tr
                        key={s.id}
                        className="border-b border-[#f3f5f8]"
                        onContextMenu={(e) =>
                          openMenu(e, toContextMenuItems(shiftRowActions(s)))
                        }
                      >
                        <td className="px-2 py-2">
                          <div className="flex flex-col gap-1">
                            <Link
                              href={`${shiftDetailBase}/${s.id}`}
                              className="font-semibold text-[#1473e6] hover:underline"
                            >
                              {s.closed_at
                                ? formatDateRelative(s.closed_at)
                                : "—"}
                            </Link>
                            {s.close_reason === "abandoned_unload" ||
                            s.close_reason === "abandoned_logout" ? (
                              <span className="inline-flex w-fit rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800 ring-1 ring-red-200">
                                {s.close_reason === "abandoned_logout"
                                  ? "خروج بدون تسليم"
                                  : "إغلاق بدون تسليم"}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          {s.opener?.full_name || "—"}
                        </td>
                        <td className="px-2 py-2">{s.safe?.name || "—"}</td>
                        <td className="px-2 py-2">
                          {formatCurrency(Number(s.expected_cash) || 0)}
                        </td>
                        <td className="px-2 py-2">
                          {s.counted_cash == null
                            ? "—"
                            : formatCurrency(Number(s.counted_cash) || 0)}
                        </td>
                        <td
                          className={`px-2 py-2 font-semibold ${
                            s.counted_cash == null
                              ? "text-red-700"
                              : v === 0
                                ? "text-emerald-700"
                                : "text-amber-700"
                          }`}
                        >
                          {s.counted_cash == null
                            ? "بدون عدّ"
                            : formatCurrency(v)}
                        </td>
                        <td className="px-2 py-2">
                          {s.counted_cash == null ? (
                            inMobileShell ? (
                              <span className="text-xs font-bold text-red-800">
                                بدون عدّ
                              </span>
                            ) : (
                              <Link
                                href={`${shiftDetailBase}/${s.id}`}
                                className="rounded-md bg-red-100 px-2.5 py-1 text-xs font-bold text-red-900 hover:bg-red-200"
                              >
                                عدّ من التفاصيل
                              </Link>
                            )
                          ) : v === 0 ? (
                            <span className="text-xs text-emerald-700">
                              بدون فرق
                            </span>
                          ) : s.variance_class ? (
                            <div className="text-xs leading-5">
                              <span className="font-semibold text-[#172033]">
                                {SHIFT_VARIANCE_CLASS_LABELS[s.variance_class]}
                              </span>
                              {s.variance_reason ? (
                                <p className="text-[#687386]">
                                  {s.variance_reason}
                                </p>
                              ) : null}
                            </div>
                          ) : canClassify ? (
                            <button
                              type="button"
                              onClick={() => openClassify(s)}
                              className="rounded-md bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-200"
                            >
                              صنّف الفرق
                            </button>
                          ) : (
                            <span className="text-xs text-amber-700">
                              بانتظار التصنيف
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {classifyShift && canClassify && (
        <ShiftVarianceClassifyModal
          shift={classifyShift}
          safes={safes}
          form={classifyForm}
          busy={busy}
          onChange={setClassifyForm}
          onCancel={() => {
            setClassifyShift(null);
            setClassifyForm({ class: "", reason: "", relatedSafeId: "" });
          }}
          onSubmit={handleClassifyVariance}
        />
      )}
      {contextMenu}
    </div>
  );
}

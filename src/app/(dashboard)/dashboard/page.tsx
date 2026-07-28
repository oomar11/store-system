"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock3,
  ReceiptText,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { isLowStockAlert } from "@/lib/low-stock";
import { rangeFromPreset } from "@/lib/reports/dates";
import { useAuth } from "@/hooks/useAuth";
import { useOpenShift } from "@/hooks/useOpenShift";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import {
  OpenShiftBanner,
  SetupGuide,
} from "@/components/dashboard/DashboardSetup";
import { DashboardStatCards } from "@/components/dashboard/DashboardStats";
import { DashboardInsights } from "@/components/dashboard/DashboardInsights";
import { DashboardActivity } from "@/components/dashboard/DashboardActivity";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import type { AppPermission } from "@/lib/permissions";
import type {
  DashboardAction,
  DashboardStats,
  RecentInvoice,
  SetupStep,
} from "@/components/dashboard/types";
import type { LucideIcon } from "lucide-react";
import {
  dashboardFromSnapshot,
  getSnapshot,
  isBrowserOnline,
  probeOnline,
  pullSnapshot,
  withTimeout,
} from "@/lib/offline";

const EMPTY_STATS: DashboardStats = {
  totalProducts: 0,
  totalCustomers: 0,
  totalSalesToday: 0,
  lowStockCount: 0,
  totalRevenue: 0,
  weeklySales: Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return {
      label: new Intl.DateTimeFormat("ar-EG", { weekday: "short" }).format(date),
      value: 0,
    };
  }),
  totalSafes: 0,
};

const QUICK_ACTIONS: (DashboardAction & {
  permission?: AppPermission;
  icon: LucideIcon;
})[] = [
  {
    title: "مبيعات اليوم",
    subtitle: "راجع فواتير اليوم المكتملة",
    href: `/sales?from=${rangeFromPreset("today").from}&to=${rangeFromPreset("today").to}`,
    icon: TrendingUp,
  },
  {
    title: "بيع جديد",
    subtitle: "ابدأ عملية بيع مباشرة",
    href: "/pos",
    icon: ShoppingCart,
  },
  {
    title: "فواتير المبيعات",
    subtitle: "عرض وإدارة كل المبيعات",
    href: "/sales",
    icon: ReceiptText,
  },
  {
    title: "فواتير المشتريات",
    subtitle: "إنشاء وإدارة المشتريات",
    href: "/purchases",
    icon: ShoppingBag,
  },
  {
    title: "عميل جديد",
    subtitle: "أضف بيانات عميل بسرعة",
    href: "/customers",
    icon: UserPlus,
  },
  {
    title: "الورديات",
    subtitle: "فتح وإقفال الوردية",
    href: "/shifts",
    icon: Clock3,
    permission: "shifts",
  },
];

function localYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function applySnapshotToState(
  snap: NonNullable<Awaited<ReturnType<typeof getSnapshot>>>,
  setStats: (s: DashboardStats) => void,
  setRecent: (r: RecentInvoice[]) => void
) {
  const d = dashboardFromSnapshot(snap);
  setStats({
    totalProducts: d.totalProducts,
    totalCustomers: d.totalCustomers,
    totalSalesToday: d.totalSalesToday,
    lowStockCount: d.lowStockCount,
    totalRevenue: d.totalRevenue,
    weeklySales:
      d.weeklySales.length > 0 ? d.weeklySales : EMPTY_STATS.weeklySales,
    totalSafes: d.totalSafes,
  });
  setRecent(d.recentInvoices as RecentInvoice[]);
}

async function tryLocalDashboard(
  setStats: (s: DashboardStats) => void,
  setRecent: (r: RecentInvoice[]) => void
): Promise<boolean> {
  try {
    const snap = await getSnapshot();
    if (!snap) return false;
    applySnapshotToState(snap, setStats, setRecent);
    return true;
  } catch {
    return false;
  }
}

export default function DashboardPage() {
  const { can, isEmployee, profile } = useAuth();
  const { openShift } = useOpenShift();
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [needsWarm, setNeedsWarm] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setNeedsWarm(false);

    // 1) Local first — never hang on skeletons if IndexedDB has data
    let hadLocal = await tryLocalDashboard(setStats, setRecentInvoices);
    if (hadLocal) {
      setFromCache(true);
      setLoading(false);
    }

    const online = isBrowserOnline() && (await probeOnline(2500));
    if (!online) {
      setLoading(false);
      if (!hadLocal) {
        setStats(EMPTY_STATS);
        setRecentInvoices([]);
        setNeedsWarm(true);
        setFromCache(false);
      }
      return;
    }

    if (!hadLocal) setLoading(true);

    const supabase = createClient();

    // 2) Prefer a full snapshot pull — fills IndexedDB for next offline open
    try {
      const snap = await withTimeout(pullSnapshot(supabase), 10000);
      applySnapshotToState(snap, setStats, setRecentInvoices);
      setFromCache(false);
      setNeedsWarm(false);
      setLoading(false);
      return;
    } catch (pullErr) {
      console.warn("Dashboard snapshot pull failed, trying live queries:", pullErr);
    }

    // 3) Fallback live queries (with timeout)
    try {
      const weekStart = new Date();
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - 6);

      const [
        productsRes,
        customersRes,
        productsStockRes,
        salesRes,
        recentRes,
        safesRes,
      ] = await withTimeout(
        Promise.all([
          supabase
            .from("products")
            .select("id", { count: "exact" })
            .eq("is_active", true),
          supabase
            .from("customers")
            .select("id", { count: "exact" })
            .eq("is_active", true),
          supabase
            .from("products")
            .select("quantity, min_quantity, notify_low_stock")
            .eq("is_active", true),
          supabase
            .from("invoices")
            .select("total, created_at")
            .eq("type", "sale")
            .eq("status", "completed")
            .gte("created_at", weekStart.toISOString()),
          supabase
            .from("invoices")
            .select(
              "id, invoice_number, total, created_at, customer:customers(name)"
            )
            .eq("type", "sale")
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("safes")
            .select("id", { count: "exact" })
            .eq("is_active", true),
        ]),
        8000
      );

      const queryError = [
        productsRes,
        customersRes,
        productsStockRes,
        salesRes,
        recentRes,
        safesRes,
      ].find((result) => result.error)?.error;

      if (queryError) throw queryError;

      const stockRows = (productsStockRes.data || []) as {
        quantity: number;
        min_quantity: number;
        notify_low_stock?: boolean | null;
      }[];
      const lowStockCount = stockRows.filter((product) =>
        isLowStockAlert(
          product.quantity,
          product.min_quantity,
          product.notify_low_stock
        )
      ).length;
      const invoices = (salesRes.data || []) as {
        total: number | null;
        created_at: string;
      }[];
      const todayKey = rangeFromPreset("today").from;
      const todayInvoices = invoices.filter(
        (invoice) => localYmd(new Date(invoice.created_at)) === todayKey
      );
      const todayRevenue = todayInvoices.reduce(
        (sum, invoice) => sum + (invoice.total || 0),
        0
      );
      const weeklySales = Array.from({ length: 7 }, (_, index) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - (6 - index));
        const key = localYmd(date);
        const value = invoices
          .filter((invoice) => localYmd(new Date(invoice.created_at)) === key)
          .reduce((sum, invoice) => sum + (invoice.total || 0), 0);

        return {
          label: new Intl.DateTimeFormat("ar-EG", {
            weekday: "short",
          }).format(date),
          value,
        };
      });

      setStats({
        totalProducts: productsRes.count || 0,
        totalCustomers: customersRes.count || 0,
        totalSalesToday: todayInvoices.length,
        lowStockCount,
        totalRevenue: todayRevenue,
        weeklySales,
        totalSafes: safesRes.count || 0,
      });
      setRecentInvoices((recentRes.data as RecentInvoice[] | null) ?? []);
      setFromCache(false);
      setNeedsWarm(false);
    } catch (error) {
      console.error("Error fetching dashboard:", error);
      hadLocal = await tryLocalDashboard(setStats, setRecentInvoices);
      if (hadLocal) {
        setFromCache(true);
        setNeedsWarm(false);
      } else {
        setStats(EMPTY_STATS);
        setRecentInvoices([]);
        setNeedsWarm(true);
        setFromCache(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchDashboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchDashboard]);

  const visibleActions = useMemo(
    () =>
      QUICK_ACTIONS.filter(
        (action) => !action.permission || can(action.permission)
      ),
    [can]
  );

  if (loading) return <DashboardSkeleton />;

  const todaySalesHref = `/sales?from=${rangeFromPreset("today").from}&to=${rangeFromPreset("today").to}`;
  const needsSetup = stats.totalProducts === 0 || stats.totalSafes === 0;
  const setupSteps: SetupStep[] = [
    {
      done: stats.totalSafes > 0,
      title: "أضف خزنة",
      subtitle: "لاستلام النقدية من المبيعات",
      href: "/treasury",
    },
    {
      done: stats.totalProducts > 0,
      title: "أضف أصناف",
      subtitle: "سجّل المنتجات والأسعار والمخزون",
      href: "/products",
    },
    {
      done: stats.totalCustomers > 0,
      title: "أضف عملاء",
      subtitle: "اختياري — للفواتير الآجلة",
      href: "/customers",
    },
  ];

  return (
    <div className="space-y-6">
      {needsWarm ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
          <p className="font-black">البيانات المحلية غير جاهزة بعد</p>
          <p className="mt-1">
            افتح التطبيق مرة وأنت متصل بالإنترنت ومسجّل دخول — هنحمّل نسخة من
            بيانات المتجر على الجهاز عشان لوحة التحكم والشاشات تشتغل أوفلاين.
          </p>
          <button
            type="button"
            onClick={() => void fetchDashboard()}
            className="mt-2 rounded-lg bg-amber-900 px-3 py-1.5 text-[11px] font-bold text-white"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : null}
      {fromCache && !needsWarm ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
          معروضة من البيانات المحفوظة على الجهاز
          {isBrowserOnline() ? " — جاري التحديث عند توفر الشبكة" : ""}
        </p>
      ) : null}
      <DashboardHero
        stats={stats}
        userName={profile?.full_name}
        needsSetup={needsSetup && !needsWarm}
      />
      {isEmployee && openShift ? <OpenShiftBanner /> : null}
      {needsSetup && !needsWarm ? <SetupGuide steps={setupSteps} /> : null}
      <DashboardStatCards stats={stats} todaySalesHref={todaySalesHref} />
      <DashboardInsights stats={stats} />
      <DashboardActivity invoices={recentInvoices} actions={visibleActions} />
    </div>
  );
}

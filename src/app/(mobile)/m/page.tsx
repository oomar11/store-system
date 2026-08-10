"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
import { isLowStockAlert } from "@/lib/low-stock";
import { formatCurrency, formatDateRelative } from "@/lib/utils";
import {
  getSnapshot,
  readLocalThenNetwork,
  withTimeout,
} from "@/lib/offline";
import {
  normalizeActiveSafes,
  safesOrderQuery,
} from "@/lib/safes-order";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileEmpty,
  MobileListRow,
  MobileSection,
  MobileSkeleton,
  MobileStatCard,
} from "@/components/mobile/MobileUI";
import type { Safe } from "@/types";

type RecentInvoice = {
  id: string;
  invoice_number: string;
  type: string;
  total: number;
  paid_amount: number;
  created_at: string;
  customer?: { name?: string } | null;
  supplier?: { name?: string } | null;
};

type HomeStats = {
  todaySales: number;
  todayCount: number;
  lowStock: number;
  safes: Safe[];
  recent: RecentInvoice[];
};

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function emptyStats(): HomeStats {
  return {
    todaySales: 0,
    todayCount: 0,
    lowStock: 0,
    safes: [],
    recent: [],
  };
}

export default function MobileHomePage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const subject = profileSubject(profile);

  const canTreasury = canAccess(subject, "treasury");
  const canSales =
    canAccess(subject, "sales") || canAccess(subject, "dashboard");
  const canProducts = canAccess(subject, "products");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<HomeStats>(emptyStats);

  const load = useCallback(async () => {
    const since = startOfTodayIso();
    // Only trust the browser offline flag for reads — OfflineProvider probe
    // often false-negatives and left home "آخر الحركات" on empty local data.
    const offline =
      typeof navigator !== "undefined" && navigator.onLine === false;

    await readLocalThenNetwork<HomeStats>({
      offline,
      timeoutMs: 8000,
      // Wait for network when online so offline ghost safes don't stick.
      backgroundRefresh: false,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap) return null;

        const todayKey = new Date().toISOString().slice(0, 10);
        const todaySalesFromSnap =
          snap.invoiceStats?.todayKey === todayKey
            ? {
                todaySales: snap.invoiceStats.todayRevenue,
                todayCount: snap.invoiceStats.todayCount,
              }
            : (() => {
                const today = (snap.recentInvoices || []).filter(
                  (inv) =>
                    inv.type === "sale" &&
                    inv.created_at.slice(0, 10) === todayKey
                );
                return {
                  todaySales: today.reduce(
                    (s, r) => s + Number(r.total || 0),
                    0
                  ),
                  todayCount: today.length,
                };
              })();

        const lowStock = canProducts
          ? (snap.products || []).filter((p) =>
              isLowStockAlert(
                Number(p.quantity),
                Number(p.min_quantity ?? 0),
                p.notify_low_stock
              )
            ).length
          : 0;

        const safes = canTreasury
          ? normalizeActiveSafes(
              (snap.safes || []).map((s) => ({
                id: s.id,
                name: s.name,
                balance: s.balance,
                is_active: s.is_active,
                sort_order: s.sort_order ?? undefined,
                created_at: "",
              })) as Safe[]
            )
          : [];

        const recent = canSales
          ? (snap.recentInvoices || []).slice(0, 12).map((inv) => ({
              id: inv.id,
              invoice_number: inv.invoice_number,
              type: inv.type,
              total: inv.total,
              paid_amount: inv.paid_amount,
              created_at: inv.created_at,
              customer: inv.customer_name
                ? { name: inv.customer_name }
                : null,
              supplier: inv.supplier_name
                ? { name: inv.supplier_name }
                : null,
            }))
          : [];

        return {
          ...todaySalesFromSnap,
          lowStock,
          safes,
          recent,
        };
      },
      network: async () => {
        const [salesRes, productsRes, safesRes, recentRes] = await withTimeout(
          Promise.all([
            canSales
              ? supabase
                  .from("invoices")
                  .select("id, total, type")
                  .eq("type", "sale")
                  .eq("status", "completed")
                  .gte("created_at", since)
              : Promise.resolve({
                  data: [] as { total: number }[],
                  error: null,
                }),
            canProducts
              ? supabase
                  .from("products")
                  .select("id, quantity, min_quantity, notify_low_stock")
                  .eq("is_active", true)
              : Promise.resolve({ data: [] as unknown[], error: null }),
            canTreasury
              ? safesOrderQuery(
                  supabase.from("safes").select("*").eq("is_active", true)
                )
              : Promise.resolve({ data: [] as Safe[], error: null }),
            canSales
              ? supabase
                  .from("invoices")
                  .select(
                    "id, invoice_number, type, total, paid_amount, created_at, customer_id, supplier_id"
                  )
                  .in("type", [
                    "sale",
                    "purchase",
                    "sale_return",
                    "purchase_return",
                  ])
                  .order("created_at", { ascending: false })
                  .limit(12)
              : Promise.resolve({
                  data: [] as Array<Record<string, unknown>>,
                  error: null,
                }),
          ]),
          5000
        );

        if ("error" in salesRes && salesRes.error) {
          throw new Error(salesRes.error.message || "تعذر تحميل المبيعات");
        }
        if ("error" in recentRes && recentRes.error) {
          throw new Error(recentRes.error.message || "تعذر تحميل الحركات");
        }
        if ("error" in safesRes && safesRes.error) {
          throw new Error(safesRes.error.message || "تعذر تحميل الخزائن");
        }

        const salesRows = (salesRes.data || []) as { total: number }[];
        const products = (productsRes.data || []) as Array<{
          quantity: number;
          min_quantity: number | null;
          notify_low_stock?: boolean | null;
        }>;

        const recentRaw = (recentRes.data || []) as Array<{
          id: string;
          invoice_number: string;
          type: string;
          total: number;
          paid_amount: number;
          created_at: string;
          customer_id?: string | null;
          supplier_id?: string | null;
        }>;
        const customerIds = Array.from(
          new Set(
            recentRaw
              .map((r) => r.customer_id)
              .filter((id): id is string => Boolean(id))
          )
        );
        const supplierIds = Array.from(
          new Set(
            recentRaw
              .map((r) => r.supplier_id)
              .filter((id): id is string => Boolean(id))
          )
        );
        const nameByCustomer = new Map<string, string>();
        const nameBySupplier = new Map<string, string>();
        if (customerIds.length) {
          const { data } = await supabase
            .from("customers")
            .select("id, name")
            .in("id", customerIds);
          for (const c of data || []) {
            nameByCustomer.set(String(c.id), String(c.name || ""));
          }
        }
        if (supplierIds.length) {
          const { data } = await supabase
            .from("suppliers")
            .select("id, name")
            .in("id", supplierIds);
          for (const s of data || []) {
            nameBySupplier.set(String(s.id), String(s.name || ""));
          }
        }

        return {
          todaySales: salesRows.reduce((s, r) => s + Number(r.total || 0), 0),
          todayCount: salesRows.length,
          lowStock: products.filter((p) =>
            isLowStockAlert(
              Number(p.quantity),
              Number(p.min_quantity ?? 0),
              p.notify_low_stock
            )
          ).length,
          safes: normalizeActiveSafes((safesRes.data || []) as Safe[]),
          recent: recentRaw.map((inv) => ({
            id: inv.id,
            invoice_number: inv.invoice_number,
            type: inv.type,
            total: inv.total,
            paid_amount: inv.paid_amount,
            created_at: inv.created_at,
            customer: inv.customer_id
              ? { name: nameByCustomer.get(inv.customer_id) || "—" }
              : null,
            supplier: inv.supplier_id
              ? { name: nameBySupplier.get(inv.supplier_id) || "—" }
              : null,
          })),
        };
      },
      apply: (data) =>
        setStats({
          ...data,
          safes: normalizeActiveSafes(data.safes),
        }),
    });
  }, [canProducts, canSales, canTreasury, supabase]);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        await load();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "تعذر تحميل الملخص");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, load]);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر التحديث");
    } finally {
      setRefreshing(false);
    }
  }

  const todayLabel = new Intl.DateTimeFormat("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <>
      <MobileHeader
        title="ويندور"
        subtitle={
          profile?.full_name
            ? `مرحباً، ${profile.full_name}`
            : typeof navigator !== "undefined" && navigator.onLine
              ? "متصل بالسحابة"
              : "وضع أوفلاين"
        }
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <div className="mobile-page">
        <div className="mobile-welcome">
          <p>اليوم: {todayLabel}</p>
          <h2>ملخص الحالة المالية</h2>
        </div>

        {error ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
        ) : null}

        {authLoading || loading ? (
          <MobileSkeleton rows={5} />
        ) : (
          <>
            <div className="mobile-stats">
              <MobileStatCard
                tone="blue"
                label="مبيعات اليوم"
                value={formatCurrency(stats.todaySales)}
                meta={`${stats.todayCount} فاتورة`}
              />
              <MobileStatCard
                tone="orange"
                label="نواقص المخزن"
                value={`${stats.lowStock}`}
                meta="منتجات تحت الحد"
                onClick={() => router.push("/m/more/stock")}
              />
            </div>

            {canTreasury && stats.safes.length > 0 ? (
              <MobileSection title="أرصدة الخزن">
                <div className="mobile-panel">
                  {stats.safes.map((s) => (
                    <MobileListRow
                      key={s.id}
                      title={s.name}
                      amount={Number(s.balance)}
                      amountTone={
                        Number(s.balance) >= 0 ? "positive" : "negative"
                      }
                    />
                  ))}
                </div>
              </MobileSection>
            ) : null}

            <MobileSection title="آخر الحركات">
              <div className="mobile-panel">
                {stats.recent.length === 0 ? (
                  <MobileEmpty message="لا توجد فواتير حديثة" />
                ) : (
                  stats.recent.map((inv) => {
                    const party =
                      inv.customer?.name || inv.supplier?.name || "—";
                    const typeLabel =
                      inv.type === "sale"
                        ? "بيع"
                        : inv.type === "purchase"
                          ? "شراء"
                          : inv.type === "sale_return"
                            ? "مرتجع بيع"
                            : "مرتجع شراء";
                    return (
                      <MobileListRow
                        key={inv.id}
                        title={inv.invoice_number}
                        subtitle={`${typeLabel} · ${party} · ${formatDateRelative(inv.created_at)}`}
                        amount={Number(inv.total)}
                        onClick={() =>
                          router.push(`/m/invoices/inv/${inv.id}`)
                        }
                      />
                    );
                  })
                )}
              </div>
            </MobileSection>
          </>
        )}
      </div>
    </>
  );
}

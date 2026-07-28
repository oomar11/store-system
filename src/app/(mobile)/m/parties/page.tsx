"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
import { formatCurrency, smartSearchMatch } from "@/lib/utils";
import {
  getSnapshot,
  readLocalThenNetwork,
  withTimeout,
} from "@/lib/offline";
import { useOffline } from "@/components/offline/OfflineProvider";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileChip,
  MobileEmpty,
  MobileListRow,
  MobileSkeleton,
} from "@/components/mobile/MobileUI";
import type { Customer, Supplier } from "@/types";

type Kind = "customers" | "suppliers";
type BalanceFilter = "all" | "debt" | "credit" | "zero";

export default function MobilePartiesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { online } = useOffline();
  const { profile, loading: authLoading } = useAuth();
  const subject = profileSubject(profile);

  const canCustomers = canAccess(subject, "customers");
  const canSuppliers = canAccess(subject, "suppliers");

  const [kind, setKind] = useState<Kind>("customers");
  const [filter, setFilter] = useState<BalanceFilter>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (canCustomers) setKind("customers");
    else if (canSuppliers) setKind("suppliers");
  }, [authLoading, canCustomers, canSuppliers]);

  const load = useCallback(async () => {
    const offline = !online || !navigator.onLine;

    await readLocalThenNetwork<{
      customers: Customer[];
      suppliers: Supplier[];
    }>({
      offline,
      timeoutMs: 5000,
      local: async () => {
        const snap = await getSnapshot();
        if (!snap) return null;
        return {
          customers: canCustomers
            ? (snap.customers || [])
                .filter((c) => c.is_active !== false)
                .map(
                  (c) =>
                    ({
                      id: c.id,
                      name: c.name,
                      phone: c.phone || undefined,
                      balance: c.balance,
                      created_at: "",
                    }) as Customer
                )
            : [],
          suppliers: canSuppliers
            ? (snap.suppliers || [])
                .filter((s) => s.is_active !== false)
                .map(
                  (s) =>
                    ({
                      id: s.id,
                      name: s.name,
                      phone: s.phone || undefined,
                      balance: s.balance,
                      created_at: "",
                    }) as Supplier
                )
            : [],
        };
      },
      network: async () => {
        const [custRes, suppRes] = await withTimeout(
          Promise.all([
            canCustomers
              ? supabase
                  .from("customers")
                  .select("*")
                  .eq("is_active", true)
                  .order("name")
              : Promise.resolve({ data: [] as Customer[], error: null }),
            canSuppliers
              ? supabase
                  .from("suppliers")
                  .select("*")
                  .eq("is_active", true)
                  .order("name")
              : Promise.resolve({ data: [] as Supplier[], error: null }),
          ]),
          5000
        );
        return {
          customers: canCustomers
            ? ((custRes.data || []) as Customer[])
            : [],
          suppliers: canSuppliers
            ? ((suppRes.data || []) as Supplier[])
            : [],
        };
      },
      apply: (data) => {
        setCustomers(data.customers);
        setSuppliers(data.suppliers);
      },
    });
  }, [canCustomers, canSuppliers, online, supabase]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, load]);

  const list = useMemo(() => {
    const raw =
      kind === "customers"
        ? customers.map((c) => ({ ...c, _kind: "customer" as const }))
        : suppliers.map((s) => ({ ...s, _kind: "supplier" as const }));

    return raw.filter((p) => {
      if (q && !smartSearchMatch(q, [p.name, p.phone || ""])) return false;
      const bal = Number(p.balance);
      if (filter === "debt") return bal > 0.001;
      if (filter === "credit") return bal < -0.001;
      if (filter === "zero") return Math.abs(bal) <= 0.001;
      return true;
    });
  }, [customers, filter, kind, q, suppliers]);

  const receivables = customers
    .filter((c) => Number(c.balance) > 0)
    .reduce((s, c) => s + Number(c.balance), 0);
  const payables = suppliers
    .filter((s) => Number(s.balance) > 0)
    .reduce((s, s0) => s + Number(s0.balance), 0);

  return (
    <>
      <MobileHeader title="الأطراف" subtitle="عملاء وموردون" onRefresh={load} />
      <div className="mobile-page">
        <div className="mobile-stats mb-3">
          {canCustomers ? (
            <div className="mobile-stat mobile-stat--blue">
              <span className="mobile-stat__label">مستحقات العملاء</span>
              <strong className="mobile-stat__value">
                {formatCurrency(receivables)}
              </strong>
            </div>
          ) : null}
          {canSuppliers ? (
            <div className="mobile-stat mobile-stat--orange">
              <span className="mobile-stat__label">مستحقات الموردين</span>
              <strong className="mobile-stat__value">
                {formatCurrency(payables)}
              </strong>
            </div>
          ) : null}
        </div>

        <div className="mobile-chip-row">
          {canCustomers ? (
            <MobileChip
              active={kind === "customers"}
              onClick={() => setKind("customers")}
            >
              عملاء
            </MobileChip>
          ) : null}
          {canSuppliers ? (
            <MobileChip
              active={kind === "suppliers"}
              onClick={() => setKind("suppliers")}
            >
              موردون
            </MobileChip>
          ) : null}
        </div>

        <div className="mobile-chip-row">
          {(
            [
              ["all", "الكل"],
              ["debt", "مدين"],
              ["credit", "دائن"],
              ["zero", "صفر"],
            ] as const
          ).map(([id, label]) => (
            <MobileChip
              key={id}
              active={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </MobileChip>
          ))}
        </div>

        <div className="mobile-field">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم أو الهاتف..."
          />
        </div>

        {authLoading || loading ? (
          <MobileSkeleton rows={8} />
        ) : (
          <div className="mobile-panel">
            {list.length === 0 ? (
              <MobileEmpty message="لا توجد نتائج" />
            ) : (
              list.map((p) => (
                <MobileListRow
                  key={p.id}
                  title={p.name}
                  subtitle={p.phone || "بدون هاتف"}
                  amount={Number(p.balance)}
                  amountTone={
                    Number(p.balance) > 0
                      ? "negative"
                      : Number(p.balance) < 0
                        ? "positive"
                        : "muted"
                  }
                  onClick={() =>
                    router.push(`/m/parties/${p._kind}/${p.id}`)
                  }
                />
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

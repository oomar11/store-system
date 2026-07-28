"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
import { formatCurrency, formatDateRelative } from "@/lib/utils";
import {
  getSnapshot,
  readLocalThenNetwork,
  withTimeout,
} from "@/lib/offline";
import { useOffline } from "@/components/offline/OfflineProvider";
import {
  documentTypeLabelAr,
  invoiceTypeLabelAr,
} from "@/components/mobile/MobileDetail";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileChip,
  MobileEmpty,
  MobileListRow,
  MobileSkeleton,
} from "@/components/mobile/MobileUI";
import type { InvoiceType } from "@/types";

type Tab = "sale" | "quote" | "purchase" | "purchase_order" | "returns";

type InvoiceListRow = {
  kind: "invoice";
  id: string;
  number: string;
  type: string;
  total: number;
  paid_amount: number;
  created_at: string;
  party?: string;
};

type DocumentListRow = {
  kind: "document";
  id: string;
  number: string;
  type: string;
  total: number;
  stage: string;
  created_at: string;
  party?: string;
};

type ListRow = InvoiceListRow | DocumentListRow;

const RETURN_TYPES: InvoiceType[] = ["sale_return", "purchase_return"];

export default function MobileInvoicesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { online } = useOffline();
  const { profile, loading: authLoading } = useAuth();
  const subject = profileSubject(profile);
  const canSales = canAccess(subject, "sales");
  const canPurchases = canAccess(subject, "purchases");

  const [tab, setTab] = useState<Tab>("sale");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ListRow[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (canSales) setTab("sale");
    else if (canPurchases) setTab("purchase");
  }, [authLoading, canSales, canPurchases]);

  // Deep-link from home: /m/invoices?id=...
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    router.replace(`/m/invoices/inv/${id}`);
  }, [router, searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Don't probe before paint — navigator/offline flag is enough for local-first
      const offline = !online || !navigator.onLine;

      // Documents (quotes/orders) aren't in the offline snapshot
      if (tab === "quote" || tab === "purchase_order") {
        if (offline) {
          setRows([]);
          return;
        }
        const { data } = await withTimeout(
          (async () =>
            supabase
              .from("documents")
              .select(
                "id, document_number, type, stage, total, created_at, customer:customers(name), supplier:suppliers(name)"
              )
              .eq("type", tab)
              .order("created_at", { ascending: false })
              .limit(60))(),
          5000
        );

        setRows(
          ((data || []) as unknown as {
            id: string;
            document_number: string;
            type: string;
            stage: string;
            total: number;
            created_at: string;
            customer?: { name?: string } | null;
            supplier?: { name?: string } | null;
          }[]).map((d) => ({
            kind: "document" as const,
            id: d.id,
            number: d.document_number,
            type: d.type,
            total: Number(d.total),
            stage: d.stage,
            created_at: d.created_at,
            party: d.customer?.name || d.supplier?.name || "—",
          }))
        );
        return;
      }

      let types: InvoiceType[] = [];
      if (tab === "sale") types = ["sale"];
      else if (tab === "purchase") types = ["purchase"];
      else types = RETURN_TYPES;

      await readLocalThenNetwork<ListRow[]>({
        offline,
        timeoutMs: 4000,
        local: async () => {
          const snap = await getSnapshot();
          if (!snap?.recentInvoices?.length) return null;
          return (snap.recentInvoices || [])
            .filter((inv) => types.includes(inv.type as InvoiceType))
            .slice(0, 60)
            .map(
              (inv): InvoiceListRow => ({
                kind: "invoice",
                id: inv.id,
                number: inv.invoice_number,
                type: inv.type,
                total: Number(inv.total),
                paid_amount: Number(inv.paid_amount),
                created_at: inv.created_at,
                party: inv.customer_name || inv.supplier_name || "—",
              })
            );
        },
        network: async () => {
          const { data, error } = await withTimeout(
            (async () =>
              supabase
                .from("invoices")
                .select(
                  "id, invoice_number, type, total, paid_amount, created_at, customer:customers(name), supplier:suppliers(name)"
                )
                .in("type", types)
                .order("created_at", { ascending: false })
                .limit(60))(),
            4000
          );
          if (error) throw error;
          return ((data || []) as unknown as {
            id: string;
            invoice_number: string;
            type: string;
            total: number;
            paid_amount: number;
            created_at: string;
            customer?: { name?: string } | null;
            supplier?: { name?: string } | null;
          }[]).map(
            (inv): InvoiceListRow => ({
              kind: "invoice",
              id: inv.id,
              number: inv.invoice_number,
              type: inv.type,
              total: Number(inv.total),
              paid_amount: Number(inv.paid_amount),
              created_at: inv.created_at,
              party: inv.customer?.name || inv.supplier?.name || "—",
            })
          );
        },
        apply: (data) => setRows(data),
      });
    } finally {
      setLoading(false);
    }
  }, [online, supabase, tab]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  function openRow(row: ListRow) {
    if (row.kind === "document") {
      router.push(`/m/invoices/doc/${row.id}`);
    } else {
      router.push(`/m/invoices/inv/${row.id}`);
    }
  }

  return (
    <>
      <MobileHeader title="الفواتير" subtitle="عرض ومراجعة" onRefresh={load} />
      <div className="mobile-page">
        <div className="mobile-chip-row">
          {canSales ? (
            <MobileChip active={tab === "sale"} onClick={() => setTab("sale")}>
              مبيعات
            </MobileChip>
          ) : null}
          {canSales ? (
            <MobileChip active={tab === "quote"} onClick={() => setTab("quote")}>
              عروض أسعار
            </MobileChip>
          ) : null}
          {canPurchases ? (
            <MobileChip
              active={tab === "purchase"}
              onClick={() => setTab("purchase")}
            >
              مشتريات
            </MobileChip>
          ) : null}
          {canPurchases ? (
            <MobileChip
              active={tab === "purchase_order"}
              onClick={() => setTab("purchase_order")}
            >
              طلبيات
            </MobileChip>
          ) : null}
          {(canSales || canPurchases) && (
            <MobileChip
              active={tab === "returns"}
              onClick={() => setTab("returns")}
            >
              مرتجعات
            </MobileChip>
          )}
        </div>

        {authLoading || loading ? (
          <MobileSkeleton rows={8} />
        ) : (
          <div className="mobile-panel">
            {rows.length === 0 ? (
              <MobileEmpty message="لا توجد مستندات في هذا التبويب" />
            ) : (
              rows.map((row) => {
                const typeLabel =
                  row.kind === "document"
                    ? documentTypeLabelAr(row.type)
                    : invoiceTypeLabelAr(row.type);
                const remaining =
                  row.kind === "invoice"
                    ? Math.max(0, row.total - row.paid_amount)
                    : 0;
                return (
                  <MobileListRow
                    key={`${row.kind}-${row.id}`}
                    title={row.number}
                    subtitle={`${typeLabel} · ${row.party} · ${formatDateRelative(row.created_at)}`}
                    amount={row.total}
                    onClick={() => openRow(row)}
                    trailing={
                      remaining > 0.001 ? (
                        <span className="text-[10px] font-bold text-[var(--warning)]">
                          متبقي
                        </span>
                      ) : null
                    }
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    </>
  );
}

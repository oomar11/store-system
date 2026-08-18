"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
import {
  buildPartyOpeningRow,
  fetchCrossAppPartyHistory,
  fetchCustomerHistory,
  fetchSupplierHistory,
  invoiceTypeLabel,
  partyPaymentToHistoryRow,
  type PartyInvoiceRow,
} from "@/lib/history";
import {
  fetchOpenInvoicesForParty,
  listPartyPayments,
  previewPartyPaymentAllocation,
  type OpenInvoiceForPayment,
  type PartyPaymentRow,
} from "@/lib/party-payments";
import {
  applyPartyPaymentOnlineOrQueue,
  getSnapshot,
  readLocalThenNetwork,
  withTimeout,
} from "@/lib/offline";
import { useOffline } from "@/components/offline/OfflineProvider";
import { pickDefaultSafeId } from "@/lib/safe-transactions";
import {
  normalizeActiveSafes,
  safesOrderQuery,
} from "@/lib/safes-order";
import {
  formatCurrency,
  formatDateRelative,
  formatDateShort,
} from "@/lib/utils";
import { MobileBackLink } from "@/components/mobile/MobileDetail";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  ShareExportButton,
  type SharePayload,
} from "@/components/mobile/ShareExportButton";
import {
  MobileChip,
  MobileEmpty,
  MobileListRow,
  MobileSection,
  MobileSheet,
  MobileSkeleton,
} from "@/components/mobile/MobileUI";
import type { Customer, Safe, Supplier } from "@/types";

type Kind = "customer" | "supplier";
type Filter =
  | "all"
  | "sale"
  | "purchase"
  | "sale_return"
  | "purchase_return"
  | "collection"
  | "disbursement"
  | "opening"
  | "workshop"
  | "plisse";

export default function MobilePartyDetailPage() {
  const params = useParams<{ kind: string; id: string }>();
  const kind = (params.kind === "supplier" ? "supplier" : "customer") as Kind;
  const id = params.id;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { online } = useOffline();
  const { profile, loading: authLoading } = useAuth();
  const subject = profileSubject(profile);
  const canPay =
    (kind === "customer" &&
      (canAccess(subject, "customers") ||
        canAccess(subject, "customers.write") ||
        canAccess(subject, "treasury"))) ||
    (kind === "supplier" &&
      (canAccess(subject, "suppliers") || canAccess(subject, "treasury")));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [party, setParty] = useState<(Customer | Supplier) | null>(null);
  const [rows, setRows] = useState<PartyInvoiceRow[]>([]);
  const [openTotal, setOpenTotal] = useState(0);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceForPayment[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [safes, setSafes] = useState<Safe[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [safeId, setSafeId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [payError, setPayError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const offline = !online || !navigator.onLine;

      // Party + safes: local-first from snapshot
      await readLocalThenNetwork<{
        party: Customer | Supplier;
        safes: Safe[];
      }>({
        offline,
        timeoutMs: 5000,
        local: async () => {
          const snap = await getSnapshot();
          if (!snap) return null;
          const list =
            kind === "customer" ? snap.customers || [] : snap.suppliers || [];
          const found = list.find((p) => p.id === id);
          if (!found) return null;
          return {
            party: {
              id: found.id,
              name: found.name,
              phone: found.phone || undefined,
              balance: found.balance,
              created_at: "",
            } as Customer | Supplier,
            safes: normalizeActiveSafes(
              (snap.safes || []).map(
                (s) =>
                  ({
                    id: s.id,
                    name: s.name,
                    balance: s.balance,
                    is_active: s.is_active,
                    sort_order: s.sort_order ?? undefined,
                    created_at: "",
                  }) as Safe
              ),
              { dedupeByName: true }
            ),
          };
        },
        network: async () => {
          const table = kind === "customer" ? "customers" : "suppliers";
          const [partyRes, safesRes] = await withTimeout(
            Promise.all([
              supabase.from(table).select("*").eq("id", id).maybeSingle(),
              safesOrderQuery(
                supabase.from("safes").select("*").eq("is_active", true)
              ),
            ]),
            5000
          );
          if (partyRes.error) throw new Error(partyRes.error.message);
          if (!partyRes.data) throw new Error("الطرف غير موجود");
          return {
            party: partyRes.data as Customer | Supplier,
            safes: normalizeActiveSafes((safesRes.data || []) as Safe[]),
          };
        },
        apply: (data) => {
          const safes = normalizeActiveSafes(data.safes);
          setParty(data.party);
          setSafes(safes);
          const def = pickDefaultSafeId(safes);
          if (def) setSafeId((p) => p || def);
        },
      });

      // History: try each source on its own so a slow payments query or a
      // false "offline" flag does not wipe workshop/plisse rows.
      async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
        try {
          return await withTimeout(promise, 12000);
        } catch {
          return fallback;
        }
      }

      const [history, payments, open, crossApp, partyForOpening] =
        await Promise.all([
          settled(
            kind === "customer"
              ? fetchCustomerHistory(id)
              : fetchSupplierHistory(id),
            [] as PartyInvoiceRow[]
          ),
          settled(listPartyPayments(supabase, kind, id), [] as PartyPaymentRow[]),
          settled(fetchOpenInvoicesForParty(supabase, kind, id), []),
          settled(fetchCrossAppPartyHistory(kind, id, supabase), []),
          settled(
            (async () => {
              const table = kind === "customer" ? "customers" : "suppliers";
              const { data } = await supabase
                .from(table)
                .select("*")
                .eq("id", id)
                .maybeSingle();
              return (data as Customer | Supplier | null) || null;
            })(),
            null as Customer | Supplier | null
          ),
        ]);

      if (partyForOpening) setParty(partyForOpening);

      const opening = partyForOpening
        ? buildPartyOpeningRow(partyForOpening)
        : null;
      const paymentRows = payments.map(partyPaymentToHistoryRow);
      const merged = [
        ...(opening ? [opening] : []),
        ...history,
        ...crossApp,
        ...paymentRows,
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setRows(merged);
      setOpenInvoices(open);
      setOpenTotal(open.reduce((s, i) => s + i.remaining, 0));
      if (merged.length === 0 && (!online || !navigator.onLine)) {
        setError("الاتصال ضعيف — حدّث الصفحة لما النت يستقر");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الحساب");
      setRows([]);
      setOpenInvoices([]);
      setOpenTotal(0);
    } finally {
      setLoading(false);
    }
  }, [id, kind, online, supabase]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "workshop") {
      return rows.filter((r) => r.isCrossApp && r.sourceSystem === "aa");
    }
    if (filter === "plisse") {
      return rows.filter((r) => r.isCrossApp && r.sourceSystem === "plisse");
    }
    return rows.filter((r) => r.type === filter);
  }, [filter, rows]);

  const sharePayload: SharePayload | null = useMemo(() => {
    if (!party) return null;
    const chronological = [...rows].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const kindLabel = kind === "customer" ? "عميل" : "مورد";
    const metaLines = [
      `تاريخ الكشف ${formatDateShort(new Date())}`,
      ...(party.phone ? [`هاتف ${party.phone}`] : []),
      ...(openTotal > 0.001
        ? [`متبقي فواتير مفتوحة ${formatCurrency(openTotal)}`]
        : []),
    ];
    return {
      title:
        kind === "customer"
          ? `كشف حساب عميل — ${party.name}`
          : `كشف حساب مورد — ${party.name}`,
      subtitle: kindLabel,
      totalLabel: "الرصيد",
      total: formatCurrency(Number(party.balance)),
      metaLines,
      lines: chronological.map((row) => ({
        title: `${invoiceTypeLabel(row.type, row.sourceSystem)} · ${row.invoice_number}`,
        subtitle: formatDateShort(row.created_at),
        amount: formatCurrency(Number(row.total)),
      })),
      fileBaseName: `كشف_${party.name}`,
    };
  }, [kind, openTotal, party, rows]);

  async function submitPayment() {
    if (!party) return;
    setSaving(true);
    setPayError("");
    try {
      const value = Number(amount);
      if (!value || value <= 0) throw new Error("أدخل مبلغاً صحيحاً");
      if (!safeId) throw new Error("اختر الخزنة");
      await applyPartyPaymentOnlineOrQueue(supabase, {
        kind,
        partyId: party.id,
        partyName: party.name,
        amount: value,
        safeId,
        notes,
        createdAt: new Date().toISOString(),
      });
      setPayOpen(false);
      setAmount("");
      setNotes("");
      await load();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "تعذر التسجيل");
    } finally {
      setSaving(false);
    }
  }

  const payPreview = useMemo(() => {
    const value = Number(amount) || 0;
    if (!party || value <= 0) return null;
    return previewPartyPaymentAllocation(
      openInvoices,
      value,
      Number(party.balance) || 0
    );
  }, [amount, openInvoices, party]);

  const filterChips: { id: Filter; label: string }[] =
    kind === "customer"
      ? [
          { id: "all", label: "الكل" },
          { id: "sale", label: "بيع" },
          { id: "sale_return", label: "مرتجع" },
          { id: "collection", label: "تحصيل" },
          { id: "workshop", label: "ورشة" },
          { id: "plisse", label: "بلسية" },
          { id: "opening", label: "افتتاحي" },
        ]
      : [
          { id: "all", label: "الكل" },
          { id: "purchase", label: "شراء" },
          { id: "purchase_return", label: "مرتجع" },
          { id: "disbursement", label: "سداد" },
          { id: "workshop", label: "ورشة" },
          { id: "plisse", label: "بلسية" },
          { id: "opening", label: "افتتاحي" },
        ];

  return (
    <>
      <MobileHeader
        title={party?.name || "حساب الطرف"}
        subtitle={kind === "customer" ? "عميل" : "مورد"}
        onRefresh={load}
        refreshing={loading}
        trailing={
          <ShareExportButton payload={sharePayload} disabled={loading} />
        }
      />
      <div className="mobile-page">
        <MobileBackLink href="/m/parties" label="الأطراف" />

        {error ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{error}</p>
        ) : null}

        {authLoading || loading || !party ? (
          <MobileSkeleton rows={7} />
        ) : (
          <>
            <div className="mobile-money-hero mb-3">
              <p className="mobile-money-hero__label">الرصيد</p>
              <p className="mobile-money-hero__amount">
                {formatCurrency(Number(party.balance))}
              </p>
              {openTotal > 0.001 ? (
                <p className="mobile-money-hero__meta">
                  متبقي فواتير مفتوحة {formatCurrency(openTotal)}
                </p>
              ) : null}
              {party.phone ? (
                <p className="mobile-money-hero__note">{party.phone}</p>
              ) : null}
              {canPay && safes.length > 0 ? (
                <button
                  type="button"
                  className="mobile-btn mobile-btn--primary mt-3"
                  onClick={() => {
                    setAmount("");
                    setPayError("");
                    setPayOpen(true);
                  }}
                >
                  {kind === "customer" ? "تحصيل" : "سداد"}
                </button>
              ) : null}
            </div>

            <MobileSection title="الحركة">
              <div className="mobile-chip-row">
                {filterChips.map((c) => (
                  <MobileChip
                    key={c.id}
                    active={filter === c.id}
                    onClick={() => setFilter(c.id)}
                  >
                    {c.label}
                  </MobileChip>
                ))}
              </div>
              <div className="mobile-panel">
                {filtered.length === 0 ? (
                  <MobileEmpty message="لا توجد حركات" />
                ) : (
                  filtered.map((row) => {
                    const clickable =
                      !row.isOpening &&
                      !row.isPartyPayment &&
                      !row.isCrossApp &&
                      [
                        "sale",
                        "purchase",
                        "sale_return",
                        "purchase_return",
                      ].includes(row.type);
                    const showType =
                      filter === "all" ||
                      filter === "workshop" ||
                      filter === "plisse";
                    const invoiceRemaining =
                      clickable &&
                      (row.type === "sale" || row.type === "purchase")
                        ? Math.max(
                            0,
                            Number(row.total) - Number(row.paid_amount || 0)
                          )
                        : null;
                    const typeBit = showType
                      ? `${invoiceTypeLabel(row.type, row.sourceSystem)} · `
                      : "";
                    const remainBit =
                      invoiceRemaining != null && invoiceRemaining > 0.001
                        ? ` · متبقي ${formatCurrency(invoiceRemaining)}`
                        : invoiceRemaining != null && invoiceRemaining <= 0.001
                          ? " · مسددة"
                          : "";
                    const noteBit =
                      row.isCrossApp && row.notes
                        ? ` · ${row.notes}`
                        : "";
                    return (
                      <MobileListRow
                        key={row.id}
                        title={row.invoice_number}
                        subtitle={`${typeBit}${formatDateRelative(row.created_at)}${remainBit}${noteBit}`}
                        amount={Number(row.total)}
                        amountTone={
                          row.type === "collection" ||
                          row.type === "sale_return" ||
                          row.type === "workshop_collection"
                            ? "positive"
                            : row.type === "disbursement" ||
                                row.type === "purchase_return" ||
                                row.type === "workshop_sale"
                              ? "negative"
                              : "muted"
                        }
                        onClick={
                          clickable
                            ? () => router.push(`/m/invoices/inv/${row.id}`)
                            : undefined
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

      <MobileSheet
        open={payOpen}
        title={kind === "customer" ? "تحصيل من عميل" : "سداد لمورد"}
        onClose={() => setPayOpen(false)}
      >
        <div className="mobile-field">
          <label>الخزنة</label>
          <select value={safeId} onChange={(e) => setSafeId(e.target.value)}>
            {safes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({formatCurrency(Number(s.balance))})
              </option>
            ))}
          </select>
        </div>
        <div className="mobile-field">
          <label>المبلغ</label>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={
              kind === "customer" ? "مبلغ التحصيل" : "مبلغ السداد"
            }
          />
          {openTotal > 0.001 ? (
            <button
              type="button"
              className="mt-2 text-[11px] font-bold text-[var(--primary)]"
              onClick={() => setAmount(String(openTotal))}
            >
              {kind === "customer" ? "تحصيل" : "سداد"} متبقي الفواتير (
              {formatCurrency(openTotal)})
            </button>
          ) : null}
          {party && Number(party.balance) > 0.001 ? (
            <button
              type="button"
              className="mt-1 block text-[11px] font-bold text-[var(--primary)]"
              onClick={() => setAmount(String(Number(party.balance)))}
            >
              {kind === "customer" ? "تحصيل" : "سداد"} كامل الرصيد (
              {formatCurrency(Number(party.balance))})
            </button>
          ) : null}
        </div>
        {openTotal <= 0.001 ? (
          <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {kind === "customer"
              ? "تقدر تحصّل من غير فواتير — المبلغ هينزل من رصيد العميل / يتسجّل له على الحساب. مش لازم الفواتير تغطي الفلوس."
              : "تقدر تسدّد من غير فواتير — المبلغ هينزل من رصيد المورد / يتسجّل مقدم على الحساب. مش لازم الفواتير تغطي الفلوس."}
          </p>
        ) : (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            الرصيد اللي مش مربوط بفاتورة بيتغطى أولاً، وبعدين يتوزّع على الفواتير من
            الأقدم — عشان فاتورة متتقفلش والحساب لسه عليه فلوس.
          </p>
        )}
        {payPreview && Number(amount) > 0 ? (
          <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
            {payPreview.nonInvoiceCover > 0.001 ? (
              <p>
                من الحساب (من غير قفل فواتير):{" "}
                {formatCurrency(payPreview.nonInvoiceCover)}
              </p>
            ) : null}
            {payPreview.allocations.length > 0 ? (
              <p>
                على الفواتير: {formatCurrency(payPreview.towardInvoices)} (
                {payPreview.allocations.length} فاتورة
                {payPreview.allocations.some((a) => a.remainingAfter <= 0.001)
                  ? " — فيه فواتير هتتسدد كامل"
                  : ""}
                )
              </p>
            ) : Number(amount) > 0.001 &&
              payPreview.nonInvoiceCover <= 0.001 ? (
              <p>
                {kind === "customer"
                  ? "المبلغ هيتسجّل على حساب العميل من غير توزيع على فواتير."
                  : "المبلغ هيتسجّل على حساب المورد من غير توزيع على فواتير."}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="mobile-field">
          <label>ملاحظة</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {payError ? (
          <p className="mb-3 text-sm font-bold text-[var(--danger)]">{payError}</p>
        ) : null}
        <button
          type="button"
          className="mobile-btn mobile-btn--primary"
          disabled={saving}
          onClick={submitPayment}
        >
          {saving ? "جاري الحفظ..." : "تأكيد"}
        </button>
      </MobileSheet>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  HandCoins,
  MinusCircle,
  PlusCircle,
  Truck,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, profileSubject } from "@/lib/permissions";
import {
  applySafeMovement,
  pickDefaultSafeId,
  transferBetweenSafes,
} from "@/lib/safe-transactions";
import {
  ensureExpenseAccounts,
  type ExpenseListItem,
} from "@/lib/expenses";
import {
  applyPartyPaymentOnlineOrQueue,
  createExpenseOnlineOrQueue,
  getSnapshot,
  listActiveEntities,
} from "@/lib/offline";
import { useOffline } from "@/components/offline/OfflineProvider";
import { normalizeActiveSafes } from "@/lib/safes-order";
import { formatCurrency, formatDateShort } from "@/lib/utils";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import {
  MobileChip,
  MobileEmpty,
  MobileListRow,
  MobileSection,
  MobileSheet,
  MobileSkeleton,
} from "@/components/mobile/MobileUI";
import type { Account, Customer, Safe, Supplier } from "@/types";

type SheetKind =
  | "deposit"
  | "withdraw"
  | "transfer"
  | "expense"
  | "collect"
  | "pay_supplier"
  | null;

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: "إيداع",
  withdrawal: "سحب",
  transfer: "تحويل",
};

export default function MobileFinancePage() {
  const supabase = useMemo(() => createClient(), []);
  const { online } = useOffline();
  const { profile, loading: authLoading } = useAuth();
  const subject = profileSubject(profile);
  const canTreasury = canAccess(subject, "treasury");
  const canExpenses = canAccess(subject, "expenses");
  const canCustomers =
    canAccess(subject, "customers") ||
    canAccess(subject, "customers.write") ||
    canAccess(subject, "treasury");
  const canSuppliers =
    canAccess(subject, "suppliers") || canAccess(subject, "treasury");

  const [loading, setLoading] = useState(true);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [feedError, setFeedError] = useState("");
  const [txRows, setTxRows] = useState<
    {
      id: string;
      type: string;
      amount: number;
      description: string | null;
      created_at: string;
      safe?: { name?: string };
    }[]
  >([]);

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feed, setFeed] = useState<"tx" | "expenses">("tx");

  const activeFeed: "tx" | "expenses" =
    feed === "expenses" && canExpenses
      ? "expenses"
      : canTreasury
        ? "tx"
        : "expenses";

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [safeId, setSafeId] = useState("");
  const [toSafeId, setToSafeId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [partyId, setPartyId] = useState("");

  const load = useCallback(async () => {
    const offline = !online || !navigator.onLine;

    function mapLocalSafes(
      rows: Array<{
        id: string;
        name: string;
        balance: number;
        is_active?: boolean;
        sort_order?: number | null;
      }>
    ): Safe[] {
      return normalizeActiveSafes(
        rows.map(
          (s) =>
            ({
              id: s.id,
              name: s.name,
              balance: s.balance,
              is_active: s.is_active !== false,
              sort_order: s.sort_order ?? undefined,
              created_at: "",
            }) as Safe
        )
      );
    }

    async function loadTxFromLocal(safeNameById: Map<string, string>) {
      if (!canTreasury) {
        setTxRows([]);
        return;
      }
      const txs = await listActiveEntities("safe_transactions");
      const rows = txs
        .map((t) => ({
          id: String(t.id),
          type: String(t.type || ""),
          amount: Number(t.amount) || 0,
          description:
            (t.description as string | null) ||
            (t.notes as string | null) ||
            null,
          created_at: String(t.created_at || ""),
          safe: {
            name: safeNameById.get(String(t.safe_id)) || "خزنة",
          },
        }))
        .filter((t) => t.id && t.created_at)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        .slice(0, 40);
      setTxRows(rows);
    }

    if (offline) {
      const snap = await getSnapshot();
      const localSafes = canTreasury
        ? mapLocalSafes(snap?.safes || [])
        : [];
      setSafes(localSafes);
      if (canCustomers) {
        setCustomers(
          (snap?.customers || [])
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
        );
      }
      if (canSuppliers) {
        setSuppliers(
          (snap?.suppliers || [])
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
        );
      }
      const def = pickDefaultSafeId(localSafes);
      if (def) setSafeId((prev) => prev || def);
      if (localSafes[1]) setToSafeId((prev) => prev || localSafes[1].id);

      const nameById = new Map(
        localSafes.map((s) => [s.id, s.name] as const)
      );
      await loadTxFromLocal(nameById);
      if (canExpenses) {
        try {
          const { listExpensesLocal } = await import("@/lib/offline");
          setExpenses(await listExpensesLocal(20));
        } catch {
          setExpenses([]);
        }
      }
      return;
    }

    // Online: one authenticated feed API (avoids PostgREST embed failures).
    try {
      const res = await fetch("/api/mobile/treasury-feed", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        safes?: Safe[];
        transactions?: Array<{
          id: string;
          type: string;
          amount: number;
          description: string | null;
          created_at: string;
          safe_name?: string;
        }>;
        expenses?: Array<{
          entry_id: string;
          expense_account_name: string;
          amount: number;
          date: string;
          safe_name: string;
          created_at?: string;
        }>;
      };

      if (!res.ok || !json.ok) {
        throw new Error(json.error || `تعذر تحميل المالية (${res.status})`);
      }

      const nextSafes = normalizeActiveSafes(json.safes || []);
      setSafes(nextSafes);
      const def = pickDefaultSafeId(nextSafes);
      if (def) setSafeId((prev) => prev || def);
      if (nextSafes[1]) setToSafeId((prev) => prev || nextSafes[1].id);

      setTxRows(
        (json.transactions || [])
          .filter((t) => t.id)
          .map((t) => ({
            id: t.id,
            type: t.type,
            amount: t.amount,
            description: t.description,
            created_at: t.created_at || new Date().toISOString(),
            safe: { name: t.safe_name || "خزنة" },
          }))
      );

      if (canExpenses) {
        setExpenses(
          (json.expenses || []).map((e) => ({
            entry_id: e.entry_id,
            entry_number: "",
            date: e.date,
            description: e.expense_account_name,
            amount: e.amount,
            expense_account_id: "",
            expense_account_code: "",
            expense_account_name: e.expense_account_name,
            safe_id: "",
            safe_name: e.safe_name,
            safe_transaction_id: e.entry_id,
            created_at: e.created_at || e.date,
          }))
        );
        await ensureExpenseAccounts(supabase);
        const { data: accounts } = await supabase
          .from("accounts")
          .select("*")
          .eq("type", "expense")
          .eq("is_active", true)
          .order("code");
        setExpenseAccounts((accounts || []) as Account[]);
        if (accounts?.[0]) {
          setExpenseAccountId((prev) => prev || accounts[0].id);
        }
      }

      // Parties still needed for collect/pay sheets
      const [custRes, suppRes] = await Promise.all([
        canCustomers
          ? supabase
              .from("customers")
              .select("*")
              .eq("is_active", true)
              .order("name")
              .limit(200)
          : Promise.resolve({ data: [] as Customer[], error: null }),
        canSuppliers
          ? supabase
              .from("suppliers")
              .select("*")
              .eq("is_active", true)
              .order("name")
              .limit(200)
          : Promise.resolve({ data: [] as Supplier[], error: null }),
      ]);
      setCustomers((custRes.data || []) as Customer[]);
      setSuppliers((suppRes.data || []) as Supplier[]);
      setFeedError("");
    } catch (err) {
      console.warn("[mobile/finance] network load failed", err);
      setFeedError(
        err instanceof Error ? err.message : "تعذر تحميل آخر الحركات"
      );
      // Fall back to local catalog so the page still opens offline-ish.
      const snap = await getSnapshot();
      const localSafes = canTreasury ? mapLocalSafes(snap?.safes || []) : [];
      if (localSafes.length) setSafes(localSafes);
      const nameById = new Map(
        localSafes.map((s) => [s.id, s.name] as const)
      );
      await loadTxFromLocal(nameById);
    }
  }, [
    canCustomers,
    canExpenses,
    canSuppliers,
    canTreasury,
    online,
    supabase,
  ]);

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

  function openSheet(kind: SheetKind) {
    setError("");
    setAmount("");
    setDescription("");
    setPartyId("");
    setSheet(kind);
  }

  async function submitSheet() {
    setSaving(true);
    setError("");
    try {
      const value = Number(amount);
      if (!value || value <= 0) throw new Error("أدخل مبلغاً صحيحاً");

      if (sheet === "deposit" || sheet === "withdraw") {
        if (!canTreasury) throw new Error("لا تملك صلاحية الخزينة");
        await applySafeMovement(supabase, {
          safeId,
          type: sheet === "deposit" ? "deposit" : "withdrawal",
          amount: value,
          description: description || (sheet === "deposit" ? "إيداع" : "سحب"),
        });
      } else if (sheet === "transfer") {
        if (!canTreasury) throw new Error("لا تملك صلاحية الخزينة");
        await transferBetweenSafes(supabase, {
          fromSafeId: safeId,
          toSafeId,
          amount: value,
          description: description || "تحويل بين الخزائن",
        });
      } else if (sheet === "expense") {
        if (!canExpenses) throw new Error("لا تملك صلاحية المصروفات");
        const today = new Date().toISOString().slice(0, 10);
        const { error: expErr, offline } = await createExpenseOnlineOrQueue(
          supabase,
          {
            date: today,
            amount: value,
            description,
            expenseAccountId,
            safeId,
            createdBy: profile?.id,
            createdAt: new Date().toISOString(),
          }
        );
        if (expErr) throw new Error(expErr);
        if (offline) {
          /* queued */
        }
      } else if (sheet === "collect" || sheet === "pay_supplier") {
        const kind = sheet === "collect" ? "customer" : "supplier";
        if (kind === "customer" && !canCustomers) {
          throw new Error("تحصيل/سداد الأطراف غير مسموح لصلاحياتك");
        }
        if (kind === "supplier" && !canSuppliers) {
          throw new Error("تحصيل/سداد الأطراف غير مسموح لصلاحياتك");
        }
        if (!partyId) throw new Error("اختر الطرف");
        const party =
          kind === "customer"
            ? customers.find((c) => c.id === partyId)
            : suppliers.find((s) => s.id === partyId);
        if (!party) throw new Error("الطرف غير موجود");
        await applyPartyPaymentOnlineOrQueue(supabase, {
          kind,
          partyId,
          partyName: party.name,
          amount: value,
          safeId,
          notes: description,
          createdAt: new Date().toISOString(),
        });
      }

      setSheet(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إتمام العملية");
    } finally {
      setSaving(false);
    }
  }

  const totalCash = safes.reduce((s, x) => s + Number(x.balance || 0), 0);

  return (
    <>
      <MobileHeader title="المالية" subtitle="خزن · مصروف · تحصيل" />
      <div className="mobile-page">
        {authLoading || loading ? (
          <MobileSkeleton rows={6} />
        ) : (
          <>
            {canTreasury ? (
              <div className="mobile-money-hero mb-4 mobile-money-hero--cash">
                <p className="mobile-money-hero__label">إجمالي النقدية</p>
                <p className="mobile-money-hero__amount">
                  {formatCurrency(totalCash)}
                </p>
                <p className="mobile-money-hero__note">
                  {safes.length > 0
                    ? `${safes.length} خزنة نشطة`
                    : "لا توجد خزائن"}
                </p>
              </div>
            ) : null}

            {canCustomers || canSuppliers ? (
              <div className="mobile-action-group">
                <p className="mobile-action-group__label">التحصيل والسداد</p>
                <div className="mobile-action-grid">
                  {canCustomers ? (
                    <button
                      type="button"
                      className="mobile-action-card mobile-action-card--collect"
                      onClick={() => openSheet("collect")}
                    >
                      <span className="mobile-action-card__icon" aria-hidden>
                        <HandCoins className="h-5 w-5" />
                      </span>
                      <span className="mobile-action-card__title">
                        تحصيل عميل
                      </span>
                      <span className="mobile-action-card__hint">
                        مستحقات أو رصيد مقدم على الحساب
                      </span>
                    </button>
                  ) : null}
                  {canSuppliers ? (
                    <button
                      type="button"
                      className="mobile-action-card mobile-action-card--pay"
                      onClick={() => openSheet("pay_supplier")}
                    >
                      <span className="mobile-action-card__icon" aria-hidden>
                        <Truck className="h-5 w-5" />
                      </span>
                      <span className="mobile-action-card__title">
                        سداد مورد
                      </span>
                      <span className="mobile-action-card__hint">
                        دفع مستحقات للمورد
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {canExpenses ? (
              <div className="mobile-action-group">
                <p className="mobile-action-group__label">المصروفات</p>
                <button
                  type="button"
                  className="mobile-action-card mobile-action-card--expense mobile-action-card--wide"
                  onClick={() => openSheet("expense")}
                >
                  <span className="mobile-action-card__icon" aria-hidden>
                    <Wallet className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1 text-start">
                    <span className="mobile-action-card__title">
                      تسجيل مصروف
                    </span>
                    <span className="mobile-action-card__hint">
                      إيجار · كهرباء · مصروفات أخرى
                    </span>
                  </span>
                </button>
              </div>
            ) : null}

            {canTreasury ? (
              <div className="mobile-action-group">
                <p className="mobile-action-group__label">عمليات الخزنة</p>
                <div className="mobile-action-grid mobile-action-grid--triple">
                  <button
                    type="button"
                    className="mobile-action-card mobile-action-card--deposit"
                    onClick={() => openSheet("deposit")}
                  >
                    <span className="mobile-action-card__icon" aria-hidden>
                      <PlusCircle className="h-5 w-5" />
                    </span>
                    <span className="mobile-action-card__title">إيداع</span>
                    <span className="mobile-action-card__hint">
                      إضافة فلوس للخزنة
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mobile-action-card mobile-action-card--withdraw"
                    onClick={() => openSheet("withdraw")}
                  >
                    <span className="mobile-action-card__icon" aria-hidden>
                      <MinusCircle className="h-5 w-5" />
                    </span>
                    <span className="mobile-action-card__title">سحب</span>
                    <span className="mobile-action-card__hint">
                      إخراج فلوس من الخزنة
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mobile-action-card mobile-action-card--transfer"
                    onClick={() => openSheet("transfer")}
                  >
                    <span className="mobile-action-card__icon" aria-hidden>
                      <ArrowLeftRight className="h-5 w-5" />
                    </span>
                    <span className="mobile-action-card__title">تحويل</span>
                    <span className="mobile-action-card__hint">
                      بين الخزائن
                    </span>
                  </button>
                </div>
              </div>
            ) : null}

            {canTreasury && safes.length > 0 ? (
              <MobileSection title="الخزائن">
                <div className="mobile-panel">
                  {safes.map((s) => (
                    <MobileListRow
                      key={`safe-${s.id}`}
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
              <div className="mobile-chip-row">
                {canTreasury ? (
                  <MobileChip
                    active={activeFeed === "tx"}
                    onClick={() => setFeed("tx")}
                  >
                    نقدية
                  </MobileChip>
                ) : null}
                {canExpenses ? (
                  <MobileChip
                    active={activeFeed === "expenses"}
                    onClick={() => setFeed("expenses")}
                  >
                    مصروفات
                  </MobileChip>
                ) : null}
              </div>
              {feedError ? (
                <p className="mb-2 px-1 text-xs font-bold text-[var(--danger)]">
                  {feedError}
                </p>
              ) : null}
              <div className="mobile-panel">
                {activeFeed === "tx" ? (
                  txRows.length === 0 ? (
                    <MobileEmpty message="لا توجد حركات نقدية" />
                  ) : (
                    txRows.map((t) => (
                      <MobileListRow
                        key={`tx-${t.id}`}
                        title={
                          t.description ||
                          TX_TYPE_LABELS[t.type] ||
                          t.type
                        }
                        subtitle={`${t.safe?.name || "خزنة"} · ${formatDateShort(t.created_at)}`}
                        amount={Number(t.amount)}
                        amountTone={
                          t.type === "deposit"
                            ? "positive"
                            : t.type === "transfer"
                              ? "muted"
                              : "negative"
                        }
                      />
                    ))
                  )
                ) : expenses.length === 0 ? (
                  <MobileEmpty message="لا توجد مصروفات" />
                ) : (
                  expenses.map((e) => (
                    <MobileListRow
                      key={e.entry_id}
                      title={e.expense_account_name}
                      subtitle={`${e.safe_name} · ${formatDateShort(e.date)}`}
                      amount={e.amount}
                      amountTone="negative"
                    />
                  ))
                )}
              </div>
            </MobileSection>
          </>
        )}
      </div>

      <MobileSheet
        open={sheet != null}
        variant="page"
        title={
          sheet === "deposit"
            ? "إيداع نقدي"
            : sheet === "withdraw"
              ? "سحب نقدي"
              : sheet === "transfer"
                ? "تحويل بين الخزائن"
                : sheet === "expense"
                  ? "تسجيل مصروف"
                  : sheet === "collect"
                    ? "تحصيل من عميل"
                    : sheet === "pay_supplier"
                      ? "سداد لمورد"
                      : ""
        }
        onClose={() => setSheet(null)}
      >
        {(sheet === "deposit" ||
          sheet === "withdraw" ||
          sheet === "transfer" ||
          sheet === "expense" ||
          sheet === "collect" ||
          sheet === "pay_supplier") && (
          <>
            {(sheet === "collect" || sheet === "pay_supplier") && (
              <>
                <div className="mobile-field">
                  <label>{sheet === "collect" ? "العميل" : "المورد"}</label>
                  <select
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                  >
                    <option value="">اختر...</option>
                    {(sheet === "collect" ? customers : suppliers).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCurrency(Math.abs(Number(p.balance)))})
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  {sheet === "collect"
                    ? "تقدر تحصّل في أي وقت — لو مفيش فواتير مفتوحة المبلغ يتسجّل على حساب العميل. لو فيه رصيد افتتاحي بيتغطى قبل قفل أي فاتورة."
                    : "تقدر تسدّد في أي وقت — لو مفيش فواتير مفتوحة المبلغ يتسجّل مقدم للمورد. لو فيه رصيد افتتاحي بيتغطى قبل قفل أي فاتورة."}
                </p>
              </>
            )}

            {sheet === "expense" && (
              <div className="mobile-field">
                <label>حساب المصروف</label>
                <select
                  value={expenseAccountId}
                  onChange={(e) => setExpenseAccountId(e.target.value)}
                >
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mobile-field">
              <label>
                {sheet === "transfer" ? "من خزنة" : "الخزنة"}
              </label>
              <select
                value={safeId}
                onChange={(e) => setSafeId(e.target.value)}
              >
                {safes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({formatCurrency(Number(s.balance))})
                  </option>
                ))}
              </select>
            </div>

            {sheet === "transfer" && (
              <div className="mobile-field">
                <label>إلى خزنة</label>
                <select
                  value={toSafeId}
                  onChange={(e) => setToSafeId(e.target.value)}
                >
                  {safes
                    .filter((s) => s.id !== safeId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div className="mobile-field">
              <label>المبلغ</label>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="mobile-field">
              <label>ملاحظة</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="اختياري"
              />
            </div>

            {error ? (
              <p className="mb-3 text-sm font-bold text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              className="mobile-btn mobile-btn--primary"
              disabled={saving}
              onClick={submitSheet}
            >
              {saving ? "جاري الحفظ..." : "تأكيد"}
            </button>
          </>
        )}
      </MobileSheet>
    </>
  );
}

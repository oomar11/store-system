"use client";

/**
 * Mobile finance — rebuilt clean.
 * Transfer mirrors desktop: pick two vaults by live server ids + names,
 * then POST /api/treasury/transfer (service-role path on the server).
 */

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
  fetchSafesForTransfer,
} from "@/lib/safe-transactions";
import {
  ensureExpenseAccounts,
  EXPENSE_REFERENCE_TYPE,
  type ExpenseListItem,
} from "@/lib/expenses";
import {
  applyPartyPaymentOnlineOrQueue,
  createExpenseOnlineOrQueue,
  getSnapshot,
  listActiveEntities,
} from "@/lib/offline";
import {
  fetchOpenInvoicesForParty,
  previewPartyPaymentAllocation,
  type OpenInvoiceForPayment,
} from "@/lib/party-payments";
import { normalizeActiveSafes, safesOrderQuery } from "@/lib/safes-order";
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

type TxRow = {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
  safeName: string;
};

type TransferSafe = {
  id: string;
  name: string;
  balance: number;
  tag: "" | "deleted" | "inactive";
};

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: "إيداع",
  withdrawal: "سحب",
  transfer: "تحويل",
};

function sheetTitle(sheet: SheetKind): string {
  switch (sheet) {
    case "deposit":
      return "إيداع نقدي";
    case "withdraw":
      return "سحب نقدي";
    case "transfer":
      return "تحويل بين الخزائن";
    case "expense":
      return "تسجيل مصروف";
    case "collect":
      return "تحصيل من عميل";
    case "pay_supplier":
      return "سداد لمورد";
    default:
      return "";
  }
}

function asSafe(row: {
  id: string;
  name: string;
  balance: number;
  is_active?: boolean;
  sort_order?: number | null;
}): Safe {
  return {
    id: row.id,
    name: row.name,
    balance: row.balance,
    is_active: row.is_active !== false,
    sort_order: row.sort_order ?? undefined,
    created_at: "",
  } as Safe;
}

export default function MobileFinancePage() {
  const supabase = useMemo(() => createClient(), []);
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
  const [feedError, setFeedError] = useState("");
  const [safes, setSafes] = useState<Safe[]>([]);
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [feed, setFeed] = useState<"tx" | "expenses">("tx");
  const activeFeed: "tx" | "expenses" =
    feed === "expenses" && canExpenses
      ? "expenses"
      : canTreasury
        ? "tx"
        : "expenses";

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [safeId, setSafeId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceForPayment[]>([]);

  // Transfer-only state — never mixed with offline/display safes.
  const [transferSafes, setTransferSafes] = useState<TransferSafe[]>([]);
  const [fromSafeId, setFromSafeId] = useState("");
  const [toSafeId, setToSafeId] = useState("");

  const load = useCallback(async () => {
    const browserOffline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    setFeedError("");

    async function loadLocal() {
      const snap = await getSnapshot();
      const localSafes = canTreasury
        ? normalizeActiveSafes(
            (snap?.safes || []).map((s) =>
              asSafe({
                id: String(s.id),
                name: String(s.name || ""),
                balance: Number(s.balance) || 0,
                is_active: s.is_active !== false,
                sort_order: s.sort_order ?? null,
              })
            ),
            { dedupeByName: true }
          )
        : [];
      if (localSafes.length) {
        setSafes(localSafes);
        setSafeId((prev) =>
          localSafes.some((s) => s.id === prev) ? prev : localSafes[0].id
        );
      }

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
                  is_active: true,
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
                  is_active: true,
                  created_at: "",
                }) as Supplier
            )
        );
      }

      if (canTreasury) {
        const nameById = new Map(
          localSafes.map((s) => [s.id, s.name] as const)
        );
        const txs = await listActiveEntities("safe_transactions");
        setTxRows(
          txs
            .map((t) => ({
              id: String(t.id),
              type: String(t.type || ""),
              amount: Number(t.amount) || 0,
              description:
                (t.description as string | null) ||
                (t.notes as string | null) ||
                null,
              created_at: String(t.created_at || ""),
              safeName: nameById.get(String(t.safe_id)) || "خزنة",
            }))
            .filter((t) => t.id && t.created_at)
            .sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
            )
            .slice(0, 40)
        );
      } else {
        setTxRows([]);
      }
    }

    if (browserOffline) {
      setFeedError("أنت غير متصل — عرض البيانات المحلية");
      await loadLocal();
      return;
    }

    try {
      const [safesRes, txRes, expenseTxRes, custRes, suppRes] =
        await Promise.all([
          canTreasury
            ? safesOrderQuery(
                supabase
                  .from("safes")
                  .select("*")
                  .eq("is_active", true)
                  .is("deleted_at", null)
              ).then(async (res) => {
                if (res.error && /deleted_at/i.test(res.error.message || "")) {
                  return safesOrderQuery(
                    supabase.from("safes").select("*").eq("is_active", true)
                  );
                }
                return res;
              })
            : Promise.resolve({ data: [] as Safe[], error: null }),
          canTreasury
            ? supabase
                .from("safe_transactions")
                .select(
                  "id, type, amount, description, notes, created_at, safe_id"
                )
                .order("created_at", { ascending: false })
                .limit(50)
            : Promise.resolve({ data: [] as unknown[], error: null }),
          canExpenses
            ? supabase
                .from("safe_transactions")
                .select(
                  "id, type, amount, description, notes, created_at, safe_id, reference_id, reference_type"
                )
                .eq("reference_type", EXPENSE_REFERENCE_TYPE)
                .eq("type", "withdrawal")
                .order("created_at", { ascending: false })
                .limit(30)
            : Promise.resolve({ data: [] as unknown[], error: null }),
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

      if (safesRes.error) {
        throw new Error(safesRes.error.message || "تعذر تحميل الخزائن");
      }
      if (txRes.error) {
        throw new Error(txRes.error.message || "تعذر تحميل الحركات");
      }

      const nextSafes = normalizeActiveSafes((safesRes.data || []) as Safe[], {
        dedupeByName: false,
      });
      setSafes(nextSafes);
      setSafeId((prev) =>
        nextSafes.some((s) => s.id === prev) ? prev : nextSafes[0]?.id || ""
      );

      const nameById = new Map(
        nextSafes.map((s) => [String(s.id), String(s.name || "خزنة")] as const)
      );

      const txData = (txRes.data || []) as Array<{
        id: string;
        type: string;
        amount: number;
        description: string | null;
        notes: string | null;
        created_at: string;
        safe_id: string | null;
      }>;
      setTxRows(
        txData
          .filter((t) => t.id)
          .map((t) => ({
            id: String(t.id),
            type: String(t.type || ""),
            amount: Number(t.amount) || 0,
            description: t.description || t.notes || null,
            created_at: t.created_at || new Date().toISOString(),
            safeName: nameById.get(String(t.safe_id)) || "خزنة",
          }))
      );

      if (canExpenses) {
        const expenseRows = (
          expenseTxRes.error ? [] : expenseTxRes.data || []
        ) as Array<{
          id: string;
          amount: number;
          description: string | null;
          notes: string | null;
          created_at: string;
          safe_id: string | null;
          reference_id: string | null;
        }>;
        setExpenses(
          expenseRows.map((e) => ({
            entry_id: String(e.reference_id || e.id),
            entry_number: "",
            date: String(e.created_at || "").slice(0, 10),
            description: e.description || e.notes || "مصروف",
            amount: Number(e.amount) || 0,
            expense_account_id: "",
            expense_account_code: "",
            expense_account_name: e.description || e.notes || "مصروف",
            safe_id: String(e.safe_id || ""),
            safe_name: nameById.get(String(e.safe_id)) || "خزنة",
            safe_transaction_id: String(e.id),
            created_at: e.created_at || "",
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

      setCustomers((custRes.data || []) as Customer[]);
      setSuppliers((suppRes.data || []) as Supplier[]);
      setFeedError("");
    } catch (err) {
      console.warn("[mobile/finance] load failed", err);
      setFeedError(
        err instanceof Error ? err.message : "تعذر تحميل آخر الحركات"
      );
      await loadLocal();
    }
  }, [
    canCustomers,
    canExpenses,
    canSuppliers,
    canTreasury,
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

  useEffect(() => {
    if (sheet !== "collect" && sheet !== "pay_supplier") return;
    if (!partyId) return;
    let cancelled = false;
    const kind = sheet === "collect" ? "customer" : "supplier";
    void fetchOpenInvoicesForParty(supabase, kind, partyId)
      .then((open) => {
        if (!cancelled) setOpenInvoices(open);
      })
      .catch(() => {
        if (!cancelled) setOpenInvoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [partyId, sheet, supabase]);

  const payPreview = useMemo(() => {
    if (sheet !== "collect" && sheet !== "pay_supplier") return null;
    const value = Number(amount) || 0;
    if (!partyId || value <= 0) return null;
    const party =
      sheet === "collect"
        ? customers.find((c) => c.id === partyId)
        : suppliers.find((s) => s.id === partyId);
    if (!party) return null;
    return previewPartyPaymentAllocation(
      openInvoices,
      value,
      Number(party.balance) || 0
    );
  }, [amount, customers, openInvoices, partyId, sheet, suppliers]);

  function resetSheetFields() {
    setError("");
    setAmount("");
    setDescription("");
    setPartyId("");
    setOpenInvoices([]);
    setTransferSafes([]);
    setFromSafeId("");
    setToSafeId("");
  }

  async function openSheet(kind: SheetKind) {
    resetSheetFields();

    if (kind === "transfer") {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setFeedError("التحويل بين الخزائن يحتاج اتصال بالإنترنت");
        return;
      }
      try {
        const live = await fetchSafesForTransfer(supabase);
        if (live.length < 2) {
          setFeedError("يلزم خزنتان على الأقل للتحويل");
          return;
        }
        setFeedError("");
        const list: TransferSafe[] = live.map((s) => ({
          id: String(s.id),
          name: String(s.name || ""),
          balance: Number(s.balance) || 0,
          tag: s.deleted_at
            ? "deleted"
            : s.is_active === false
              ? "inactive"
              : "",
        }));
        setTransferSafes(list);
        setFromSafeId(list[0].id);
        setToSafeId(list[1].id);
        setSheet("transfer");
        return;
      } catch (e) {
        setFeedError(
          e instanceof Error ? e.message : "تعذر تحميل الخزائن للتحويل"
        );
        return;
      }
    }

    if (safes.length && !safes.some((s) => s.id === safeId)) {
      setSafeId(safes[0].id);
    }
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
        if (!safeId) throw new Error("اختر خزنة");
        await applySafeMovement(supabase, {
          safeId,
          type: sheet === "deposit" ? "deposit" : "withdrawal",
          amount: value,
          description: description || (sheet === "deposit" ? "إيداع" : "سحب"),
        });
      } else if (sheet === "transfer") {
        if (!canTreasury) throw new Error("لا تملك صلاحية الخزينة");
        if (!fromSafeId || !toSafeId) {
          throw new Error("اختر خزنتين مختلفتين للتحويل");
        }
        if (fromSafeId === toSafeId) {
          throw new Error("اختر خزنتين مختلفتين للتحويل");
        }
        const fromSafe = transferSafes.find((s) => s.id === fromSafeId);
        const toSafe = transferSafes.find((s) => s.id === toSafeId);
        if (!fromSafe || !toSafe) {
          throw new Error("حدّث الصفحة واختر الخزائن من جديد");
        }

        const res = await fetch("/api/treasury/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({
            fromSafeId: fromSafe.id,
            toSafeId: toSafe.id,
            fromSafeName: fromSafe.name,
            toSafeName: toSafe.name,
            amount: value,
            description: description || "تحويل بين الخزائن",
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(payload.error || "تعذر إتمام التحويل بين الخزائن");
        }
      } else if (sheet === "expense") {
        if (!canExpenses) throw new Error("لا تملك صلاحية المصروفات");
        if (!safeId) throw new Error("اختر خزنة");
        const today = new Date().toISOString().slice(0, 10);
        const { error: expErr } = await createExpenseOnlineOrQueue(supabase, {
          date: today,
          amount: value,
          description,
          expenseAccountId,
          safeId,
          createdBy: profile?.id,
          createdAt: new Date().toISOString(),
        });
        if (expErr) throw new Error(expErr);
      } else if (sheet === "collect" || sheet === "pay_supplier") {
        const kind = sheet === "collect" ? "customer" : "supplier";
        if (kind === "customer" && !canCustomers) {
          throw new Error("تحصيل/سداد الأطراف غير مسموح لصلاحياتك");
        }
        if (kind === "supplier" && !canSuppliers) {
          throw new Error("تحصيل/سداد الأطراف غير مسموح لصلاحياتك");
        }
        if (!partyId) throw new Error("اختر الطرف");
        if (!safeId) throw new Error("اختر خزنة");
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
      resetSheetFields();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إتمام العملية");
    } finally {
      setSaving(false);
    }
  }

  const totalCash = safes.reduce((sum, s) => sum + Number(s.balance || 0), 0);
  const fromSafe = transferSafes.find((s) => s.id === fromSafeId);
  const toSafe = transferSafes.find((s) => s.id === toSafeId);
  const toOptions = transferSafes.filter((s) => s.id !== fromSafeId);

  function safeOptionLabel(s: TransferSafe | Safe, tag?: TransferSafe["tag"]) {
    const suffix =
      tag === "deleted" ? " — محذوفة" : tag === "inactive" ? " — موقوفة" : "";
    return `${s.name}${suffix} (${formatCurrency(Number(s.balance))})`;
  }

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
                      onClick={() => void openSheet("collect")}
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
                      onClick={() => void openSheet("pay_supplier")}
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
                  onClick={() => void openSheet("expense")}
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
                    onClick={() => void openSheet("deposit")}
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
                    onClick={() => void openSheet("withdraw")}
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
                    onClick={() => void openSheet("transfer")}
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
                          t.description || TX_TYPE_LABELS[t.type] || t.type
                        }
                        subtitle={`${t.safeName} · ${formatDateShort(t.created_at)}`}
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
        title={sheetTitle(sheet)}
        onClose={() => {
          setSheet(null);
          resetSheetFields();
        }}
      >
        {sheet ? (
          <>
            {(sheet === "collect" || sheet === "pay_supplier") && (
              <>
                <div className="mobile-field">
                  <label>{sheet === "collect" ? "العميل" : "المورد"}</label>
                  <select
                    value={partyId}
                    onChange={(e) => {
                      setPartyId(e.target.value);
                      setOpenInvoices([]);
                    }}
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
                    ? "تقدر تحصّل أي مبلغ — مش لازم الفواتير تغطي الفلوس. الزيادة تتتسجل رصيد على حساب العميل."
                    : "تقدر تسدّد أي مبلغ — مش لازم الفواتير تغطي الفلوس. الزيادة تتتسجل مقدم على حساب المورد."}
                </p>
              </>
            )}

            {sheet === "expense" ? (
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
            ) : null}

            {sheet === "transfer" ? (
              <>
                <div className="mobile-field">
                  <label>من خزنة</label>
                  <select
                    value={fromSafeId}
                    onChange={(e) => {
                      const nextFrom = e.target.value;
                      setFromSafeId(nextFrom);
                      setToSafeId((prev) =>
                        prev === nextFrom
                          ? transferSafes.find((s) => s.id !== nextFrom)?.id ||
                            ""
                          : prev
                      );
                    }}
                  >
                    {transferSafes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {safeOptionLabel(s, s.tag)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mobile-field">
                  <label>إلى خزنة</label>
                  <select
                    value={toSafeId}
                    onChange={(e) => setToSafeId(e.target.value)}
                  >
                    {toOptions.length === 0 ? (
                      <option value="">لا توجد خزنة أخرى</option>
                    ) : (
                      toOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {safeOptionLabel(s, s.tag)}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                {fromSafe && toSafe && fromSafe.id !== toSafe.id ? (
                  <p className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">
                    سيتم التحويل من «{fromSafe.name}» إلى «{toSafe.name}»
                  </p>
                ) : (
                  <p className="mb-3 text-xs font-semibold text-[var(--danger)]">
                    اختر خزنتين مختلفتين
                  </p>
                )}
              </>
            ) : (
              <div className="mobile-field">
                <label>الخزنة</label>
                <select
                  value={safeId}
                  onChange={(e) => setSafeId(e.target.value)}
                >
                  {safes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {safeOptionLabel(s)}
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

            {(sheet === "collect" || sheet === "pay_supplier") &&
            payPreview &&
            Number(amount) > 0 ? (
              <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                {payPreview.allocations.length > 0 ? (
                  <p>
                    على الفواتير: {formatCurrency(payPreview.towardInvoices)} (
                    {payPreview.allocations.length} فاتورة)
                  </p>
                ) : null}
                {payPreview.leftover > 0.001 ? (
                  <p className="text-emerald-800">
                    {sheet === "collect"
                      ? `رصيد على الحساب ${formatCurrency(payPreview.leftover)} — من غير ما الفواتير تغطي المبلغ كامل.`
                      : `مقدم للمورد ${formatCurrency(payPreview.leftover)} — من غير ما الفواتير تغطي المبلغ كامل.`}
                  </p>
                ) : null}
              </div>
            ) : null}

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
              onClick={() => void submitSheet()}
            >
              {saving ? "جاري الحفظ..." : "تأكيد"}
            </button>
          </>
        ) : null}
      </MobileSheet>
    </>
  );
}

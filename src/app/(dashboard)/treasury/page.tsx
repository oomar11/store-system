"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateRelative, smartSearchMatch } from "@/lib/utils";
import { useSort } from "@/hooks/useSort";
import { SortableHeader } from "@/components/ui/SortableHeader";
import type { RowAction } from "@/components/ui/TableRowActions";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { Modal } from "@/components/ui/Modal";
import { DateField } from "@/components/ui/DateField";
import { TodayDateChip } from "@/components/ui/TodayDateChip";
import { PrintReportPreview } from "@/components/print/PrintReportPreview";
import { PrintListButton } from "@/components/print/PrintListButton";
import { treasuryColumns } from "@/components/print/report-columns";
import type { Safe, SafeTransaction, Settings } from "@/types";
import { ArrowLeftRight, Landmark, Pencil, Plus, Power, Trash2 } from "lucide-react";
import {
  applySafeMovement,
  deleteManualSafeMovement,
  deleteSafeTransfer,
  isManualSafeMovement,
  transferBetweenSafes,
  updateManualSafeMovement,
  updateSafeTransfer,
} from "@/lib/safe-transactions";
import { guardSafeDelete } from "@/lib/delete-guards";
import { setEntitiesActive } from "@/lib/active-status";
import { logAuditEvent } from "@/lib/audit";
import { safesOrderQuery } from "@/lib/safes-order";
import { getSnapshot, isBrowserOnline, withTimeout } from "@/lib/offline";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const TYPE_LABELS: Record<SafeTransaction["type"], string> = {
  deposit: "إيداع",
  withdrawal: "سحب",
  transfer: "تحويل",
};

type TxRow = SafeTransaction & {
  creator_name?: string;
};

export default function TreasuryPage() {
  const [safes, setSafes] = useState<Safe[]>([]);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSafeForm, setShowSafeForm] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [editingTx, setEditingTx] = useState<TxRow | null>(null);
  const [editingSafe, setEditingSafe] = useState<Safe | null>(null);
  const [safeEditName, setSafeEditName] = useState("");
  const [editForm, setEditForm] = useState({
    safe_id: "",
    type: "deposit" as "deposit" | "withdrawal",
    amount: "",
    description: "",
    from_safe_id: "",
    to_safe_id: "",
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterSafe, setFilterSafe] = useState("");
  const [filterType, setFilterType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showListPrint, setShowListPrint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transferFromId, setTransferFromId] = useState("");
  const [transferToId, setTransferToId] = useState("");
  const supabase = createClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch = smartSearchMatch(searchTerm, [
      t.description,
      (t.safe as Safe | undefined)?.name,
      (t.related_safe as Safe | undefined)?.name,
    ]);
    const matchesSafe =
      !filterSafe || t.safe_id === filterSafe || t.related_safe_id === filterSafe;
    const matchesType = !filterType || t.type === filterType;
    const day = t.created_at.slice(0, 10);
    const matchesFrom = !dateFrom || day >= dateFrom;
    const matchesTo = !dateTo || day <= dateTo;
    return matchesSearch && matchesSafe && matchesType && matchesFrom && matchesTo;
  });

  const { items: sortedTransactions, sortConfig, requestSort } = useSort(filteredTransactions);

  const totalDeposits = sortedTransactions
    .filter((t) => t.type === "deposit")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalWithdrawals = sortedTransactions
    .filter((t) => t.type === "withdrawal")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalTransfers = sortedTransactions
    .filter((t) => t.type === "transfer")
    .reduce((sum, t) => sum + t.amount, 0);
  const netAmount = totalDeposits - totalWithdrawals;

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    if (!isBrowserOnline()) {
      const snap = await getSnapshot();
      if (snap?.safes?.length) setSafes(snap.safes as Safe[]);
      if (snap?.settings) setSettings(snap.settings as unknown as Settings);
      setTransactions([]);
      setLoading(false);
      return;
    }
    try {
      const [safesRes, transRes, settingsRes] = await withTimeout(
        Promise.all([
          safesOrderQuery(supabase.from("safes").select("*")),
          supabase
            .from("safe_transactions")
            .select(
              "*, safe:safes!safe_id(name), related_safe:safes!related_safe_id(name)"
            )
            .order("created_at", { ascending: false })
            .limit(500),
          supabase.from("settings").select("*").limit(1).maybeSingle(),
        ]),
        4000
      );
      if (safesRes.data) setSafes(safesRes.data);
      if (settingsRes.data) setSettings(settingsRes.data);
      if (transRes.data) {
        const rows = transRes.data as TxRow[];
        const ids = Array.from(
          new Set(rows.map((r) => r.created_by).filter(Boolean))
        );
        if (ids.length > 0) {
          try {
            const { data: profiles } = await withTimeout(
              Promise.resolve(
                supabase.from("profiles").select("id, full_name").in("id", ids)
              ) as Promise<{ data: { id: string; full_name: string }[] | null }>,
              2000
            );
            const names = new Map(
              (profiles || []).map((p) => [
                p.id as string,
                (p.full_name as string) || "",
              ])
            );
            for (const r of rows) {
              if (r.created_by) r.creator_name = names.get(r.created_by);
            }
          } catch {
            /* ignore profile names offline */
          }
        }
        setTransactions(rows);
      } else if (transRes.error) {
        const fallback = await withTimeout(
          Promise.resolve(
            supabase
              .from("safe_transactions")
              .select("*, safe:safes(name)")
              .order("created_at", { ascending: false })
              .limit(500)
          ) as Promise<{ data: TxRow[] | null }>,
          3000
        );
        if (fallback.data) setTransactions(fallback.data as TxRow[]);
      }
    } catch {
      const snap = await getSnapshot();
      if (snap?.safes?.length) setSafes(snap.safes as Safe[]);
      if (snap?.settings) setSettings(snap.settings as unknown as Settings);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddSafe(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = (formData.get("name") as string).trim();
    const opening_balance = Number(formData.get("opening_balance")) || 0;
    if (!name) return;

    if (
      safes.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())
    ) {
      toastError("يوجد خزنة بنفس الاسم مسبقاً");
      return;
    }

    const maxOrder = safes.reduce(
      (max, s) => Math.max(max, Number(s.sort_order) || 0),
      -1
    );

    const { data: safe, error } = await supabase
      .from("safes")
      .insert({
        name,
        balance: opening_balance,
        opening_balance,
        sort_order: maxOrder + 1,
      })
      .select("id")
      .single();

    if (error) {
      toastError(error.message);
      return;
    }

    if (safe && opening_balance > 0) {
      await supabase.from("safe_transactions").insert({
        safe_id: safe.id,
        type: "deposit",
        amount: opening_balance,
        description: "رصيد افتتاحي",
        reference_type: "opening",
      });
    }

    setShowSafeForm(false);
    fetchData();
  }

  async function handleAddTransaction(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const safe_id = formData.get("safe_id") as string;
    const type = formData.get("type") as "deposit" | "withdrawal";
    const amount = Number(formData.get("amount"));
    const description = (formData.get("description") as string) || "";

    if (!safe_id || !amount || amount <= 0) return;

    setBusy(true);
    try {
      await applySafeMovement(supabase, {
        safeId: safe_id,
        type,
        amount,
        description,
        referenceType: "manual",
      });
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "تعذر تسجيل الحركة");
      return;
    } finally {
      setBusy(false);
    }

    setShowTransactionForm(false);
    fetchData();
  }

  async function handleTransfer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const from_safe_id = formData.get("from_safe_id") as string;
    const to_safe_id = formData.get("to_safe_id") as string;
    const amount = Number(formData.get("amount"));
    const description = ((formData.get("description") as string) || "").trim();

    if (!from_safe_id || !to_safe_id || !amount || amount <= 0) return;
    if (from_safe_id === to_safe_id) {
      toastError("اختر خزنتين مختلفتين للتحويل");
      return;
    }

    setBusy(true);
    try {
      await transferBetweenSafes(supabase, {
        fromSafeId: from_safe_id,
        toSafeId: to_safe_id,
        amount,
        description,
      });
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "تعذر إتمام التحويل");
      return;
    } finally {
      setBusy(false);
    }

    setShowTransferForm(false);
    setTransferFromId("");
    setTransferToId("");
    fetchData();
  }

  function openEditTx(t: TxRow) {
    if (!isManualSafeMovement(t)) {
      toastError("لا يمكن تعديل حركة مرتبطة بفاتورة أو مصروف من هنا");
      return;
    }
    if (t.type === "transfer") {
      const isOut = t.reference_type === "transfer_out";
      setEditForm({
        safe_id: "",
        type: "deposit",
        amount: String(t.amount),
        description: t.description || "",
        from_safe_id: isOut ? t.safe_id : t.related_safe_id || "",
        to_safe_id: isOut ? t.related_safe_id || "" : t.safe_id,
      });
    } else {
      setEditForm({
        safe_id: t.safe_id,
        type: t.type as "deposit" | "withdrawal",
        amount: String(t.amount),
        description: t.description || "",
        from_safe_id: "",
        to_safe_id: "",
      });
    }
    setEditingTx(t);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTx) return;
    const amount = Number(editForm.amount);
    if (!amount || amount <= 0) {
      toastError("أدخل مبلغاً صحيحاً");
      return;
    }
    setBusy(true);
    try {
      if (editingTx.type === "transfer") {
        if (!editForm.from_safe_id || !editForm.to_safe_id) {
          throw new Error("اختر الخزنتين");
        }
        if (editForm.from_safe_id === editForm.to_safe_id) {
          throw new Error("اختر خزنتين مختلفتين");
        }
        await updateSafeTransfer(supabase, {
          transactionId: editingTx.id,
          fromSafeId: editForm.from_safe_id,
          toSafeId: editForm.to_safe_id,
          amount,
          description: editForm.description,
        });
      } else {
        if (!editForm.safe_id) throw new Error("اختر الخزنة");
        await updateManualSafeMovement(supabase, {
          transactionId: editingTx.id,
          safeId: editForm.safe_id,
          type: editForm.type,
          amount,
          description: editForm.description,
        });
      }
      setEditingTx(null);
      await fetchData();
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "تعذر التعديل");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteTx(t: TxRow) {
    if (!isManualSafeMovement(t)) {
      toastError("لا يمكن حذف حركة مرتبطة بفاتورة أو مصروف");
      return;
    }
    if (t.type === "transfer" && t.reference_type === "transfer_in") {
      toastError("احذف صف التحويل (خروج) لتعديل الزوج كاملاً");
      return;
    }
    if (
      !(await confirm({
        message: "حذف هذه الحركة؟ سيتم عكس تأثيرها على رصيد الخزنة.",
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      if (t.type === "transfer") {
        await deleteSafeTransfer(supabase, t.id);
      } else {
        await deleteManualSafeMovement(supabase, t.id);
      }
      toastSuccess("تم حذف الحركة");
      await fetchData();
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "تعذر الحذف");
    } finally {
      setBusy(false);
    }
  }

  function openEditSafe(safe: Safe) {
    setEditingSafe(safe);
    setSafeEditName(safe.name);
  }

  async function handleSaveSafe(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSafe) return;
    const name = safeEditName.trim();
    if (!name) {
      toastError("اسم الخزنة مطلوب");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("safes")
      .update({ name })
      .eq("id", editingSafe.id);
    setBusy(false);
    if (error) {
      toastError(error.message);
      return;
    }
    await logAuditEvent(supabase, {
      action: "safe.update",
      entityType: "safe",
      entityId: editingSafe.id,
      entityLabel: name,
      before: { name: editingSafe.name },
      after: { name },
      source: "app",
    });
    setEditingSafe(null);
    toastSuccess("تم تحديث الخزنة");
    await fetchData();
  }

  async function handleDeleteSafe(safe: Safe) {
    const guard = await guardSafeDelete(supabase, safe.id, safe.name);
    if (!guard.ok) {
      toastError(guard.message);
      return;
    }
    if (
      !(await confirm({
        message: `حذف الخزنة «${safe.name}»؟`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }
    const { error } = await supabase.from("safes").delete().eq("id", safe.id);
    if (error) {
      toastError(error.message);
      return;
    }
    await logAuditEvent(supabase, {
      action: "safe.delete",
      entityType: "safe",
      entityId: safe.id,
      entityLabel: safe.name,
      before: { name: safe.name, balance: safe.balance },
      source: "app",
    });
    toastSuccess("تم حذف الخزنة");
    await fetchData();
  }

  async function toggleSafeActive(safe: Safe) {
    const next = safe.is_active === false;
    if (!next) {
      if (settings?.drawer_safe_id === safe.id) {
        toastError(
          `لا يمكن إيقاف «${safe.name}» لأنها خزنة درج الكاشير في الإعدادات.`
        );
        return;
      }
      const { count } = await supabase
        .from("shifts")
        .select("id", { count: "exact", head: true })
        .eq("safe_id", safe.id)
        .eq("status", "open");
      if ((count || 0) > 0) {
        toastError(
          `لا يمكن إيقاف «${safe.name}» لأن عليها وردية مفتوحة.`
        );
        return;
      }
      if (
        !(await confirm({
          message: `إيقاف الخزنة «${safe.name}»؟ الرصيد الحالي ${formatCurrency(safe.balance)}. لن تظهر في نقطة البيع والمدفوعات.`,
          tone: "danger",
          confirmLabel: "إيقاف",
        }))
      ) {
        return;
      }
    }
    setBusy(true);
    const { error } = await setEntitiesActive(
      supabase,
      "safes",
      [safe.id],
      next,
      { [safe.id]: safe.name }
    );
    setBusy(false);
    if (error) {
      toastError(error);
      return;
    }
    toastSuccess(next ? "تم تفعيل الخزنة" : "تم إيقاف الخزنة");
    await fetchData();
  }

  const totalBalance = safes.reduce((sum, s) => sum + s.balance, 0);
  const transferFromSafe = safes.find((s) => s.id === transferFromId);
  const transferToSafe = safes.find((s) => s.id === transferToId);

  function transferDirection(t: SafeTransaction) {
    if (t.type !== "transfer") return null;
    if (t.reference_type === "transfer_out") return "out";
    if (t.reference_type === "transfer_in") return "in";
    return null;
  }

  function txRowActions(t: TxRow, canEdit: boolean): RowAction[] {
    if (!canEdit) return [];
    return [
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () => openEditTx(t),
      },
      {
        label: "حذف",
        tone: "delete",
        icon: "trash",
        disabled: busy,
        onClick: () => void handleDeleteTx(t),
      },
    ];
  }

  function safeRowActions(safe: Safe): RowAction[] {
    const active = safe.is_active !== false;
    return [
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () => openEditSafe(safe),
      },
      {
        label: active ? "إيقاف" : "تفعيل",
        tone: "toggle",
        icon: "power",
        disabled: busy,
        onClick: () => void toggleSafeActive(safe),
      },
      {
        label: "حذف",
        tone: "delete",
        icon: "trash",
        onClick: () => void handleDeleteSafe(safe),
      },
    ];
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">الخزينة</h1>
        <div className="flex flex-wrap gap-2">
          <PrintListButton
            onClick={() => setShowListPrint(true)}
            rowCount={sortedTransactions.length}
            label="طباعة الحركات"
          />
          <button
            onClick={() => setShowSafeForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            <Plus className="h-4 w-4" />
            خزنة جديدة
          </button>
          <button
            onClick={() => {
              setTransferFromId("");
              setTransferToId("");
              setShowTransferForm(true);
            }}
            disabled={safes.length < 2}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1473e6] px-4 py-2 text-sm font-medium text-[#1473e6] hover:bg-[#eaf4ff] disabled:opacity-40"
          >
            <ArrowLeftRight className="h-4 w-4" />
            تحويل بين خزن
          </button>
          <button
            onClick={() => setShowTransactionForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
          >
            <Plus className="h-4 w-4" />
            حركة مالية
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface))] px-5 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1473e6] text-white">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-[#526176]">إجمالي أرصدة الخزن</p>
            <p className="text-[11px] text-gray-500">
              {safes.length} {safes.length === 1 ? "خزنة" : "خزن"}
            </p>
          </div>
        </div>
        <p className="text-2xl font-bold text-[#0f5bb8]" dir="ltr">
          {formatCurrency(totalBalance)}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {safes.map((safe) => {
          const active = safe.is_active !== false;
          return (
          <div
            key={safe.id}
            className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${
              active ? "" : "opacity-70"
            }`}
            onContextMenu={(e) => openMenu(e, toContextMenuItems(safeRowActions(safe)))}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eaf4ff] text-[#1473e6]">
                <Landmark className="h-4 w-4" />
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-gray-600">{safe.name}</h3>
                {!active && (
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                    موقوفة
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  title="تعديل"
                  onClick={() => openEditSafe(safe)}
                  className="rounded-lg p-1.5 text-blue-700 hover:bg-blue-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title={active ? "إيقاف" : "تفعيل"}
                  disabled={busy}
                  onClick={() => void toggleSafeActive(safe)}
                  className="rounded-lg p-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <Power className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="حذف"
                  onClick={() => void handleDeleteSafe(safe)}
                  className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-gray-900">
              {formatCurrency(safe.balance)}
            </p>
            {(safe.opening_balance ?? 0) !== 0 && (
              <p className="mt-1 text-xs text-gray-500">
                افتتاحي: {formatCurrency(safe.opening_balance ?? 0)}
              </p>
            )}
          </div>
          );
        })}
        <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 p-5">
          <h3 className="text-sm font-medium text-blue-600">إجمالي الخزن</h3>
          <p className="mt-3 text-2xl font-bold text-blue-800">
            {formatCurrency(totalBalance)}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <h2 className="font-semibold text-gray-900">آخر الحركات المالية</h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="بحث في البيان..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs focus:border-blue-500 focus:outline-none"
            />
            <DateField
              value={dateFrom}
              onChange={setDateFrom}
              className="w-auto min-w-[140px]"
              inputClassName="border-gray-300 text-xs py-1"
            />
            <DateField
              value={dateTo}
              onChange={setDateTo}
              className="w-auto min-w-[140px]"
              inputClassName="border-gray-300 text-xs py-1"
            />
            <TodayDateChip
              dateFrom={dateFrom}
              dateTo={dateTo}
              onApply={(from, to) => {
                setDateFrom(from);
                setDateTo(to);
              }}
              className="py-1"
            />
            <select
              value={filterSafe}
              onChange={(e) => setFilterSafe(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs focus:border-blue-500 focus:outline-none"
            >
              <option value="">كل الخزن</option>
              {safes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs focus:border-blue-500 focus:outline-none"
            >
              <option value="">كل الأنواع</option>
              <option value="deposit">إيداع</option>
              <option value="withdrawal">سحب</option>
              <option value="transfer">تحويل</option>
            </select>
          </div>
        </div>
        <div className="max-h-[500px] overflow-x-auto overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50/95 text-gray-600 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] backdrop-blur-xs">
              <tr>
                <SortableHeader
                  label="التاريخ"
                  field="created_at"
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                />
                <SortableHeader
                  label="الخزنة"
                  field="safe.name"
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                />
                <SortableHeader
                  label="النوع"
                  field="type"
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                />
                <SortableHeader
                  label="المبلغ"
                  field="amount"
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                />
                <SortableHeader
                  label="البيان"
                  field="description"
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                />
                <th className="px-4 py-3 text-right text-xs font-semibold">بواسطة</th>
                <th className="px-4 py-3 text-right text-xs font-semibold">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedTransactions.map((t) => {
                const dir = transferDirection(t);
                const relatedName = (t.related_safe as Safe | undefined)?.name;
                const canEdit =
                  isManualSafeMovement(t) &&
                  (t.type !== "transfer" || t.reference_type === "transfer_out");
                return (
                  <tr
                    key={t.id}
                    className="hover:bg-gray-50"
                    onContextMenu={(e) =>
                      openMenu(e, toContextMenuItems(txRowActions(t, canEdit)))
                    }
                  >
                    <td className="px-4 py-3 text-gray-600">
                      {formatDateRelative(t.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(t.safe as Safe | undefined)?.name || "-"}
                      {relatedName && (
                        <span className="mt-0.5 block text-xs text-gray-400">
                          {dir === "out" ? `→ ${relatedName}` : dir === "in" ? `← ${relatedName}` : relatedName}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.type === "deposit"
                            ? "bg-green-100 text-green-700"
                            : t.type === "withdrawal"
                              ? "bg-red-100 text-red-700"
                              : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {TYPE_LABELS[t.type]}
                        {dir === "out" ? " (خروج)" : dir === "in" ? " (دخول)" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {formatCurrency(t.amount)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {t.description || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {t.creator_name || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditTx(t)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            تعديل
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDeleteTx(t)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            حذف
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {sortedTransactions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10">
                    {transactions.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 text-center">
                        <Landmark className="h-9 w-9 text-gray-300" />
                        <p className="text-sm font-semibold text-gray-600">
                          لا توجد حركات مالية
                        </p>
                        <p className="max-w-xs text-xs text-gray-500">
                          سجّل إيداعاً أو سحباً أو حوّل بين الخزن لمتابعة الرصيد
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowTransactionForm(true)}
                          disabled={safes.length === 0}
                          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          حركة مالية
                        </button>
                      </div>
                    ) : (
                      <p className="text-center text-gray-500">
                        لا توجد نتائج مطابقة للبحث أو الفلتر
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            {sortedTransactions.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 border-t border-gray-200 bg-gray-50 font-bold shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
                <tr className="bg-gray-50/95 text-gray-900 backdrop-blur-xs">
                  <td className="px-4 py-3 font-semibold text-gray-700">
                    إجمالي المعروض ({sortedTransactions.length})
                  </td>
                  <td colSpan={2} />
                  <td className="px-4 py-3 font-semibold">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold text-green-700">
                        إيداع: {formatCurrency(totalDeposits)}
                      </span>
                      <span className="text-xs font-semibold text-red-600">
                        سحب: {formatCurrency(totalWithdrawals)}
                      </span>
                      <span className="text-xs font-semibold text-blue-700">
                        تحويلات: {formatCurrency(totalTransfers / 2)}
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          netAmount >= 0 ? "text-green-700" : "text-red-600"
                        }`}
                      >
                        صافي إيداع/سحب: {formatCurrency(netAmount)}
                      </span>
                    </div>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {showListPrint && (
        <PrintReportPreview
          title="تقرير حركات الخزينة"
          rows={sortedTransactions}
          columns={treasuryColumns}
          settings={settings}
          subtitle={
            dateFrom || dateTo
              ? `الفترة: ${dateFrom || "…"} — ${dateTo || "…"}`
              : undefined
          }
          summary={[
            { label: "عدد الحركات", value: String(sortedTransactions.length) },
            { label: "الإيداعات", value: formatCurrency(totalDeposits) },
            { label: "السحوبات", value: formatCurrency(totalWithdrawals) },
            { label: "الصافي", value: formatCurrency(netAmount) },
          ]}
          onClose={() => setShowListPrint(false)}
        />
      )}

      <Modal open={showSafeForm} onClose={() => setShowSafeForm(false)} title="خزنة جديدة">
        <form onSubmit={handleAddSafe} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">اسم الخزنة</label>
            <input
              name="name"
              type="text"
              required
              placeholder="مثال: خزنة الفرع / حساب البنك"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              الرصيد الافتتاحي
            </label>
            <input
              name="opening_balance"
              type="number"
              step="0.01"
              min="0"
              defaultValue="0"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
            >
              إضافة
            </button>
            <button
              type="button"
              onClick={() => setShowSafeForm(false)}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showTransactionForm}
        onClose={() => setShowTransactionForm(false)}
        title="حركة مالية"
      >
        <form onSubmit={handleAddTransaction} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">الخزنة</label>
            <select
              name="safe_id"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">اختر خزنة</option>
              {safes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({formatCurrency(s.balance)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">النوع</label>
            <select
              name="type"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="deposit">إيداع</option>
              <option value="withdrawal">سحب</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">المبلغ</label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">البيان</label>
            <input
              name="description"
              type="text"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {busy ? "جاري الحفظ..." : "حفظ"}
            </button>
            <button
              type="button"
              onClick={() => setShowTransactionForm(false)}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showTransferForm}
        onClose={() => {
          setShowTransferForm(false);
          setTransferFromId("");
          setTransferToId("");
        }}
        title="تحويل بين خزن"
      >
        <form onSubmit={handleTransfer} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">من خزنة</label>
            <select
              name="from_safe_id"
              required
              value={transferFromId}
              onChange={(e) => setTransferFromId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">اختر المصدر</option>
              {safes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {transferFromSafe && (
              <p className="mt-1 text-[11px] text-gray-500">
                الرصيد:{" "}
                <span className="font-semibold text-gray-700">
                  {formatCurrency(Number(transferFromSafe.balance) || 0)}
                </span>
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">إلى خزنة</label>
            <select
              name="to_safe_id"
              required
              value={transferToId}
              onChange={(e) => setTransferToId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">اختر الوجهة</option>
              {safes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {transferToSafe && (
              <p className="mt-1 text-[11px] text-gray-500">
                الرصيد:{" "}
                <span className="font-semibold text-gray-700">
                  {formatCurrency(Number(transferToSafe.balance) || 0)}
                </span>
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">المبلغ</label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">البيان</label>
            <input
              name="description"
              type="text"
              placeholder="اختياري"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {busy ? "جاري التحويل..." : "تحويل"}
            </button>
            <button
              type="button"
              onClick={() => setShowTransferForm(false)}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editingTx}
        onClose={() => setEditingTx(null)}
        title={
          editingTx?.type === "transfer" ? "تعديل تحويل" : "تعديل حركة مالية"
        }
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          {editingTx?.type === "transfer" ? (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  من خزنة
                </label>
                <select
                  value={editForm.from_safe_id}
                  onChange={(e) =>
                    setEditForm({ ...editForm, from_safe_id: e.target.value })
                  }
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">اختر</option>
                  {safes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  إلى خزنة
                </label>
                <select
                  value={editForm.to_safe_id}
                  onChange={(e) =>
                    setEditForm({ ...editForm, to_safe_id: e.target.value })
                  }
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">اختر</option>
                  {safes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  الخزنة
                </label>
                <select
                  value={editForm.safe_id}
                  onChange={(e) =>
                    setEditForm({ ...editForm, safe_id: e.target.value })
                  }
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">اختر</option>
                  {safes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  النوع
                </label>
                <select
                  value={editForm.type}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      type: e.target.value as "deposit" | "withdrawal",
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="deposit">إيداع</option>
                  <option value="withdrawal">سحب</option>
                </select>
              </div>
            </>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              المبلغ
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={editForm.amount}
              onChange={(e) =>
                setEditForm({ ...editForm, amount: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              dir="ltr"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              البيان
            </label>
            <input
              type="text"
              value={editForm.description}
              onChange={(e) =>
                setEditForm({ ...editForm, description: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "جاري الحفظ..." : "حفظ التعديل"}
            </button>
            <button
              type="button"
              onClick={() => setEditingTx(null)}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editingSafe}
        onClose={() => setEditingSafe(null)}
        title="تعديل خزنة"
      >
        <form onSubmit={handleSaveSafe} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              اسم الخزنة
            </label>
            <input
              type="text"
              required
              value={safeEditName}
              onChange={(e) => setSafeEditName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <p className="text-xs text-gray-500">
            الرصيد لا يُعدَّل من هنا — استخدم حركة مالية أو تحويل.
          </p>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              حفظ
            </button>
            <button
              type="button"
              onClick={() => setEditingSafe(null)}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>
      {contextMenu}
    </div>
  );
}

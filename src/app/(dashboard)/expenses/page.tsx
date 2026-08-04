"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { formatCurrency, formatDateRelative, smartSearchMatch } from "@/lib/utils";
import { safesOrderQuery } from "@/lib/safes-order";
import { useSort } from "@/hooks/useSort";
import { useAuth } from "@/hooks/useAuth";
import { SortableHeader } from "@/components/ui/SortableHeader";
import type { RowAction } from "@/components/ui/TableRowActions";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { Modal } from "@/components/ui/Modal";
import { DateField } from "@/components/ui/DateField";
import { TodayDateChip } from "@/components/ui/TodayDateChip";
import {
  ensureExpenseAccounts,
  type ExpenseListItem,
} from "@/lib/expenses";
import {
  createExpenseAccountOnlineOrQueue,
  createExpenseOnlineOrQueue,
  deleteExpenseOnlineOrQueue,
  getSnapshot,
  isBrowserOnline,
  listActiveEntities,
  updateExpenseOnlineOrQueue,
  withTimeout,
} from "@/lib/offline";
import { listExpensesLocal } from "@/lib/offline/expenses-local";
import { listExpenses } from "@/lib/expenses";
import type { Account, Safe } from "@/types";
import { Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseListItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [safes, setSafes] = useState<Safe[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseListItem | null>(
    null
  );
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [filterSafe, setFilterSafe] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [formDate, setFormDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const supabase = createClient();
  const { profile } = useAuth();
  const { error: toastError, success: toastSuccess } = useToast();
  const { confirm } = useConfirm();
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  const selectableAccounts = accounts.filter(
    (a) => a.is_active && a.type === "expense" && !["5000", "5100"].includes(a.code)
  );

  const filtered = expenses.filter((e) => {
    const matchesSearch = smartSearchMatch(searchTerm, [
      e.description,
      e.entry_number,
      e.expense_account_name,
      e.safe_name,
    ]);
    const matchesAccount =
      !filterAccount || e.expense_account_id === filterAccount;
    const matchesSafe = !filterSafe || e.safe_id === filterSafe;
    const day = e.date;
    const matchesFrom = !dateFrom || day >= dateFrom;
    const matchesTo = !dateTo || day <= dateTo;
    return matchesSearch && matchesAccount && matchesSafe && matchesFrom && matchesTo;
  });

  const { items: sorted, sortConfig, requestSort } = useSort(filtered);
  const totalAmount = sorted.reduce((sum, e) => sum + e.amount, 0);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const loadLocal = async () => {
      const [localExpenses, accountsLocal, safesLocal] = await Promise.all([
        listExpensesLocal(),
        listActiveEntities("accounts"),
        listActiveEntities("safes"),
      ]);
      setExpenses(localExpenses);
      setAccounts(
        accountsLocal.filter(
          (a) => a.type === "expense" && a.is_active !== false
        ) as unknown as Account[]
      );
      setSafes(
        safesLocal.filter((s) => s.is_active !== false) as unknown as Safe[]
      );
      setOfflineOnly(!isBrowserOnline());
    };

    if (!isBrowserOnline()) {
      try {
        await loadLocal();
      } catch {
        const snap = await getSnapshot();
        if (snap?.safes?.length) {
          setSafes(snap.safes.filter((s) => s.is_active) as Safe[]);
        }
        setExpenses([]);
        setOfflineOnly(true);
      }
      setLoading(false);
      return;
    }

    setOfflineOnly(false);
    try {
      await withTimeout(ensureExpenseAccounts(supabase), 3000);
      const [expRes, accRes, safesRes] = await withTimeout(
        Promise.all([
          listExpenses(supabase),
          supabase
            .from("accounts")
            .select("*")
            .eq("type", "expense")
            .eq("is_active", true)
            .order("code"),
          safesOrderQuery(
            supabase.from("safes").select("*").eq("is_active", true)
          ),
        ]),
        4000
      );

      if (expRes.error) {
        console.error(expRes.error);
        toastError(`تعذر تحميل المصروفات: ${expRes.error}`);
        await loadLocal();
      } else {
        setExpenses(expRes.data ?? []);
        if (accRes.data) setAccounts(accRes.data);
        if (safesRes.data) setSafes(safesRes.data as Safe[]);
      }
    } catch {
      await loadLocal();
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateExpense(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const expenseAccountId = formData.get("expense_account_id") as string;
    const safeId = formData.get("safe_id") as string;
    const amount = Number(formData.get("amount"));
    const description = (formData.get("description") as string) || "";
    const notes = (formData.get("notes") as string) || "";

    if (!expenseAccountId) {
      toastError("اختر حساب المصروف.");
      return;
    }
    if (!safeId) {
      toastError("اختر الخزنة لصرف المصروف.");
      return;
    }
    if (!amount || amount <= 0) {
      toastError("أدخل مبلغاً صحيحاً للمصروف.");
      return;
    }

    setSaving(true);
    if (editingExpense) {
      const { error, offline, pending } = await updateExpenseOnlineOrQueue(
        supabase,
        editingExpense.entry_id,
        {
          date: formDate,
          amount,
          description,
          notes,
          expenseAccountId,
          safeId,
          createdBy: profile?.id ?? null,
        },
        editingExpense
      );
      setSaving(false);
      if (error) {
        toastError(error);
        return;
      }
      setEditingExpense(null);
      setShowForm(false);
      setFormDate(new Date().toISOString().slice(0, 10));
      if (offline || pending) {
        toastSuccess("تم تعديل المصروف على الجهاز — بانتظار المزامنة");
      }
      await fetchData();
      return;
    }

    const result = await createExpenseOnlineOrQueue(supabase, {
      date: formDate,
      amount,
      description,
      notes,
      expenseAccountId,
      safeId,
      createdBy: profile?.id ?? null,
      createdAt: new Date().toISOString(),
    });
    setSaving(false);

    if (result.error) {
      toastError(result.error);
      return;
    }

    setShowForm(false);
    setFormDate(new Date().toISOString().slice(0, 10));
    if (result.offline || result.pending) {
      toastSuccess(
        `محفوظ على الجهاز ${result.data?.entry_number || ""} — معلّق للمزامنة`
      );
    }
    await fetchData();
  }

  function openEditExpense(item: ExpenseListItem) {
    setEditingExpense(item);
    setFormDate(item.date?.slice(0, 10) || new Date().toISOString().slice(0, 10));
    setShowForm(true);
  }

  async function handleCreateAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = (formData.get("name") as string) || "";

    setSaving(true);
    const { data, error, offline } = await createExpenseAccountOnlineOrQueue(
      supabase,
      name
    );
    setSaving(false);

    if (error) {
      toastError(error);
      return;
    }

    setShowAccountForm(false);
    if (data) {
      setAccounts((prev) =>
        [...prev, data].sort((a, b) => a.code.localeCompare(b.code))
      );
      if (offline) {
        toastSuccess("تم إنشاء الحساب على الجهاز — بانتظار المزامنة");
      }
    }
  }

  async function handleDelete(item: ExpenseListItem) {
    if (
      !(await confirm({
        message: `إلغاء المصروف ${item.entry_number} بمبلغ ${formatCurrency(item.amount)}؟\nسيتم رد المبلغ للخزنة وحذف القيد.`,
        tone: "danger",
        confirmLabel: "حذف",
      }))
    ) {
      return;
    }

    const { error, offline, pending } = await deleteExpenseOnlineOrQueue(
      supabase,
      item.entry_id
    );
    if (error) {
      toastError(error);
      return;
    }
    if (offline || pending) {
      toastSuccess("تم الحذف على الجهاز — بانتظار المزامنة");
    }
    fetchData();
  }

  function expenseRowActions(item: ExpenseListItem): RowAction[] {
    return [
      {
        label: "تعديل",
        tone: "edit",
        icon: "pencil",
        onClick: () => openEditExpense(item),
      },
      {
        label: "إلغاء",
        tone: "delete",
        icon: "trash",
        onClick: () => void handleDelete(item),
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
      {offlineOnly && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          تعمل من بيانات الجهاز. العمليات الجديدة تُحفظ محلياً وتُزامَن عند عودة الإنترنت.
        </div>
      )}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">المصروفات</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowAccountForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            <Plus className="h-4 w-4" />
            حساب مصروف
          </button>
          <button
            onClick={() => setShowForm(true)}
            disabled={safes.length === 0 || selectableAccounts.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            مصروف جديد
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eaf4ff] text-[#1473e6]">
              <Wallet className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-medium text-gray-600">إجمالي المعروض</h3>
          </div>
          <p className="mt-3 text-2xl font-bold text-gray-900">
            {formatCurrency(totalAmount)}
          </p>
          <p className="mt-1 text-xs text-gray-500">{sorted.length} مصروف</p>
        </div>
        {safes.slice(0, 2).map((safe) => (
          <div
            key={safe.id}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-600">{safe.name}</h3>
            <p className="mt-3 text-2xl font-bold text-gray-900">
              {formatCurrency(safe.balance)}
            </p>
            <p className="mt-1 text-xs text-gray-500">رصيد الخزنة</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <h2 className="font-semibold text-gray-900">قيود المصروفات</h2>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="بحث..."
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
            />
            <select
              value={filterAccount}
              onChange={(e) => setFilterAccount(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs focus:border-blue-500 focus:outline-none"
            >
              <option value="">كل الحسابات</option>
              {selectableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
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
          </div>
        </div>

        <div className="max-h-[500px] overflow-x-auto overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50/95 text-gray-600 shadow-[inset_0_-1px_0_rgba(0,0,0,0.05)] backdrop-blur-xs">
              <tr>
                <SortableHeader
                  label="التاريخ"
                  field="date"
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                />
                <SortableHeader
                  label="رقم القيد"
                  field="entry_number"
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                />
                <SortableHeader
                  label="الحساب"
                  field="expense_account_name"
                  sortField={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                />
                <SortableHeader
                  label="الخزنة"
                  field="safe_name"
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
                <th className="px-4 py-3 text-right text-xs font-semibold">
                  ملاحظة
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold">بواسطة</th>
                <th className="px-4 py-3 text-right text-xs font-semibold">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((item) => (
                <tr
                  key={item.entry_id}
                  className="hover:bg-gray-50"
                  onContextMenu={(e) =>
                    openMenu(e, toContextMenuItems(expenseRowActions(item)))
                  }
                >
                  <td className="px-4 py-3 text-gray-600">
                    {formatDateRelative(item.date)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {item.entry_number}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {item.expense_account_name ? (
                      <>
                        <span className="text-xs text-gray-400">
                          {item.expense_account_code}
                        </span>{" "}
                        {item.expense_account_name}
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {item.safe_name?.trim() ? item.safe_name : "-"}
                  </td>
                  <td className="px-4 py-3 font-medium text-red-700">
                    {formatCurrency(item.amount)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.description || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{item.notes || "-"}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {item.created_by_name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditExpense(item)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                        title="تعديل"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        تعديل
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        title="إلغاء المصروف"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        إلغاء
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10">
                    {expenses.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 text-center">
                        <Wallet className="h-9 w-9 text-gray-300" />
                        <p className="text-sm font-semibold text-gray-600">
                          لا توجد مصروفات مسجّلة
                        </p>
                        <p className="max-w-xs text-xs text-gray-500">
                          سجّل أول مصروف لربطه بالخزنة وحساب المصروف
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowForm(true)}
                          disabled={
                            safes.length === 0 || selectableAccounts.length === 0
                          }
                          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          تسجيل مصروف
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
            {sorted.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 border-t border-gray-200 bg-gray-50 font-bold">
                <tr>
                  <td className="px-4 py-3 text-gray-700" colSpan={4}>
                    الإجمالي ({sorted.length})
                  </td>
                  <td className="px-4 py-3 text-red-700">{formatCurrency(totalAmount)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingExpense(null);
        }}
        title={editingExpense ? "تعديل مصروف" : "تسجيل مصروف"}
      >
        <form
          key={editingExpense?.entry_id || "new"}
          onSubmit={handleCreateExpense}
          className="space-y-4"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              التاريخ
            </label>
            <DateField
              name="date"
              value={formDate}
              onChange={setFormDate}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              حساب المصروف
            </label>
            <select
              name="expense_account_id"
              required
              defaultValue={editingExpense?.expense_account_id || ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">اختر الحساب</option>
              {selectableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              الخزنة
            </label>
            <select
              name="safe_id"
              required
              defaultValue={editingExpense?.safe_id || ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">اختر الخزنة</option>
              {safes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — رصيد {formatCurrency(s.balance)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              المبلغ
            </label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              defaultValue={editingExpense?.amount || ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              dir="ltr"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              البيان
            </label>
            <input
              name="description"
              type="text"
              defaultValue={editingExpense?.description || ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              ملاحظة
            </label>
            <textarea
              name="notes"
              rows={2}
              defaultValue={editingExpense?.notes || ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="ملاحظة إضافية (اختياري)"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving
                ? "جاري الحفظ..."
                : editingExpense
                  ? "حفظ التعديل"
                  : "حفظ"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingExpense(null);
              }}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showAccountForm}
        onClose={() => setShowAccountForm(false)}
        title="حساب مصروف جديد"
      >
        <form onSubmit={handleCreateAccount} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              اسم الحساب
            </label>
            <input
              type="text"
              name="name"
              required
              placeholder="مثال: دعاية وإعلان"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-gray-500">
            سيتم توليد كود الحساب تلقائياً ضمن مجموعة المصروفات العمومية (52xx).
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowAccountForm(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? "جاري الحفظ..." : "إضافة"}
            </button>
          </div>
        </form>
      </Modal>
      {contextMenu}
    </div>
  );
}

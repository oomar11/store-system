import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, JournalEntry, JournalLine, Safe, SafeTransaction } from "@/types";
import { applySafeMovement } from "@/lib/safe-transactions";
import { logAuditEvent } from "@/lib/audit";

export const CASH_ACCOUNT_CODE = "1100";
export const EXPENSE_REFERENCE_TYPE = "expense";

export type ExpenseListItem = {
  entry_id: string;
  entry_number: string;
  date: string;
  description: string;
  notes?: string | null;
  amount: number;
  expense_account_id: string;
  expense_account_code: string;
  expense_account_name: string;
  safe_id: string;
  safe_name: string;
  safe_transaction_id: string;
  created_at: string;
  created_by?: string;
  created_by_name?: string;
};

export type CreateExpenseInput = {
  date: string;
  amount: number;
  description: string;
  notes?: string | null;
  expenseAccountId: string;
  safeId: string;
  createdBy?: string | null;
  /** Business time (device clock) for offline ordering */
  createdAt?: string | null;
};

function padSeq(n: number): string {
  return n.toString().padStart(4, "0");
}

export async function ensureExpenseAccounts(
  supabase: SupabaseClient
): Promise<{ error: string | null }> {
  const defaults: { code: string; name: string }[] = [
    { code: "5210", name: "إيجار" },
    { code: "5220", name: "كهرباء ومياه" },
    { code: "5230", name: "رواتب وأجور" },
    { code: "5240", name: "صيانة" },
    { code: "5250", name: "مواصلات" },
    { code: "5260", name: "اتصالات وإنترنت" },
    { code: "5290", name: "مصروفات أخرى" },
  ];

  const { data: existing } = await supabase
    .from("accounts")
    .select("code")
    .in(
      "code",
      defaults.map((d) => d.code)
    );

  const have = new Set((existing || []).map((r) => r.code));
  const missing = defaults.filter((d) => !have.has(d.code));
  if (missing.length === 0) return { error: null };

  const { data: parent } = await supabase
    .from("accounts")
    .select("id")
    .eq("code", "5200")
    .maybeSingle();

  const { error } = await supabase.from("accounts").insert(
    missing.map((d) => ({
      code: d.code,
      name: d.name,
      type: "expense" as const,
      parent_id: parent?.id ?? null,
      balance: 0,
      is_active: true,
    }))
  );

  // تأكد من وجود حساب النقدية المطلوب لقيود المصروف
  const { data: cash } = await supabase
    .from("accounts")
    .select("id")
    .eq("code", CASH_ACCOUNT_CODE)
    .maybeSingle();
  if (!cash) {
    await supabase.from("accounts").insert({
      code: CASH_ACCOUNT_CODE,
      name: "النقدية",
      type: "asset",
      balance: 0,
      is_active: true,
    });
  }

  return { error: error?.message ?? null };
}

export async function generateExpenseEntryNumber(
  supabase: SupabaseClient
): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `EXP-${y}${m}${d}-`;

  const { data } = await supabase
    .from("journal_entries")
    .select("entry_number")
    .like("entry_number", `${prefix}%`)
    .order("entry_number", { ascending: false })
    .limit(1);

  let seq = 1;
  const last = data?.[0]?.entry_number as string | undefined;
  if (last?.startsWith(prefix)) {
    const parsed = parseInt(last.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) seq = parsed + 1;
  }
  return `${prefix}${padSeq(seq)}`;
}

export async function nextExpenseAccountCode(
  supabase: SupabaseClient
): Promise<string> {
  const { data } = await supabase
    .from("accounts")
    .select("code")
    .eq("type", "expense")
    .like("code", "52%")
    .order("code", { ascending: false })
    .limit(50);

  let max = 5290;
  for (const row of data || []) {
    const n = parseInt(row.code, 10);
    if (!Number.isNaN(n) && n >= 5200 && n < 6000 && n > max) max = n;
  }
  return String(Math.max(max + 1, 5291));
}

export async function createExpenseAccount(
  supabase: SupabaseClient,
  name: string
): Promise<{ data: Account | null; error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { data: null, error: "اسم الحساب مطلوب" };

  const code = await nextExpenseAccountCode(supabase);
  const { data: parent } = await supabase
    .from("accounts")
    .select("id")
    .eq("code", "5200")
    .maybeSingle();

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      code,
      name: trimmed,
      type: "expense",
      parent_id: parent?.id ?? null,
      balance: 0,
      is_active: true,
    })
    .select("*")
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as Account, error: null };
}

export async function createExpense(
  supabase: SupabaseClient,
  input: CreateExpenseInput
): Promise<{ data: ExpenseListItem | null; error: string | null }> {
  const amount = Number(input.amount);
  if (!input.expenseAccountId) {
    return { data: null, error: "اختر حساب المصروف." };
  }
  if (!input.safeId) {
    return { data: null, error: "اختر الخزنة لصرف المصروف." };
  }
  if (!amount || amount <= 0) {
    return { data: null, error: "أدخل مبلغاً صحيحاً للمصروف." };
  }

  const [{ data: safe }, { data: expenseAccount }, { data: cashAccount }] =
    await Promise.all([
      supabase.from("safes").select("*").eq("id", input.safeId).single(),
      supabase
        .from("accounts")
        .select("*")
        .eq("id", input.expenseAccountId)
        .single(),
      supabase
        .from("accounts")
        .select("*")
        .eq("code", CASH_ACCOUNT_CODE)
        .maybeSingle(),
    ]);

  if (!safe) return { data: null, error: "الخزنة غير موجودة" };
  if (!expenseAccount || expenseAccount.type !== "expense") {
    return { data: null, error: "حساب المصروف غير صالح" };
  }
  if (!cashAccount) {
    return { data: null, error: "حساب النقدية (1100) غير موجود في دليل الحسابات" };
  }
  if (amount > Number(safe.balance)) {
    return { data: null, error: "رصيد الخزنة غير كافٍ" };
  }

  const entry_number = await generateExpenseEntryNumber(supabase);
  const description =
    input.description.trim() ||
    `مصروف: ${expenseAccount.name}`;
  const notes = input.notes?.trim() || null;

  const entryInsert: Record<string, unknown> = {
    entry_number,
    date: input.date,
    description,
    notes,
    is_posted: true,
    created_by: input.createdBy || null,
  };
  if (input.createdAt) {
    entryInsert.created_at = input.createdAt;
  }

  const { data: entry, error: entryError } = await supabase
    .from("journal_entries")
    .insert(entryInsert)
    .select("*")
    .single();

  if (entryError || !entry) {
    return { data: null, error: entryError?.message || "فشل إنشاء القيد" };
  }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    {
      entry_id: entry.id,
      account_id: expenseAccount.id,
      debit: amount,
      credit: 0,
      description,
    },
    {
      entry_id: entry.id,
      account_id: cashAccount.id,
      debit: 0,
      credit: amount,
      description,
    },
  ]);

  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    return { data: null, error: linesError.message };
  }

  await Promise.all([
    supabase
      .from("accounts")
      .update({ balance: Number(expenseAccount.balance) + amount })
      .eq("id", expenseAccount.id),
    supabase
      .from("accounts")
      .update({ balance: Number(cashAccount.balance) - amount })
      .eq("id", cashAccount.id),
  ]);

  try {
    await applySafeMovement(supabase, {
      safeId: safe.id,
      type: "withdrawal",
      amount,
      description,
      notes,
      referenceType: EXPENSE_REFERENCE_TYPE,
      referenceId: entry.id,
      createdAt: input.createdAt || null,
    });
  } catch (safeErr) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    await Promise.all([
      supabase
        .from("accounts")
        .update({ balance: Number(expenseAccount.balance) })
        .eq("id", expenseAccount.id),
      supabase
        .from("accounts")
        .update({ balance: Number(cashAccount.balance) })
        .eq("id", cashAccount.id),
    ]);
    return {
      data: null,
      error:
        safeErr instanceof Error
          ? safeErr.message
          : "فشل خصم الخزنة",
    };
  }

  const { data: tx } = await supabase
    .from("safe_transactions")
    .select("*")
    .eq("reference_type", EXPENSE_REFERENCE_TYPE)
    .eq("reference_id", entry.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    data: {
      entry_id: entry.id,
      entry_number: entry.entry_number,
      date: entry.date,
      description,
      notes,
      amount,
      expense_account_id: expenseAccount.id,
      expense_account_code: expenseAccount.code,
      expense_account_name: expenseAccount.name,
      safe_id: safe.id,
      safe_name: safe.name,
      safe_transaction_id: tx?.id || "",
      created_at: entry.created_at,
      created_by: entry.created_by,
    },
    error: null,
  };
}

export async function deleteExpense(
  supabase: SupabaseClient,
  entryId: string,
  opts?: { skipAudit?: boolean }
): Promise<{ error: string | null }> {
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) return { error: "القيد غير موجود" };

  const { data: lines } = await supabase
    .from("journal_lines")
    .select("*")
    .eq("entry_id", entryId);

  const { data: tx } = await supabase
    .from("safe_transactions")
    .select("*, safe:safes!safe_id(*)")
    .eq("reference_type", EXPENSE_REFERENCE_TYPE)
    .eq("reference_id", entryId)
    .maybeSingle();

  if (!tx) return { error: "حركة الخزنة المرتبطة غير موجودة" };

  const amount = Number(tx.amount);
  const safe = tx.safe as Safe | undefined;
  if (!safe) return { error: "الخزنة غير موجودة" };

  const expenseLine = (lines || []).find((l) => Number(l.debit) > 0);
  const cashLine = (lines || []).find((l) => Number(l.credit) > 0);

  // Reverse cash via atomic safe RPC (leaves compensating deposit ledger row)
  try {
    await applySafeMovement(supabase, {
      safeId: safe.id,
      type: "deposit",
      amount,
      description: `عكس مصروف: ${entry.description || entry.entry_number}`,
      referenceType: EXPENSE_REFERENCE_TYPE,
      referenceId: entryId,
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "تعذر استرجاع مبلغ الخزنة",
    };
  }

  // Remove original withdrawal row (compensating deposit remains as audit trail)
  await supabase.from("safe_transactions").delete().eq("id", tx.id);

  if (expenseLine?.account_id) {
    const { data: acc } = await supabase
      .from("accounts")
      .select("balance")
      .eq("id", expenseLine.account_id)
      .maybeSingle();
    if (acc) {
      await supabase
        .from("accounts")
        .update({ balance: Number(acc.balance) - amount })
        .eq("id", expenseLine.account_id);
    }
  }
  if (cashLine?.account_id) {
    const { data: acc } = await supabase
      .from("accounts")
      .select("balance")
      .eq("id", cashLine.account_id)
      .maybeSingle();
    if (acc) {
      await supabase
        .from("accounts")
        .update({ balance: Number(acc.balance) + amount })
        .eq("id", cashLine.account_id);
    }
  }

  const { error: delErr } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", entryId);

  if (delErr) return { error: delErr.message };

  if (!opts?.skipAudit) {
    await logAuditEvent(supabase, {
      action: "expense.delete",
      entityType: "expense",
      entityId: entryId,
      entityLabel: entry.entry_number,
      before: {
        entry_number: entry.entry_number,
        description: entry.description,
      notes: entry.notes,
        amount,
        safe_id: safe.id,
      },
      source: "app",
    });
  }

  return { error: null };
}

/** تعديل مصروف: حذف (عكس) ثم إنشاء بالقيم الجديدة */
export async function updateExpense(
  supabase: SupabaseClient,
  entryId: string,
  input: CreateExpenseInput,
  beforeSnapshot?: Pick<
    ExpenseListItem,
    | "entry_number"
    | "amount"
    | "description"
    | "notes"
    | "safe_id"
    | "expense_account_id"
  >
): Promise<{ data: ExpenseListItem | null; error: string | null }> {
  const old = beforeSnapshot || {
    entry_number: entryId,
    amount: 0,
    description: "",
    notes: null,
    safe_id: "",
    expense_account_id: "",
  };

  const del = await deleteExpense(supabase, entryId, { skipAudit: true });
  if (del.error) return { data: null, error: del.error };

  const created = await createExpense(supabase, input);
  if (created.error || !created.data) {
    return {
      data: null,
      error: created.error || "فشل إعادة إنشاء المصروف بعد الحذف",
    };
  }

  await logAuditEvent(supabase, {
    action: "expense.update",
    entityType: "expense",
    entityId: created.data.entry_id,
    entityLabel: created.data.entry_number,
    before: {
      entry_number: old.entry_number,
      amount: old.amount,
      description: old.description,
      notes: old.notes,
      safe_id: old.safe_id,
      expense_account_id: old.expense_account_id,
    },
    after: {
      entry_number: created.data.entry_number,
      amount: created.data.amount,
      description: created.data.description,
      notes: created.data.notes,
      safe_id: created.data.safe_id,
      expense_account_id: created.data.expense_account_id,
    },
    source: "app",
  });

  return created;
}

export async function listExpenses(
  supabase: SupabaseClient,
  limit = 500
): Promise<{ data: ExpenseListItem[]; error: string | null }> {
  // 1) حركات الخزنة المرتبطة بمصروف
  const { data: txs, error: txError } = await supabase
    .from("safe_transactions")
    .select("*, safe:safes!safe_id(id, name)")
    .eq("reference_type", EXPENSE_REFERENCE_TYPE)
    .eq("type", "withdrawal")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (txError) {
    return { data: [], error: txError.message };
  }

  // 2) قيود EXP-* كمصدر احتياطي لو الحركة موجودة بدون reference أو العكس
  const { data: expEntries, error: expEntriesError } = await supabase
    .from("journal_entries")
    .select("*")
    .like("entry_number", "EXP-%")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (expEntriesError) {
    return { data: [], error: expEntriesError.message };
  }

  const txList = (txs || []) as (SafeTransaction & {
    safe?: Safe | { id: string; name: string };
  })[];
  const entryIds = Array.from(
    new Set([
      ...txList.map((t) => t.reference_id).filter((id): id is string => Boolean(id)),
      ...(expEntries || []).map((e) => e.id as string),
    ])
  );

  if (entryIds.length === 0) {
    return { data: [], error: null };
  }

  const [{ data: entries, error: entriesError }, { data: lines, error: linesError }] =
    await Promise.all([
      supabase.from("journal_entries").select("*").in("id", entryIds),
      supabase
        .from("journal_lines")
        .select("id, entry_id, account_id, debit, credit, description")
        .in("entry_id", entryIds),
    ]);

  if (entriesError) {
    return { data: [], error: entriesError.message };
  }
  if (linesError) {
    return { data: [], error: linesError.message };
  }

  const accountIds = Array.from(
    new Set(
      (lines || [])
        .filter((l) => Number(l.debit) > 0)
        .map((l) => l.account_id as string)
        .filter(Boolean)
    )
  );

  const accountMap = new Map<string, Account>();
  if (accountIds.length > 0) {
    const { data: accounts, error: accountsError } = await supabase
      .from("accounts")
      .select("*")
      .in("id", accountIds);
    if (accountsError) {
      return { data: [], error: accountsError.message };
    }
    for (const a of accounts || []) {
      accountMap.set(a.id, a as Account);
    }
  }

  const linesByEntry = new Map<string, JournalLine[]>();
  for (const line of lines || []) {
    const list = linesByEntry.get(line.entry_id) || [];
    list.push(line as JournalLine);
    linesByEntry.set(line.entry_id, list);
  }

  const entryMap = new Map(
    (entries || []).map((e) => [
      e.id as string,
      {
        ...(e as JournalEntry),
        lines: linesByEntry.get(e.id) || [],
      },
    ])
  );

  const txByEntryId = new Map<string, (typeof txList)[number]>();
  for (const tx of txList) {
    if (tx.reference_id) txByEntryId.set(tx.reference_id, tx);
  }

  const items: ExpenseListItem[] = [];
  const seen = new Set<string>();

  // أولوية: قيود لها حركة خزنة
  for (const tx of txList) {
    if (!tx.reference_id) continue;
    const entry = entryMap.get(tx.reference_id);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    items.push(mapExpenseRow(tx, entry, accountMap));
  }

  // قيود EXP بدون حركة (بيانات ناقصة) — نعرضها برضو
  for (const raw of expEntries || []) {
    const entry = entryMap.get(raw.id);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const tx = txByEntryId.get(entry.id);
    items.push(
      mapExpenseRow(
        tx ||
          ({
            id: "",
            safe_id: "",
            amount: (entry.lines || []).find((l) => Number(l.debit) > 0)?.debit || 0,
            notes: entry.notes || null,
            created_at: entry.created_at,
          } as SafeTransaction & { safe?: Safe }),
        entry,
        accountMap
      )
    );
  }

  items.sort((a, b) => {
    const da = a.created_at || a.date;
    const db = b.created_at || b.date;
    return db.localeCompare(da);
  });

  const creatorIds = Array.from(
    new Set(items.map((i) => i.created_by).filter((id): id is string => Boolean(id)))
  );
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds);
    const nameById = new Map(
      (profiles || []).map((p) => [p.id as string, (p.full_name as string) || ""])
    );
    for (const item of items) {
      if (item.created_by) {
        item.created_by_name = nameById.get(item.created_by) || undefined;
      }
    }
  }

  return { data: items.slice(0, limit), error: null };
}

function mapExpenseRow(
  tx: SafeTransaction & { safe?: Safe | { id: string; name: string } },
  entry: JournalEntry & {
    lines?: JournalLine[];
  },
  accountMap: Map<string, Account>
): ExpenseListItem {
  const expenseLine = (entry.lines || []).find((l) => Number(l.debit) > 0);
  const account = expenseLine
    ? accountMap.get(expenseLine.account_id)
    : undefined;
  return {
    entry_id: entry.id,
    entry_number: entry.entry_number,
    date: entry.date,
    description: entry.description,
    notes: (entry.notes as string | null) || (tx.notes as string | null) || null,
    amount: Number(tx.amount) || Number(expenseLine?.debit) || 0,
    expense_account_id: expenseLine?.account_id || account?.id || "",
    expense_account_code: account?.code || "",
    expense_account_name: account?.name || "",
    safe_id: tx.safe_id || "",
    safe_name: (tx.safe as Safe | undefined)?.name || "",
    safe_transaction_id: tx.id || "",
    created_at: entry.created_at || tx.created_at,
    created_by: entry.created_by,
  };
}

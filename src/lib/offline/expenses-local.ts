import {
  EXPENSE_REFERENCE_TYPE,
  type CreateExpenseInput,
  type ExpenseListItem,
} from "@/lib/expenses";
import {
  getEntity,
  listActiveEntities,
  putEntity,
  softDeleteEntity,
} from "@/lib/offline/db";
import { getOrCreateDeviceId } from "@/lib/offline/device";
import { tickHlc } from "@/lib/offline/hlc";
import { enqueueSyncOp, makeTempNumber } from "@/lib/offline/outbox";
import { rebuildCompatSnapshot } from "@/lib/offline/snapshot";
import type { Account, JournalEntry, JournalLine, Safe } from "@/types";

function padSeq(n: number): string {
  return n.toString().padStart(4, "0");
}

async function nextLocalExpenseNumber(dateIso: string): Promise<string> {
  const day = dateIso.slice(0, 10).replace(/-/g, "");
  const prefix = `EXP-${day}-`;
  const entries = await listActiveEntities("journal_entries");
  let seq = 1;
  for (const e of entries) {
    const num = String(e.entry_number || "");
    if (!num.startsWith(prefix)) continue;
    const parsed = parseInt(num.slice(prefix.length), 10);
    if (!Number.isNaN(parsed) && parsed >= seq) seq = parsed + 1;
  }
  // Also consider pending offline temps
  for (const e of entries) {
    const num = String(e.entry_number || "");
    if (num.startsWith("OFF-EXP-")) {
      /* ignore */
    }
  }
  return `${prefix}${padSeq(seq)}`;
}

export async function listExpensesLocal(
  limit = 500
): Promise<ExpenseListItem[]> {
  const [txs, entries, lines, accounts, safes, profiles] = await Promise.all([
    listActiveEntities("safe_transactions"),
    listActiveEntities("journal_entries"),
    listActiveEntities("journal_lines"),
    listActiveEntities("accounts"),
    listActiveEntities("safes"),
    listActiveEntities("profiles"),
  ]);

  const accountMap = new Map(
    accounts.map((a) => [String(a.id), a as unknown as Account])
  );
  const safeMap = new Map(
    safes.map((s) => [String(s.id), s as unknown as Safe])
  );
  const profileMap = new Map(
    profiles.map((p) => [String(p.id), String(p.full_name || "")])
  );

  const expenseTxs = txs.filter(
    (t) =>
      t.reference_type === EXPENSE_REFERENCE_TYPE &&
      (t.type === "withdrawal" || !t.type)
  );

  const expEntries = entries.filter((e) =>
    String(e.entry_number || "").startsWith("EXP-")
  );

  const linesByEntry = new Map<string, JournalLine[]>();
  for (const line of lines) {
    const eid = String(line.entry_id || "");
    if (!eid) continue;
    const list = linesByEntry.get(eid) || [];
    list.push(line as unknown as JournalLine);
    linesByEntry.set(eid, list);
  }

  const entryMap = new Map(
    entries.map((e) => [
      String(e.id),
      {
        ...(e as unknown as JournalEntry),
        lines: linesByEntry.get(String(e.id)) || [],
      },
    ])
  );

  const items: ExpenseListItem[] = [];
  const seen = new Set<string>();

  for (const tx of expenseTxs) {
    const refId = String(tx.reference_id || "");
    if (!refId || seen.has(refId)) continue;
    const entry = entryMap.get(refId);
    if (!entry) continue;
    seen.add(refId);
    const expenseLine = (entry.lines || []).find((l) => Number(l.debit) > 0);
    const account = expenseLine
      ? accountMap.get(expenseLine.account_id)
      : undefined;
    const safe = safeMap.get(String(tx.safe_id || ""));
    items.push({
      entry_id: entry.id,
      entry_number: entry.entry_number,
      date: entry.date,
      description: entry.description,
      notes: (entry.notes as string | null) || (tx.notes as string | null) || null,
      amount: Number(tx.amount) || Number(expenseLine?.debit) || 0,
      expense_account_id: expenseLine?.account_id || account?.id || "",
      expense_account_code: account?.code || "",
      expense_account_name: account?.name || "",
      safe_id: String(tx.safe_id || ""),
      safe_name: safe?.name || "",
      safe_transaction_id: String(tx.id || ""),
      created_at: entry.created_at || String(tx.created_at || ""),
      created_by: entry.created_by,
      created_by_name: entry.created_by
        ? profileMap.get(entry.created_by) || undefined
        : undefined,
    });
  }

  for (const raw of expEntries) {
    const id = String(raw.id);
    if (seen.has(id)) continue;
    const entry = entryMap.get(id);
    if (!entry) continue;
    seen.add(id);
    const expenseLine = (entry.lines || []).find((l) => Number(l.debit) > 0);
    const account = expenseLine
      ? accountMap.get(expenseLine.account_id)
      : undefined;
    items.push({
      entry_id: entry.id,
      entry_number: entry.entry_number,
      date: entry.date,
      description: entry.description,
      notes: (entry.notes as string | null) || null,
      amount: Number(expenseLine?.debit) || 0,
      expense_account_id: expenseLine?.account_id || "",
      expense_account_code: account?.code || "",
      expense_account_name: account?.name || "",
      safe_id: "",
      safe_name: "",
      safe_transaction_id: "",
      created_at: entry.created_at,
      created_by: entry.created_by,
      created_by_name: entry.created_by
        ? profileMap.get(entry.created_by) || undefined
        : undefined,
    });
  }

  items.sort((a, b) => {
    const da = a.created_at || a.date;
    const db = b.created_at || b.date;
    return db.localeCompare(da);
  });

  return items.slice(0, limit);
}

export async function writeExpenseLocal(
  input: CreateExpenseInput & {
    localEntryId?: string;
    tempNumber?: string;
    /** When mirroring a server row, skip local balance mutations */
    mirrorOnly?: boolean;
  }
): Promise<ExpenseListItem> {
  const amount = Number(input.amount);
  if (!input.expenseAccountId) throw new Error("اختر حساب المصروف.");
  if (!input.safeId) throw new Error("اختر الخزنة لصرف المصروف.");
  if (!amount || amount <= 0) throw new Error("أدخل مبلغاً صحيحاً للمصروف.");

  const safe = await getEntity("safes", input.safeId);
  const expenseAccount = await getEntity("accounts", input.expenseAccountId);
  if (!safe) throw new Error("الخزنة غير موجودة على الجهاز");
  if (!expenseAccount) throw new Error("حساب المصروف غير موجود على الجهاز");

  const cashAccounts = await listActiveEntities("accounts");
  const cashAccount =
    cashAccounts.find((a) => a.code === "1100") ||
    cashAccounts.find((a) => a.type === "asset");
  if (!cashAccount) throw new Error("حساب النقدية غير موجود على الجهاز");

  const entryId = input.localEntryId || crypto.randomUUID();
  const lineDebitId = crypto.randomUUID();
  const lineCreditId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  const createdAt = input.createdAt || new Date().toISOString();
  const entryNumber =
    input.tempNumber || (await nextLocalExpenseNumber(input.date || createdAt));
  const deviceId = await getOrCreateDeviceId();
  const hlc = tickHlc(deviceId);

  const entryRow = {
    id: entryId,
    entry_number: entryNumber,
    date: input.date,
    description: input.description,
    notes: input.notes || null,
    created_by: input.createdBy || null,
    created_at: createdAt,
    updated_at: createdAt,
    _pending_sync: !input.mirrorOnly,
    last_hlc_physical_ms: hlc.physicalMs,
    last_hlc_counter: hlc.counter,
    last_hlc_device_id: hlc.deviceId,
  };

  await putEntity("journal_entries", entryRow);
  await putEntity("journal_lines", {
    id: lineDebitId,
    entry_id: entryId,
    account_id: input.expenseAccountId,
    debit: amount,
    credit: 0,
    description: input.description,
    created_at: createdAt,
  });
  await putEntity("journal_lines", {
    id: lineCreditId,
    entry_id: entryId,
    account_id: String(cashAccount.id),
    debit: 0,
    credit: amount,
    description: input.description,
    created_at: createdAt,
  });
  await putEntity("safe_transactions", {
    id: txId,
    safe_id: input.safeId,
    type: "withdrawal",
    amount,
    description: input.description,
    notes: input.notes || null,
    reference_type: EXPENSE_REFERENCE_TYPE,
    reference_id: entryId,
    created_by: input.createdBy || null,
    created_at: createdAt,
  });

  if (!input.mirrorOnly) {
    await putEntity("safes", {
      ...safe,
      balance: Number(safe.balance) - amount,
    });
    await putEntity("accounts", {
      ...expenseAccount,
      balance: Number(expenseAccount.balance || 0) + amount,
    });
    await putEntity("accounts", {
      ...cashAccount,
      balance: Number(cashAccount.balance || 0) - amount,
    });
  }

  await rebuildCompatSnapshot();

  return {
    entry_id: entryId,
    entry_number: entryNumber,
    date: input.date,
    description: input.description,
    notes: input.notes || null,
    amount,
    expense_account_id: input.expenseAccountId,
    expense_account_code: String(expenseAccount.code || ""),
    expense_account_name: String(expenseAccount.name || ""),
    safe_id: input.safeId,
    safe_name: String(safe.name || ""),
    safe_transaction_id: txId,
    created_at: createdAt,
    created_by: input.createdBy || undefined,
  };
}

export async function deleteExpenseLocal(entryId: string): Promise<void> {
  const entry = await getEntity("journal_entries", entryId);
  if (!entry) throw new Error("القيد غير موجود على الجهاز");

  const lines = (await listActiveEntities("journal_lines")).filter(
    (l) => String(l.entry_id) === entryId
  );
  const txs = (await listActiveEntities("safe_transactions")).filter(
    (t) =>
      t.reference_type === EXPENSE_REFERENCE_TYPE &&
      String(t.reference_id) === entryId &&
      t.type === "withdrawal"
  );
  const tx = txs[0];
  const amount =
    Number(tx?.amount) ||
    Number(lines.find((l) => Number(l.debit) > 0)?.debit) ||
    0;
  const safeId = String(tx?.safe_id || "");
  const deviceId = await getOrCreateDeviceId();
  const hlc = tickHlc(deviceId);

  if (safeId && amount > 0) {
    const safe = await getEntity("safes", safeId);
    if (safe) {
      await putEntity("safes", {
        ...safe,
        balance: Number(safe.balance) + amount,
      });
    }
  }

  const expenseLine = lines.find((l) => Number(l.debit) > 0);
  const cashLine = lines.find((l) => Number(l.credit) > 0);
  if (expenseLine?.account_id) {
    const acc = await getEntity("accounts", String(expenseLine.account_id));
    if (acc) {
      await putEntity("accounts", {
        ...acc,
        balance: Number(acc.balance || 0) - amount,
      });
    }
  }
  if (cashLine?.account_id) {
    const acc = await getEntity("accounts", String(cashLine.account_id));
    if (acc) {
      await putEntity("accounts", {
        ...acc,
        balance: Number(acc.balance || 0) + amount,
      });
    }
  }

  for (const line of lines) {
    await softDeleteEntity("journal_lines", String(line.id), hlc);
  }
  for (const t of txs) {
    await softDeleteEntity("safe_transactions", String(t.id), hlc);
  }
  await softDeleteEntity("journal_entries", entryId, hlc);
  await rebuildCompatSnapshot();
}

export async function enqueueExpenseCreate(
  item: ExpenseListItem,
  input: CreateExpenseInput
): Promise<string> {
  const opId = crypto.randomUUID();
  await enqueueSyncOp({
    id: opId,
    entity_type: "journal_entries",
    entity_id: item.entry_id,
    op_kind: "domain",
    domain_op: "expense",
    payload: {
      date: input.date,
      amount: input.amount,
      description: input.description,
      notes: input.notes || null,
      expenseAccountId: input.expenseAccountId,
      safeId: input.safeId,
      occurredAt: input.createdAt || item.created_at,
      localEntryId: item.entry_id,
      tempNumber: item.entry_number,
    },
  });
  return opId;
}

export async function enqueueExpenseUpdate(
  entryId: string,
  input: CreateExpenseInput,
  before?: ExpenseListItem
): Promise<string> {
  const opId = crypto.randomUUID();
  await enqueueSyncOp({
    id: opId,
    entity_type: "journal_entries",
    entity_id: entryId,
    op_kind: "domain",
    domain_op: "expense_update",
    payload: {
      entryId,
      date: input.date,
      amount: input.amount,
      description: input.description,
      notes: input.notes || null,
      expenseAccountId: input.expenseAccountId,
      safeId: input.safeId,
      occurredAt: input.createdAt || new Date().toISOString(),
      before: before
        ? {
            entry_number: before.entry_number,
            amount: before.amount,
            description: before.description,
            notes: before.notes || null,
            safe_id: before.safe_id,
            expense_account_id: before.expense_account_id,
          }
        : undefined,
    },
  });
  return opId;
}

export async function enqueueExpenseDelete(entryId: string): Promise<string> {
  const opId = crypto.randomUUID();
  await enqueueSyncOp({
    id: opId,
    entity_type: "journal_entries",
    entity_id: entryId,
    op_kind: "domain",
    domain_op: "expense_delete",
    payload: { entryId },
  });
  return opId;
}

export async function createExpenseAccountLocal(name: string): Promise<{
  id: string;
  code: string;
  name: string;
  type: "expense";
  is_active: boolean;
}> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("اسم الحساب مطلوب");
  const accounts = await listActiveEntities("accounts");
  let max = 5290;
  for (const row of accounts) {
    if (row.type !== "expense") continue;
    const n = parseInt(String(row.code), 10);
    if (!Number.isNaN(n) && n >= 5200 && n < 6000 && n > max) max = n;
  }
  const code = String(Math.max(max + 1, 5291));
  const parent = accounts.find((a) => a.code === "5200");
  const id = crypto.randomUUID();
  const row = {
    id,
    code,
    name: trimmed,
    type: "expense" as const,
    parent_id: parent ? String(parent.id) : null,
    balance: 0,
    is_active: true,
    created_at: new Date().toISOString(),
    _pending_sync: true,
  };
  await putEntity("accounts", row);
  await enqueueSyncOp({
    entity_type: "accounts",
    entity_id: id,
    op_kind: "domain",
    domain_op: "expense_account_create",
    payload: { name: trimmed, localId: id, code },
  });
  await rebuildCompatSnapshot();
  return row;
}

export function makeTempExpenseNumber(): string {
  return makeTempNumber("expense");
}

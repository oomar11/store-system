import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeActiveSafes } from "@/lib/safes-order";
import { EXPENSE_REFERENCE_TYPE } from "@/lib/expenses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mobile finance feed — safes + cash movements + recent expenses.
 * Avoids PostgREST multi-FK embeds that break client queries.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [safesRes, txRes, expenseTxRes] = await Promise.all([
      supabase
        .from("safes")
        .select("id, name, balance, is_active, sort_order, created_at")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("safe_transactions")
        .select(
          "id, type, amount, description, notes, created_at, safe_id, reference_type"
        )
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("safe_transactions")
        .select(
          "id, type, amount, description, notes, created_at, safe_id, reference_id, reference_type"
        )
        .eq("reference_type", EXPENSE_REFERENCE_TYPE)
        .eq("type", "withdrawal")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    if (safesRes.error) {
      return NextResponse.json(
        { error: safesRes.error.message || "تعذر تحميل الخزائن" },
        { status: 500 }
      );
    }
    if (txRes.error) {
      return NextResponse.json(
        { error: txRes.error.message || "تعذر تحميل الحركات" },
        { status: 500 }
      );
    }

    const safes = normalizeActiveSafes(safesRes.data || []);
    const nameById = new Map(
      safes.map((s) => [String(s.id), String(s.name || "خزنة")] as const)
    );

    const transactions = (txRes.data || []).map((t) => ({
      id: String(t.id),
      type: String(t.type || ""),
      amount: Number(t.amount) || 0,
      description:
        (t.description as string | null) ||
        (t.notes as string | null) ||
        null,
      created_at: String(t.created_at || ""),
      safe_id: t.safe_id ? String(t.safe_id) : null,
      safe_name: nameById.get(String(t.safe_id)) || "خزنة",
      reference_type: t.reference_type ? String(t.reference_type) : null,
    }));

    // Enrich expense rows with account names when possible
    const expenseTxs = expenseTxRes.error ? [] : expenseTxRes.data || [];
    const entryIds = Array.from(
      new Set(
        expenseTxs
          .map((t) => t.reference_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    const expenseAccountByEntry = new Map<string, string>();
    if (entryIds.length > 0) {
      const { data: lines } = await supabase
        .from("journal_lines")
        .select("entry_id, account_id, debit")
        .in("entry_id", entryIds);
      const debitLines = (lines || []).filter((l) => Number(l.debit) > 0);
      const accountIds = Array.from(
        new Set(debitLines.map((l) => String(l.account_id)).filter(Boolean))
      );
      const accountName = new Map<string, string>();
      if (accountIds.length > 0) {
        const { data: accounts } = await supabase
          .from("accounts")
          .select("id, name")
          .in("id", accountIds);
        for (const a of accounts || []) {
          accountName.set(String(a.id), String(a.name || "مصروف"));
        }
      }
      for (const line of debitLines) {
        const name = accountName.get(String(line.account_id));
        if (name) expenseAccountByEntry.set(String(line.entry_id), name);
      }
    }

    const expenses = expenseTxs.map((t) => ({
      entry_id: String(t.reference_id || t.id),
      expense_account_name:
        expenseAccountByEntry.get(String(t.reference_id)) ||
        (t.description as string) ||
        "مصروف",
      amount: Number(t.amount) || 0,
      date: String(t.created_at || "").slice(0, 10),
      safe_name: nameById.get(String(t.safe_id)) || "خزنة",
      created_at: String(t.created_at || ""),
    }));

    return NextResponse.json({
      ok: true,
      safes,
      transactions,
      expenses,
    });
  } catch (err) {
    console.error("[api/mobile/treasury-feed]", err);
    return NextResponse.json(
      { error: "تعذر تحميل بيانات المالية" },
      { status: 500 }
    );
  }
}

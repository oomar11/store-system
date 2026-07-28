"use client";

import { useEffect } from "react";
import {
  cancelOutboxEntry,
  outboxStatusLabel,
  retryAndSync,
  revertOptimisticInvoiceFromSnapshot,
  applyOptimisticPartyPaymentToSnapshot,
  applyOptimisticExpenseToSnapshot,
} from "@/lib/offline";
import { createClient } from "@/lib/supabase";
import { useOffline } from "@/components/offline/OfflineProvider";
import type { OutboxEntry } from "@/lib/offline";
import { formatDateRelative } from "@/lib/utils";
import type {
  OutboxExpensePayload,
  OutboxInvoicePayload,
  OutboxPartyPaymentPayload,
} from "@/lib/offline/types";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { RowAction } from "@/components/ui/TableRowActions";
import { useRowContextMenu, toContextMenuItems } from "@/components/ui/ContextMenu";
import { RefreshCw } from "lucide-react";

function opTypeLabel(type: string): string {
  if (type === "invoice") return "فاتورة";
  if (type === "party_payment") return "تحصيل/سداد";
  if (type === "expense") return "مصروف";
  return type;
}

function entryTitle(entry: {
  type: string;
  payload: {
    tempNumber?: string;
    label?: string;
    partyName?: string;
    description?: string;
  };
}): string {
  if (entry.type === "invoice") {
    const p = entry.payload as OutboxInvoicePayload;
    return `${p.label || "فاتورة"} ${p.tempNumber}`;
  }
  if (entry.type === "party_payment") {
    return `دفعة ${entry.payload.tempNumber || ""} — ${entry.payload.partyName || ""}`;
  }
  return `مصروف ${entry.payload.tempNumber || ""}`;
}

function isLikelyNetworkMessage(message: string | null): boolean {
  if (!message) return false;
  return /failed to fetch|network|timeout|offline|ERR_INTERNET|ECONNREFUSED|ENOTFOUND|TypeError/i.test(
    message
  );
}

function statusHint(entry: {
  status: string;
  lastError: string | null;
}): string | null {
  if (entry.status === "conflict") {
    return "تعارض مع بيانات السيرفر (مخزون/رصيد/تحقق). راجع الرسالة وأعد المحاولة أو ألغِ العملية.";
  }
  if (entry.status === "pending" && entry.lastError) {
    if (isLikelyNetworkMessage(entry.lastError)) {
      return "فشل بسبب الشبكة — هتتزامن تلقائياً عند استقرار الاتصال، أو اضغط مزامنة الآن.";
    }
    return "فشلت المزامنة — يمكنك إعادة المحاولة.";
  }
  if (entry.status === "syncing") {
    return "جاري الرفع للسيرفر…";
  }
  return null;
}

export function OfflineQueuePanel() {
  const supabase = createClient();
  const { entries, online, syncing, lastSyncResult, refreshQueue, runSync } =
    useOffline();
  const { success: toastSuccess, error: toastError, info: toastInfo } =
    useToast();
  const { confirm } = useConfirm();
  const { openMenu, menu: contextMenu } = useRowContextMenu();

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  async function handleSyncAll() {
    const result = await runSync();
    if (!online) {
      toastError("لا يوجد اتصال — المزامنة غير متاحة الآن");
      return;
    }
    if (result.synced > 0) {
      toastSuccess(`تمت مزامنة ${result.synced} عملية`);
    } else if (result.conflicts > 0) {
      toastError(`${result.conflicts} عملية متعارضة — راجع التفاصيل بالأسفل`);
    } else if (result.failed > 0) {
      toastError("توقفت المزامنة بسبب الشبكة — حاول مرة أخرى");
    } else if (result.remaining === 0) {
      toastInfo("لا توجد عمليات للمزامنة");
    }
    await refreshQueue();
  }

  async function handleRetry(id: string) {
    try {
      await retryAndSync(supabase, id);
      toastSuccess("تمت إعادة المحاولة");
      await refreshQueue();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "تعذرت المزامنة");
    }
  }

  async function handleCancel(id: string) {
    const ok = await confirm({
      title: "إلغاء العملية؟",
      message:
        "سيتم إلغاء العملية المعلّقة محلياً ولن تُرفع للسيرفر. وقت العملية الأصلي لن يُغيّر لو أعدت إضافتها لاحقاً.",
      confirmLabel: "إلغاء العملية",
      tone: "danger",
    });
    if (!ok) return;

    const entry = entries.find((e) => e.id === id);
    if (entry?.type === "invoice") {
      const p = entry.payload as OutboxInvoicePayload;
      try {
        await revertOptimisticInvoiceFromSnapshot({
          type: p.type,
          items: p.items,
          customerId: p.customerId,
          supplierId: p.supplierId,
          remaining: Math.max(0, p.total - p.paidAmount),
          paidAmount: p.paidAmount,
          safeId: p.safeId,
        });
      } catch {
        /* ignore */
      }
    } else if (entry?.type === "party_payment") {
      const p = entry.payload as OutboxPartyPaymentPayload;
      try {
        // Reverse the optimistic payment
        await applyOptimisticPartyPaymentToSnapshot({
          kind: p.kind,
          partyId: p.partyId,
          amount: -Number(p.amount),
          safeId: p.safeId,
        });
      } catch {
        /* ignore */
      }
    } else if (entry?.type === "expense") {
      const p = entry.payload as OutboxExpensePayload;
      try {
        await applyOptimisticExpenseToSnapshot({
          amount: -Number(p.amount),
          safeId: p.safeId,
        });
      } catch {
        /* ignore */
      }
    }

    await cancelOutboxEntry(id);
    toastSuccess("تم إلغاء العملية المعلّقة");
    await refreshQueue();
  }

  function entryRowActions(entry: OutboxEntry): RowAction[] {
    const actions: RowAction[] = [];
    if (entry.status === "conflict" || entry.status === "pending") {
      actions.push({
        label: "إعادة محاولة",
        tone: "edit",
        icon: "pencil",
        disabled: !online || syncing,
        onClick: () => void handleRetry(entry.id),
      });
    }
    if (entry.status !== "synced" && entry.status !== "cancelled") {
      actions.push({
        label: "إلغاء",
        tone: "delete",
        icon: "trash",
        onClick: () => void handleCancel(entry.id),
      });
    }
    return actions;
  }

  const conflictCount = entries.filter((e) => e.status === "conflict").length;
  const pendingCount = entries.filter(
    (e) => e.status === "pending" || e.status === "syncing"
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            عمليات أوفلاين
          </h2>
          <p className="text-sm text-[var(--muted)]">
            كل عملية محفوظة بوقت حدوثها على الجهاز. المزامنة ترتّبها بهذا الوقت
            وليس وقت رجوع النت.
          </p>
          {!online ? (
            <p className="mt-1 text-xs font-semibold text-[var(--warning)]">
              أنت أوفلاين حالياً — المزامنة هتشتغل لما يرجع الاتصال.
            </p>
          ) : null}
          {online && lastSyncResult && lastSyncResult.conflicts > 0 ? (
            <p className="mt-1 text-xs font-semibold text-[var(--danger)]">
              آخر مزامنة: {lastSyncResult.conflicts} تعارض
              {lastSyncResult.synced > 0
                ? ` · نجح ${lastSyncResult.synced}`
                : ""}
            </p>
          ) : null}
          {online && (pendingCount > 0 || conflictCount > 0) ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              معلّق: {pendingCount}
              {conflictCount > 0 ? ` · تعارض: ${conflictCount}` : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={!online || syncing || entries.length === 0}
          onClick={() => void handleSyncAll()}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          مزامنة الآن
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
          لا توجد عمليات معلّقة
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <ul className="divide-y divide-[var(--border)]">
            {entries.map((entry) => {
              const hint = statusHint(entry);
              return (
                <li
                  key={entry.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  onContextMenu={(e) =>
                    openMenu(e, toContextMenuItems(entryRowActions(entry)))
                  }
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-bold text-[var(--foreground)]">
                      {entryTitle(entry)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {opTypeLabel(entry.type)} ·{" "}
                      <span
                        className={
                          entry.status === "conflict"
                            ? "font-bold text-[var(--danger)]"
                            : entry.status === "pending"
                              ? "font-bold text-[var(--warning)]"
                              : ""
                        }
                      >
                        {outboxStatusLabel(entry.status)}
                      </span>{" "}
                      · {formatDateRelative(entry.occurred_at)}
                    </p>
                    <p
                      className="text-[11px] text-[var(--muted-soft)]"
                      dir="ltr"
                    >
                      occurred_at:{" "}
                      {new Date(entry.occurred_at).toLocaleString("ar-EG")}
                    </p>
                    {hint ? (
                      <p
                        className={`text-xs font-semibold ${
                          entry.status === "conflict"
                            ? "text-[var(--danger)]"
                            : "text-[var(--warning)]"
                        }`}
                      >
                        {hint}
                      </p>
                    ) : null}
                    {entry.lastError ? (
                      <p className="text-xs text-[var(--danger)]">
                        {entry.lastError}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {(entry.status === "conflict" ||
                      entry.status === "pending") && (
                      <button
                        type="button"
                        disabled={!online || syncing}
                        onClick={() => void handleRetry(entry.id)}
                        className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs font-bold text-[var(--primary)] disabled:opacity-50"
                      >
                        إعادة محاولة
                      </button>
                    )}
                    {entry.status !== "synced" &&
                    entry.status !== "cancelled" ? (
                      <button
                        type="button"
                        onClick={() => void handleCancel(entry.id)}
                        className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs font-bold text-[var(--danger)]"
                      >
                        إلغاء
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {contextMenu}
    </div>
  );
}

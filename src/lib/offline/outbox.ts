import { getOfflineDb } from "@/lib/offline/db";
import { getOrCreateDeviceId, persistLastHlc } from "@/lib/offline/device";
import { tickHlc } from "@/lib/offline/hlc";
import type {
  OutboxOpKind,
  OutboxStatus,
  SyncEntityType,
  SyncOutboxEntry,
} from "@/lib/offline/types";

export function makeTempNumber(type: string): string {
  const short = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const prefix =
    type === "invoice" ? "OFF" : type === "party_payment" ? "OFFP" : "OFFE";
  return `${prefix}-${short}`;
}

export async function enqueueSyncOp(input: {
  id?: string;
  entity_type: SyncEntityType | string;
  entity_id: string;
  op_kind: OutboxOpKind;
  domain_op?: string | null;
  payload?: Record<string, unknown>;
  base_version?: number | null;
}): Promise<SyncOutboxEntry> {
  const deviceId = await getOrCreateDeviceId();
  const hlc = tickHlc(deviceId);
  await persistLastHlc(hlc);
  const id = input.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const entry: SyncOutboxEntry = {
    id,
    device_id: deviceId,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    op_kind: input.op_kind,
    domain_op: input.domain_op ?? null,
    payload: input.payload ?? {},
    base_version: input.base_version ?? null,
    hlc_physical_ms: hlc.physicalMs,
    hlc_counter: hlc.counter,
    hlc_device_id: hlc.deviceId,
    status: "pending",
    lastError: null,
    attempts: 0,
    created_at: now,
    synced_at: null,
    result: null,
  };
  await getOfflineDb().outbox.put(entry);
  return entry;
}

export async function listSyncOutbox(options?: {
  includeSynced?: boolean;
}): Promise<SyncOutboxEntry[]> {
  const db = getOfflineDb();
  if (options?.includeSynced) {
    return db.outbox.orderBy("hlc_physical_ms").toArray();
  }
  return db.outbox
    .where("status")
    .anyOf(["pending", "syncing", "conflict", "rejected"])
    .sortBy("hlc_physical_ms");
}

export async function countPendingOutbox(): Promise<number> {
  return getOfflineDb()
    .outbox.where("status")
    .anyOf(["pending", "syncing", "conflict"])
    .count();
}

export async function getOutboxEntry(
  id: string
): Promise<SyncOutboxEntry | undefined> {
  return getOfflineDb().outbox.get(id);
}

export async function updateOutboxStatus(
  id: string,
  patch: Partial<
    Pick<
      SyncOutboxEntry,
      "status" | "lastError" | "attempts" | "synced_at" | "result"
    >
  >
): Promise<void> {
  await getOfflineDb().outbox.update(id, patch);
}

export async function cancelOutboxEntry(id: string): Promise<void> {
  await updateOutboxStatus(id, { status: "cancelled", lastError: null });
}

export async function retryOutboxEntry(id: string): Promise<void> {
  await updateOutboxStatus(id, { status: "pending", lastError: null });
}

export async function markOutboxSynced(
  id: string,
  result?: Record<string, unknown> | null
): Promise<void> {
  await updateOutboxStatus(id, {
    status: "synced",
    synced_at: new Date().toISOString(),
    lastError: null,
    result: result ?? null,
  });
}

/** Legacy enqueue used by mutations.ts — maps to domain sync ops */
export async function enqueueOutbox(input: {
  type: "invoice" | "party_payment" | "expense";
  payload: Record<string, unknown>;
  occurredAt?: string;
  id?: string;
}): Promise<SyncOutboxEntry> {
  const entityId = crypto.randomUUID();
  const domainOp =
    input.type === "invoice"
      ? "create_invoice"
      : input.type === "party_payment"
        ? "party_payment"
        : "expense";
  return enqueueSyncOp({
    id: input.id,
    entity_type: input.type === "invoice" ? "invoices" : input.type,
    entity_id: entityId,
    op_kind: "domain",
    domain_op: domainOp,
    payload: {
      ...input.payload,
      occurredAt: input.occurredAt || new Date().toISOString(),
    },
  });
}

export async function listOutbox(options?: {
  includeSynced?: boolean;
}): Promise<
  Array<{
    id: string;
    type: "invoice" | "party_payment" | "expense";
    payload:
      | import("@/lib/offline/types").OutboxInvoicePayload
      | import("@/lib/offline/types").OutboxPartyPaymentPayload
      | import("@/lib/offline/types").OutboxExpensePayload;
    occurred_at: string;
    status: OutboxStatus;
    lastError: string | null;
    attempts: number;
    created_at: string;
    synced_at: string | null;
    result_id: string | null;
    result_number: string | null;
  }>
> {
  const rows = await listSyncOutbox(options);
  return rows.map((e) => {
    const type =
      e.domain_op === "party_payment"
        ? ("party_payment" as const)
        : e.domain_op === "expense"
          ? ("expense" as const)
          : ("invoice" as const);
    return {
      id: e.id,
      type,
      payload: e.payload as
        | import("@/lib/offline/types").OutboxInvoicePayload
        | import("@/lib/offline/types").OutboxPartyPaymentPayload
        | import("@/lib/offline/types").OutboxExpensePayload,
      occurred_at: e.created_at,
      status: e.status,
      lastError: e.lastError,
      attempts: e.attempts,
      created_at: e.created_at,
      synced_at: e.synced_at,
      result_id: (e.result?.id as string) || null,
      result_number:
        (e.result?.invoice_number as string) ||
        (e.result?.number as string) ||
        null,
    };
  });
}

export function outboxStatusLabel(status: OutboxStatus): string {
  switch (status) {
    case "pending":
      return "معلّق";
    case "syncing":
      return "جاري المزامنة";
    case "synced":
      return "تمت المزامنة";
    case "conflict":
      return "تعارض";
    case "superseded":
      return "تجاوزتها عملية أحدث";
    case "rejected":
      return "مرفوضة";
    case "cancelled":
      return "ملغى";
    default:
      return status;
  }
}

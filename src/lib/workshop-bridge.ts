import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tryCreateServiceClient } from "@/lib/supabase-service";

const BRIDGE_CONFIG_ID = "c0000000-0000-0000-0000-000000000001";

let cachedDbSecret: string | null | undefined;

function envWorkshopBridgeSecret(): string {
  return (
    process.env.WORKSHOP_BRIDGE_SECRET?.trim() ||
    process.env.STORE_WORKSHOP_BRIDGE_SECRET?.trim() ||
    ""
  );
}

/** Resolve bridge secret: Vercel env first, then workshop_bridge_config row. */
export async function resolveWorkshopBridgeSecret(): Promise<string> {
  const fromEnv = envWorkshopBridgeSecret();
  if (fromEnv) return fromEnv;

  if (cachedDbSecret !== undefined) return cachedDbSecret || "";

  try {
    const client = await tryCreateServiceClient();
    if (!client) {
      cachedDbSecret = null;
      return "";
    }
    const { data } = await client
      .from("workshop_bridge_config")
      .select("bridge_secret")
      .eq("id", BRIDGE_CONFIG_ID)
      .maybeSingle();
    const secret = String(data?.bridge_secret || "").trim();
    cachedDbSecret = secret || null;
    return secret;
  } catch (e) {
    console.error("resolveWorkshopBridgeSecret", e);
    cachedDbSecret = null;
    return "";
  }
}

export async function isWorkshopBridgeConfigured(): Promise<boolean> {
  return Boolean(await resolveWorkshopBridgeSecret());
}

function secretsEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Authorize workshop bridge calls (Bearer or x-workshop-bridge-secret). */
export async function requireWorkshopBridgeSecret(
  request: NextRequest
): Promise<boolean> {
  const expected = await resolveWorkshopBridgeSecret();
  if (!expected) return false;

  const header =
    request.headers.get("x-workshop-bridge-secret")?.trim() || "";
  const auth = request.headers.get("authorization")?.trim() || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  return secretsEqual(header || bearer, expected);
}

/**
 * Deterministic UUID from workshop external key (payment/expense id).
 * Used as safe_transactions.reference_id.
 */
export function workshopExternalRefUuid(externalKey: string): string {
  const hash = createHash("sha1")
    .update(`store-workshop-bridge:v1:${externalKey}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // UUID version 5 style bits
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type WorkshopMovementType = "deposit" | "withdrawal";

export type WorkshopReferenceType =
  | "workshop_payment"
  | "workshop_expense";

function reversalType(ref: WorkshopReferenceType): string {
  return `${ref}_reversal`;
}

async function applyOne(
  client: SupabaseClient,
  params: {
    safeId: string;
    type: WorkshopMovementType;
    amount: number;
    description: string;
    referenceType: string;
    referenceId: string;
    notes?: string | null;
    createdAt?: string | null;
  }
): Promise<string> {
  const { data, error } = await client.rpc("apply_workshop_safe_movement", {
    p_safe_id: params.safeId,
    p_type: params.type,
    p_amount: params.amount,
    p_description: params.description || null,
    p_reference_type: params.referenceType,
    p_reference_id: params.referenceId,
    p_notes: params.notes || null,
    p_created_at: params.createdAt || null,
  });

  if (error) {
    throw new Error(error.message || "تعذر تحديث خزنة المتجر");
  }
  return typeof data === "string" ? data : String(data || "");
}

/**
 * Reconcile a workshop money row into store treasury.
 * Idempotent: zeros prior net for this external key, then applies the new amount.
 */
export async function reconcileWorkshopSafeMovement(
  client: SupabaseClient,
  params: {
    externalKey: string;
    referenceType: WorkshopReferenceType;
    safeId: string;
    /** 0 = void / delete */
    amount: number;
    type: WorkshopMovementType;
    description: string;
    notes?: string | null;
    occurredAt?: string | null;
  }
): Promise<{
  reference_id: string;
  reversed_net: number;
  applied: number;
  safe_id: string;
  balance: number | null;
}> {
  const amount = Number(params.amount) || 0;
  if (amount < 0) throw new Error("المبلغ غير صالح");
  if (!params.safeId && amount > 0) {
    throw new Error("اختر الخزنة");
  }
  if (!params.externalKey.trim()) {
    throw new Error("معرف الحركة مطلوب");
  }

  const referenceId = workshopExternalRefUuid(params.externalKey.trim());
  const refTypes = [params.referenceType, reversalType(params.referenceType)];

  const { data: txs, error: listErr } = await client
    .from("safe_transactions")
    .select("id, safe_id, type, amount, reference_type")
    .eq("reference_id", referenceId)
    .in("reference_type", refTypes);

  if (listErr) {
    throw new Error(listErr.message || "تعذر قراءة حركات الخزنة السابقة");
  }

  const netBySafe = new Map<string, number>();
  for (const tx of txs || []) {
    const sign = tx.type === "deposit" ? 1 : -1;
    const prev = netBySafe.get(tx.safe_id) || 0;
    netBySafe.set(tx.safe_id, prev + sign * (Number(tx.amount) || 0));
  }

  let reversedNet = 0;
  for (const [safeId, net] of netBySafe) {
    if (Math.abs(net) < 0.0005) continue;
    reversedNet += net;
    if (net > 0) {
      await applyOne(client, {
        safeId,
        type: "withdrawal",
        amount: net,
        description: `عكس ورشة: ${params.description}`,
        referenceType: reversalType(params.referenceType),
        referenceId,
        notes: params.notes || `workshop:${params.externalKey}`,
      });
    } else {
      await applyOne(client, {
        safeId,
        type: "deposit",
        amount: Math.abs(net),
        description: `عكس ورشة: ${params.description}`,
        referenceType: reversalType(params.referenceType),
        referenceId,
        notes: params.notes || `workshop:${params.externalKey}`,
      });
    }
  }

  let applied = 0;
  if (amount > 0) {
    await applyOne(client, {
      safeId: params.safeId,
      type: params.type,
      amount,
      description: params.description,
      referenceType: params.referenceType,
      referenceId,
      notes: params.notes || `workshop:${params.externalKey}`,
      createdAt: params.occurredAt || null,
    });
    applied = amount;
  }

  const { data: safeRow } = await client
    .from("safes")
    .select("balance")
    .eq("id", params.safeId || Array.from(netBySafe.keys())[0] || "")
    .maybeSingle();

  return {
    reference_id: referenceId,
    reversed_net: reversedNet,
    applied,
    safe_id: params.safeId,
    balance:
      safeRow && typeof safeRow.balance === "number" ? safeRow.balance : null,
  };
}

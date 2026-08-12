import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import {
  workshopCorsPreflight,
  withWorkshopCors,
} from "@/lib/workshop-bridge-cors";
import {
  isWorkshopBridgeConfigured,
  requireWorkshopBridgeSecret,
} from "@/lib/workshop-bridge";
import {
  applyCrossAppLedgerEntry,
  type WorkshopSourceSystem,
} from "@/lib/workshop-parties";

export const runtime = "nodejs";

function parseSource(raw: unknown): WorkshopSourceSystem {
  return String(raw || "").toLowerCase() === "plisse" ? "plisse" : "aa";
}

export async function OPTIONS() {
  return workshopCorsPreflight();
}

type PostBody = {
  source_system?: string;
  source_ref?: string;
  party_type?: "customer" | "supplier";
  party_id?: string;
  store_customer_id?: string;
  store_supplier_id?: string;
  entry_type?:
    | "workshop_sale"
    | "workshop_collection"
    | "workshop_adjustment"
    | "workshop_void";
  amount?: number;
  direction?: "debit" | "credit";
  occurred_at?: string | null;
  notes?: string | null;
  project_label?: string | null;
  details?: Record<string, unknown> | null;
};

/**
 * Post workshop sale/collection onto store party ledger (updates balance).
 * Cash safe sync remains separate via /api/workshop/safe-movement.
 */
export async function POST(request: NextRequest) {
  if (!(await isWorkshopBridgeConfigured())) {
    return withWorkshopCors(
      NextResponse.json(
        { error: "جسر الورشة غير مضبوط", configured: false },
        { status: 503 }
      )
    );
  }
  if (!(await requireWorkshopBridgeSecret(request))) {
    return withWorkshopCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return withWorkshopCors(
      NextResponse.json({ error: "JSON غير صالح" }, { status: 400 })
    );
  }

  const sourceRef = String(body.source_ref || "").trim();
  const entryType = body.entry_type;
  const direction = body.direction;
  const partyType =
    body.party_type ||
    (body.store_supplier_id ? "supplier" : "customer");
  const partyId = String(
    body.party_id ||
      body.store_customer_id ||
      body.store_supplier_id ||
      ""
  ).trim();

  if (!sourceRef) {
    return withWorkshopCors(
      NextResponse.json({ error: "source_ref مطلوب" }, { status: 400 })
    );
  }
  if (!partyId) {
    return withWorkshopCors(
      NextResponse.json({ error: "party_id مطلوب" }, { status: 400 })
    );
  }
  if (
    entryType !== "workshop_sale" &&
    entryType !== "workshop_collection" &&
    entryType !== "workshop_adjustment" &&
    entryType !== "workshop_void"
  ) {
    return withWorkshopCors(
      NextResponse.json({ error: "entry_type غير صالح" }, { status: 400 })
    );
  }
  if (direction !== "debit" && direction !== "credit") {
    return withWorkshopCors(
      NextResponse.json({ error: "direction يجب debit أو credit" }, { status: 400 })
    );
  }

  try {
    const client = await createServiceClient();
    const details =
      body.details &&
      typeof body.details === "object" &&
      !Array.isArray(body.details) &&
      Object.keys(body.details).length > 0
        ? body.details
        : null;
    const result = await applyCrossAppLedgerEntry(client, {
      sourceSystem: parseSource(body.source_system),
      sourceRef,
      partyType,
      partyId,
      entryType,
      amount: Number(body.amount) || 0,
      direction,
      occurredAt: body.occurred_at,
      notes: body.notes,
      projectLabel: body.project_label,
      details,
    });
    return withWorkshopCors(NextResponse.json({ ok: true, ...result }));
  } catch (e) {
    return withWorkshopCors(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "تعذر التسجيل" },
        { status: 500 }
      )
    );
  }
}

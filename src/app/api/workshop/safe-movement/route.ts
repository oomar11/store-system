import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import {
  isWorkshopBridgeConfigured,
  reconcileWorkshopSafeMovement,
  requireWorkshopBridgeSecret,
  type WorkshopMovementType,
  type WorkshopReferenceType,
} from "@/lib/workshop-bridge";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-workshop-bridge-secret",
};

function withCors(response: NextResponse) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

type Body = {
  external_key?: string;
  reference_type?: WorkshopReferenceType;
  safe_id?: string;
  amount?: number;
  type?: WorkshopMovementType;
  description?: string;
  notes?: string | null;
  occurred_at?: string | null;
};

/** Upsert/void a workshop payment or expense into store treasury. */
export async function POST(request: NextRequest) {
  if (!isWorkshopBridgeConfigured()) {
    return withCors(
      NextResponse.json(
        {
          error: "جسر الورشة غير مضبوط — أضف WORKSHOP_BRIDGE_SECRET على Vercel",
          configured: false,
        },
        { status: 503 }
      )
    );
  }

  if (!requireWorkshopBridgeSecret(request)) {
    return withCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return withCors(
      NextResponse.json({ error: "JSON غير صالح" }, { status: 400 })
    );
  }

  const externalKey = String(body.external_key || "").trim();
  const referenceType = body.reference_type;
  const type = body.type;
  const amount = Number(body.amount);
  const safeId = String(body.safe_id || "").trim();
  const description = String(body.description || "").trim();

  if (!externalKey) {
    return withCors(
      NextResponse.json({ error: "external_key مطلوب" }, { status: 400 })
    );
  }
  if (
    referenceType !== "workshop_payment" &&
    referenceType !== "workshop_expense"
  ) {
    return withCors(
      NextResponse.json(
        {
          error:
            "reference_type يجب أن يكون workshop_payment أو workshop_expense",
        },
        { status: 400 }
      )
    );
  }
  if (type !== "deposit" && type !== "withdrawal") {
    return withCors(
      NextResponse.json(
        { error: "type يجب أن يكون deposit أو withdrawal" },
        { status: 400 }
      )
    );
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return withCors(
      NextResponse.json({ error: "amount غير صالح" }, { status: 400 })
    );
  }
  if (amount > 0 && !safeId) {
    return withCors(
      NextResponse.json({ error: "safe_id مطلوب" }, { status: 400 })
    );
  }
  if (!description) {
    return withCors(
      NextResponse.json({ error: "description مطلوب" }, { status: 400 })
    );
  }

  if (referenceType === "workshop_payment" && type !== "deposit") {
    return withCors(
      NextResponse.json(
        { error: "دفعة الورشة لازم تكون deposit" },
        { status: 400 }
      )
    );
  }
  if (referenceType === "workshop_expense" && type !== "withdrawal") {
    return withCors(
      NextResponse.json(
        { error: "مصروف الورشة لازم يكون withdrawal" },
        { status: 400 }
      )
    );
  }

  try {
    const client = await createServiceClient();
    const result = await reconcileWorkshopSafeMovement(client, {
      externalKey,
      referenceType,
      safeId,
      amount,
      type,
      description,
      notes: body.notes ?? `workshop:${externalKey}`,
      occurredAt: body.occurred_at || null,
    });

    return withCors(NextResponse.json({ ok: true, ...result }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر مزامنة الخزنة";
    return withCors(NextResponse.json({ error: message }, { status: 400 }));
  }
}

/** Quick status for operators. */
export async function GET() {
  return withCors(
    NextResponse.json({
      service: "workshop-safe-bridge",
      configured: isWorkshopBridgeConfigured(),
    })
  );
}

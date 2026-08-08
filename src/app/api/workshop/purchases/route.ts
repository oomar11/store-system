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
  createWorkshopExternalPurchase,
  type ExternalPurchaseLine,
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
  source_ref?: string | null;
  supplier_id?: string;
  items?: ExternalPurchaseLine[];
  subtotal?: number;
  total?: number;
  paid_amount?: number;
  safe_id?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

/** Record external workshop supply against a store supplier (AP + optional cash). */
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

  const supplierId = String(body.supplier_id || "").trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const total = Number(body.total);
  const subtotal = Number(body.subtotal ?? body.total);

  if (!supplierId) {
    return withWorkshopCors(
      NextResponse.json({ error: "supplier_id مطلوب" }, { status: 400 })
    );
  }
  if (!items.length) {
    return withWorkshopCors(
      NextResponse.json({ error: "أضف بند توريد واحد على الأقل" }, { status: 400 })
    );
  }
  if (!(total >= 0) || Number.isNaN(total)) {
    return withWorkshopCors(
      NextResponse.json({ error: "الإجمالي غير صالح" }, { status: 400 })
    );
  }

  try {
    const client = await createServiceClient();
    const result = await createWorkshopExternalPurchase(client, {
      supplierId,
      items,
      subtotal: Number.isFinite(subtotal) ? subtotal : total,
      total,
      paidAmount: Number(body.paid_amount) || 0,
      safeId: body.safe_id,
      notes: body.notes,
      createdAt: body.created_at,
      sourceSystem: parseSource(body.source_system),
      sourceRef: body.source_ref,
    });
    return withWorkshopCors(NextResponse.json({ ok: true, ...result }));
  } catch (e) {
    return withWorkshopCors(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "تعذر إنشاء التوريد" },
        { status: 500 }
      )
    );
  }
}

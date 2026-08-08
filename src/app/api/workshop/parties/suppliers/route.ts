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
  searchStoreParties,
  upsertWorkshopParty,
  type WorkshopSourceSystem,
} from "@/lib/workshop-parties";

export const runtime = "nodejs";

function parseSource(raw: unknown): WorkshopSourceSystem {
  return String(raw || "").toLowerCase() === "plisse" ? "plisse" : "aa";
}

export async function OPTIONS() {
  return workshopCorsPreflight();
}

export async function GET(request: NextRequest) {
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

  const q = request.nextUrl.searchParams.get("q") || "";
  const limit = Math.min(
    100,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 30)
  );

  try {
    const client = await createServiceClient();
    const suppliers = await searchStoreParties(client, "supplier", q, limit);
    return withWorkshopCors(NextResponse.json({ suppliers }));
  } catch (e) {
    return withWorkshopCors(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "تعذر البحث" },
        { status: 500 }
      )
    );
  }
}

type PostBody = {
  source_system?: string;
  local_party_id?: string | null;
  name?: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
};

/** Quick-create / upsert supplier in store. */
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

  const name = String(body.name || "").trim();
  if (!name) {
    return withWorkshopCors(
      NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 })
    );
  }

  try {
    const client = await createServiceClient();
    const result = await upsertWorkshopParty(client, {
      kind: "supplier",
      sourceSystem: parseSource(body.source_system),
      localPartyId: body.local_party_id,
      name,
      phone: body.phone,
      address: body.address,
      notes: body.notes,
    });
    return withWorkshopCors(
      NextResponse.json({
        ok: true,
        supplier: result.party,
        store_supplier_id: result.party.id,
        created: result.created,
        mapped: result.mapped,
      })
    );
  } catch (e) {
    return withWorkshopCors(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "تعذر حفظ المورد" },
        { status: 500 }
      )
    );
  }
}

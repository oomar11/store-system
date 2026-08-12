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
import { normalizeBusinessLines } from "@/lib/business-lines";
import { businessLinesFromNotes } from "@/lib/customer-business-lines";

export const runtime = "nodejs";

function parseSource(raw: unknown): WorkshopSourceSystem {
  return String(raw || "").toLowerCase() === "plisse" ? "plisse" : "aa";
}

function withBusinessLines<T extends { notes?: string | null; business_lines?: unknown }>(
  row: T
) {
  const fromCols = normalizeBusinessLines(row.business_lines);
  const fromNotes = businessLinesFromNotes(row.notes);
  return {
    ...row,
    business_lines: fromCols.length > 0 ? fromCols : fromNotes,
  };
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
  const idParam = request.nextUrl.searchParams.get("id") || "";
  const idsParam = request.nextUrl.searchParams.get("ids") || "";
  const limit = Math.min(
    100,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 30)
  );

  try {
    const client = await createServiceClient();

    const ids = [
      ...idParam.split(","),
      ...idsParam.split(","),
    ]
      .map((v) => v.trim())
      .filter(Boolean);

    if (ids.length > 0) {
      const unique = Array.from(new Set(ids)).slice(0, 100);
      let { data, error } = await client
        .from("customers")
        .select(
          "id, name, phone, address, notes, balance, is_active, created_at, business_lines"
        )
        .in("id", unique);
      if (error && /business_lines/i.test(error.message || "")) {
        const retry = await client
          .from("customers")
          .select(
            "id, name, phone, address, notes, balance, is_active, created_at"
          )
          .in("id", unique);
        data = retry.data as typeof data;
        error = retry.error;
      }
      if (error) throw new Error(error.message);
      const customers = (data || []).map((row) => withBusinessLines(row));
      return withWorkshopCors(NextResponse.json({ customers }));
    }

    const customers = await searchStoreParties(client, "customer", q, limit);
    return withWorkshopCors(
      NextResponse.json({
        customers: customers.map((c) => withBusinessLines(c)),
      })
    );
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

/** Upsert customer in store (source of truth) and map workshop local id. */
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
      kind: "customer",
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
        customer: {
          ...result.party,
          business_lines: normalizeBusinessLines(result.party.business_lines),
        },
        store_customer_id: result.party.id,
        created: result.created,
        mapped: result.mapped,
      })
    );
  } catch (e) {
    return withWorkshopCors(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "تعذر حفظ العميل" },
        { status: 500 }
      )
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import {
  listMergedWorkshopCustomers,
  listWorkshopPartyMapsForStoreParty,
  splitWorkshopPartyMapLink,
  type WorkshopSourceSystem,
} from "@/lib/workshop-parties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireOwner() {
  const supabase = await createServerSupabaseClient();
  const { data: isOwner } = await supabase.rpc("is_owner");
  if (!isOwner) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "فصل روابط الجسر للمالك فقط" },
        { status: 403 }
      ),
    };
  }
  return { ok: true as const, supabase };
}

/** GET ?customer_id= | ?q=عمر — list maps / merged customers */
export async function GET(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return auth.response;

  try {
    const service = await createServiceClient();
    const customerId = String(
      req.nextUrl.searchParams.get("customer_id") || ""
    ).trim();
    const q = String(req.nextUrl.searchParams.get("q") || "").trim();

    if (customerId) {
      const maps = await listWorkshopPartyMapsForStoreParty(service, {
        storePartyId: customerId,
        partyType: "customer",
      });
      return NextResponse.json({ ok: true, customer_id: customerId, maps });
    }

    const merged = await listMergedWorkshopCustomers(service, {
      nameQuery: q || null,
      limit: q ? 30 : 20,
    });
    return NextResponse.json({ ok: true, customers: merged });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذر قراءة الروابط" },
      { status: 500 }
    );
  }
}

/** POST — split one workshop map link off a merged store customer */
export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      store_party_id?: string;
      source_system?: string;
      local_party_id?: string;
      new_name?: string | null;
    };

    if (body.action !== "split") {
      return NextResponse.json({ error: "action غير صالح" }, { status: 400 });
    }

    const sourceSystem = String(body.source_system || "")
      .trim()
      .toLowerCase() as WorkshopSourceSystem;
    if (sourceSystem !== "aa" && sourceSystem !== "plisse") {
      return NextResponse.json(
        { error: "source_system يجب أن يكون aa أو plisse" },
        { status: 400 }
      );
    }

    const service = await createServiceClient();
    const result = await splitWorkshopPartyMapLink(service, {
      storePartyId: String(body.store_party_id || ""),
      sourceSystem,
      localPartyId: String(body.local_party_id || ""),
      partyType: "customer",
      newName: body.new_name || null,
    });

    return NextResponse.json({
      ok: true,
      new_customer_id: result.newParty.id,
      new_customer: result.newParty,
      moved_entries: result.movedEntries,
      warning: result.warning,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "تعذر فصل الرابط" },
      { status: 500 }
    );
  }
}

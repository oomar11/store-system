import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import {
  requireWorkshopBridgeSecret,
  isWorkshopBridgeConfigured,
} from "@/lib/workshop-bridge";
import {
  workshopCorsPreflight,
  withWorkshopCors,
} from "@/lib/workshop-bridge-cors";
import {
  detachLedgerProjectsToNewCustomers,
  listMergedWorkshopCustomers,
  listWorkshopPartyMapsForStoreParty,
  resetWronglyMergedStoreCustomer,
  splitWorkshopPartyMapLink,
  type WorkshopSourceSystem,
} from "@/lib/workshop-parties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireOwnerOrBridge(req: NextRequest) {
  if (await isWorkshopBridgeConfigured()) {
    if (await requireWorkshopBridgeSecret(req)) {
      return { ok: true as const, via: "bridge" as const };
    }
  }
  const supabase = await createServerSupabaseClient();
  const { data: isOwner } = await supabase.rpc("is_owner");
  if (!isOwner) {
    return {
      ok: false as const,
      response: withWorkshopCors(
        NextResponse.json(
          { error: "فصل روابط الجسر للمالك أو بمفتاح الجسر فقط" },
          { status: 403 }
        )
      ),
    };
  }
  return { ok: true as const, via: "owner" as const };
}

export async function OPTIONS() {
  return workshopCorsPreflight();
}

/** GET ?customer_id= | ?q=عمر — list maps / merged customers */
export async function GET(req: NextRequest) {
  const auth = await requireOwnerOrBridge(req);
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
      return withWorkshopCors(
        NextResponse.json({ ok: true, customer_id: customerId, maps })
      );
    }

    const merged = await listMergedWorkshopCustomers(service, {
      nameQuery: q || null,
      limit: q ? 30 : 20,
    });
    return withWorkshopCors(NextResponse.json({ ok: true, customers: merged }));
  } catch (e) {
    return withWorkshopCors(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "تعذر قراءة الروابط" },
        { status: 500 }
      )
    );
  }
}

/**
 * POST actions:
 * - split: detach one workshop_party_map link
 * - detach_projects_keep_ledger: move each sale project to its own customer + drop maps
 * - reset_merged: delete maps + void all workshop ledger on the party (then re-sync from PVC)
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwnerOrBridge(req);
  if (!auth.ok) return auth.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      store_party_id?: string;
      source_system?: string;
      local_party_id?: string;
      new_name?: string | null;
    };

    const action = String(body.action || "").trim();
    const storePartyId = String(body.store_party_id || "").trim();
    const service = await createServiceClient();

    if (action === "split") {
      const sourceSystem = String(body.source_system || "")
        .trim()
        .toLowerCase() as WorkshopSourceSystem;
      if (sourceSystem !== "aa" && sourceSystem !== "plisse") {
        return withWorkshopCors(
          NextResponse.json(
            { error: "source_system يجب أن يكون aa أو plisse" },
            { status: 400 }
          )
        );
      }
      const result = await splitWorkshopPartyMapLink(service, {
        storePartyId,
        sourceSystem,
        localPartyId: String(body.local_party_id || ""),
        partyType: "customer",
        newName: body.new_name || null,
      });
      return withWorkshopCors(
        NextResponse.json({
          ok: true,
          new_customer_id: result.newParty.id,
          new_customer: result.newParty,
          moved_entries: result.movedEntries,
          warning: result.warning,
        })
      );
    }

    if (action === "reset_merged") {
      if (!storePartyId) {
        return withWorkshopCors(
          NextResponse.json({ error: "store_party_id مطلوب" }, { status: 400 })
        );
      }
      const result = await resetWronglyMergedStoreCustomer(service, {
        storePartyId,
        partyType: "customer",
      });
      return withWorkshopCors(
        NextResponse.json({
          ok: true,
          maps_deleted: result.mapsDeleted,
          entries_voided: result.entriesVoided,
          balance_after: result.balanceAfter,
          voided_refs: result.voidedRefs,
          next_step:
            "من ورشة PVC: إعدادات → إعادة مزامنة المتجر عشان تترحّل المشاريع على العملاء الصح",
        })
      );
    }

    if (action === "detach_projects_keep_ledger") {
      if (!storePartyId) {
        return withWorkshopCors(
          NextResponse.json({ error: "store_party_id مطلوب" }, { status: 400 })
        );
      }
      const detached = await detachLedgerProjectsToNewCustomers(service, {
        storePartyId,
      });
      const { data: maps } = await service
        .from("workshop_party_map")
        .select("id")
        .eq("store_party_id", storePartyId)
        .eq("party_type", "customer");
      if ((maps || []).length > 0) {
        const { error: delErr } = await service
          .from("workshop_party_map")
          .delete()
          .eq("store_party_id", storePartyId)
          .eq("party_type", "customer");
        if (delErr) throw new Error(delErr.message);
      }
      return withWorkshopCors(
        NextResponse.json({
          ok: true,
          created: detached.created,
          leftover_entries: detached.leftoverEntries,
          maps_deleted: (maps || []).length,
          next_step:
            "من ورشة PVC: إعادة مزامنة المتجر — العملاء الحقيقيين هيتربطوا والقيود هتتنقل لهم بالـ source_ref",
        })
      );
    }

    return withWorkshopCors(
      NextResponse.json({ error: "action غير صالح" }, { status: 400 })
    );
  } catch (e) {
    return withWorkshopCors(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "تعذر فصل الرابط" },
        { status: 500 }
      )
    );
  }
}

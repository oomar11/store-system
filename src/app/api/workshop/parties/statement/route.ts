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
import { buildUnifiedCustomerStatement } from "@/lib/workshop-parties";

export const runtime = "nodejs";

export async function OPTIONS() {
  return workshopCorsPreflight();
}

/** Unified chronological statement for a store customer (includes workshops). */
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

  const customerId = (
    request.nextUrl.searchParams.get("customer_id") || ""
  ).trim();
  if (!customerId) {
    return withWorkshopCors(
      NextResponse.json({ error: "customer_id مطلوب" }, { status: 400 })
    );
  }

  const dateFrom = request.nextUrl.searchParams.get("from");
  const dateTo = request.nextUrl.searchParams.get("to");
  const linkedSupplierId = request.nextUrl.searchParams.get(
    "linked_supplier_id"
  );

  try {
    const client = await createServiceClient();
    const statement = await buildUnifiedCustomerStatement(client, {
      customerId,
      linkedSupplierId,
      dateFrom,
      dateTo,
    });
    if (!statement.customer) {
      return withWorkshopCors(
        NextResponse.json({ error: "العميل غير موجود" }, { status: 404 })
      );
    }
    return withWorkshopCors(NextResponse.json({ ok: true, ...statement }));
  } catch (e) {
    return withWorkshopCors(
      NextResponse.json(
        { error: e instanceof Error ? e.message : "تعذر بناء الكشف" },
        { status: 500 }
      )
    );
  }
}

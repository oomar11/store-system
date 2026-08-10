import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import {
  isWorkshopBridgeConfigured,
  requireWorkshopBridgeSecret,
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

/** List active safes for workshop bridge setup. */
export async function GET(request: NextRequest) {
  if (!(await isWorkshopBridgeConfigured())) {
    return withCors(
      NextResponse.json(
        {
          error: "جسر الورشة غير مضبوط — أضف المفتاح في workshop_bridge_config أو WORKSHOP_BRIDGE_SECRET",
          configured: false,
        },
        { status: 503 }
      )
    );
  }

  if (!(await requireWorkshopBridgeSecret(request))) {
    return withCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  try {
    const client = await createServiceClient();
    const { data, error } = await client
      .from("safes")
      .select("id, name, balance, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return withCors(
        NextResponse.json(
          { error: error.message || "تعذر تحميل الخزن" },
          { status: 500 }
        )
      );
    }

    return withCors(
      NextResponse.json({
        ok: true,
        configured: true,
        safes: data || [],
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر تحميل الخزن";
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

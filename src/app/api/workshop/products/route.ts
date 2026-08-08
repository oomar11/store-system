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
import { smartSearchMatch } from "@/lib/utils";

export const runtime = "nodejs";

const FETCH_LIMIT = 400;
const RESULT_LIMIT = 40;

export async function OPTIONS() {
  return workshopCorsPreflight();
}

/** Search active store products for workshop material issue (phone). */
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

  const q = request.nextUrl.searchParams.get("q")?.trim() || "";

  try {
    const client = await createServiceClient();
    const { data, error } = await client
      .from("products")
      .select(
        "id, name, sku, unit, quantity, sell_price, buy_price, is_active, category:categories(name)"
      )
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(FETCH_LIMIT);

    if (error) {
      return withWorkshopCors(
        NextResponse.json(
          { error: error.message || "تعذر تحميل الأصناف" },
          { status: 500 }
        )
      );
    }

    type Row = {
      id: string;
      name: string;
      sku: string | null;
      unit: string | null;
      quantity: number | null;
      sell_price: number | null;
      buy_price: number | null;
      category?: { name?: string | null } | null;
    };

    let rows = (data || []) as Row[];
    if (q) {
      rows = rows.filter((p) => smartSearchMatch(q, [p.name, p.sku]));
    }

    const products = rows.slice(0, RESULT_LIMIT).map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku || "",
      unit: p.unit || "قطعة",
      stock: Number(p.quantity) || 0,
      sale_price: Number(p.sell_price) || 0,
      cost: Number(p.buy_price) || 0,
      category_name: p.category?.name || null,
    }));

    return withWorkshopCors(
      NextResponse.json({
        ok: true,
        count: products.length,
        products,
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر تحميل الأصناف";
    return withWorkshopCors(
      NextResponse.json({ error: message }, { status: 500 })
    );
  }
}

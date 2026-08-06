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

export const runtime = "nodejs";

export async function OPTIONS() {
  return workshopCorsPreflight();
}

type InboxItemSummary = {
  product_id?: string;
  name?: string;
  quantity?: number;
  unit_price?: number;
  total?: number;
};

/** List workshop invoice inbox rows (default: pending). */
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

  const statusParam =
    request.nextUrl.searchParams.get("status")?.trim() || "pending";
  const allowed = new Set(["pending", "assigned", "dismissed", "all"]);
  if (!allowed.has(statusParam)) {
    return withWorkshopCors(
      NextResponse.json({ error: "status غير صالح" }, { status: 400 })
    );
  }

  try {
    const client = await createServiceClient();
    let q = client
      .from("workshop_invoice_inbox")
      .select(
        "id, invoice_id, invoice_number, total, invoice_date, notes, items_summary, status, assigned_project_key, assigned_project_name, assigned_at, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (statusParam !== "all") {
      q = q.eq("status", statusParam);
    }
    const { data, error } = await q;
    if (error) {
      return withWorkshopCors(
        NextResponse.json(
          { error: error.message || "تعذر تحميل الصندوق" },
          { status: 500 }
        )
      );
    }

    const invoices = (data || []).map((row) => ({
      id: row.id,
      invoice_id: row.invoice_id,
      invoice_number: row.invoice_number,
      total: Number(row.total) || 0,
      invoice_date: row.invoice_date,
      notes: row.notes,
      items_summary: (row.items_summary || []) as InboxItemSummary[],
      status: row.status,
      assigned_project_key: row.assigned_project_key,
      assigned_project_name: row.assigned_project_name,
      assigned_at: row.assigned_at,
      created_at: row.created_at,
      updated_at: (row as { updated_at?: string | null }).updated_at || null,
    }));

    return withWorkshopCors(
      NextResponse.json({
        ok: true,
        count: invoices.length,
        invoices,
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر تحميل الصندوق";
    return withWorkshopCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}

type PostBody = {
  invoice_id?: string;
  action?: "assign" | "dismiss";
  project_key?: string;
  project_name?: string;
};

/** Assign inbox row to a workshop project, or dismiss it. */
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

  const invoiceId = String(body.invoice_id || "").trim();
  const action = body.action;
  if (!invoiceId) {
    return withWorkshopCors(
      NextResponse.json({ error: "invoice_id مطلوب" }, { status: 400 })
    );
  }
  if (action !== "assign" && action !== "dismiss") {
    return withWorkshopCors(
      NextResponse.json(
        { error: "action يجب أن يكون assign أو dismiss" },
        { status: 400 }
      )
    );
  }
  if (action === "assign" && !String(body.project_key || "").trim()) {
    return withWorkshopCors(
      NextResponse.json({ error: "project_key مطلوب للتعيين" }, { status: 400 })
    );
  }

  try {
    const client = await createServiceClient();
    const { data: existing, error: findErr } = await client
      .from("workshop_invoice_inbox")
      .select("id, status, invoice_id, invoice_number, total")
      .eq("invoice_id", invoiceId)
      .maybeSingle();

    if (findErr) {
      throw new Error(findErr.message);
    }
    if (!existing) {
      return withWorkshopCors(
        NextResponse.json(
          { error: "الفاتورة مش موجودة في صندوق الورشة" },
          { status: 404 }
        )
      );
    }

    if (action === "dismiss") {
      const { error } = await client
        .from("workshop_invoice_inbox")
        .update({
          status: "dismissed",
          assigned_project_key: null,
          assigned_project_name: null,
          assigned_at: new Date().toISOString(),
        })
        .eq("invoice_id", invoiceId);
      if (error) throw new Error(error.message);
      return withWorkshopCors(
        NextResponse.json({
          ok: true,
          invoice_id: invoiceId,
          status: "dismissed",
        })
      );
    }

    const projectKey = String(body.project_key || "").trim();
    const projectName = String(body.project_name || "").trim() || null;
    const { error } = await client
      .from("workshop_invoice_inbox")
      .update({
        status: "assigned",
        assigned_project_key: projectKey,
        assigned_project_name: projectName,
        assigned_at: new Date().toISOString(),
      })
      .eq("invoice_id", invoiceId);
    if (error) throw new Error(error.message);

    return withWorkshopCors(
      NextResponse.json({
        ok: true,
        invoice_id: invoiceId,
        status: "assigned",
        project_key: projectKey,
        project_name: projectName,
        total: Number(existing.total) || 0,
        invoice_number: existing.invoice_number,
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر تحديث الصندوق";
    return withWorkshopCors(NextResponse.json({ error: message }, { status: 400 }));
  }
}

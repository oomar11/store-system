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
import { createCompletedInvoice } from "@/lib/create-invoice";
import {
  mapCartToInvoiceItems,
} from "@/lib/invoice-cost";
import { catalogUnitCostFromProduct } from "@/lib/product-cost";
import { roundMoney } from "@/lib/utils";

export const runtime = "nodejs";

type IssueLineInput = {
  product_id?: string;
  quantity?: number;
  unit_price?: number;
  discount?: number;
};

type PostBody = {
  items?: IssueLineInput[];
  discount_amount?: number;
  discount_type?: "amount" | "percent";
  project_key?: string;
  project_name?: string;
  notes?: string | null;
  client_op_id?: string | null;
};

export async function OPTIONS() {
  return workshopCorsPreflight();
}

/**
 * Create a for-workshop sale from the workshop phone UI and assign it
 * immediately to a project (no pending inbox step).
 */
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

  const projectKey = String(body.project_key || "").trim();
  const projectName = String(body.project_name || "").trim() || null;
  if (!projectKey) {
    return withWorkshopCors(
      NextResponse.json({ error: "project_key مطلوب" }, { status: 400 })
    );
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) {
    return withWorkshopCors(
      NextResponse.json({ error: "أضف صنفاً واحداً على الأقل" }, { status: 400 })
    );
  }

  const discountType =
    body.discount_type === "percent" ? "percent" : "amount";
  const discountInput = Math.max(0, Number(body.discount_amount) || 0);

  try {
    const client = await createServiceClient();
    const productIds = [
      ...new Set(
        rawItems
          .map((l) => String(l.product_id || "").trim())
          .filter(Boolean)
      ),
    ];
    if (!productIds.length) {
      return withWorkshopCors(
        NextResponse.json({ error: "product_id مطلوب لكل بند" }, { status: 400 })
      );
    }

    const { data: productRows, error: productsErr } = await client
      .from("products")
      .select(
        "id, name, sku, unit, quantity, sell_price, buy_price, is_active, category:categories(name)"
      )
      .in("id", productIds);

    if (productsErr) {
      throw new Error(productsErr.message || "تعذر تحميل الأصناف");
    }

    type ProductRow = {
      id: string;
      name: string;
      sku: string | null;
      unit: string | null;
      quantity: number | null;
      sell_price: number | null;
      buy_price: number | null;
      is_active: boolean | null;
      category?: { name?: string | null } | null;
    };

    const byId = new Map(
      ((productRows || []) as ProductRow[]).map((p) => [p.id, p])
    );

    const cart: Array<{
      product: {
        id: string;
        buy_price: number;
        sell_price: number;
        category?: { name?: string | null } | null;
      };
      quantity: number;
      unit_price: number;
      discount: number;
      total: number;
      unit_cost: number;
      /** display fields kept alongside for summary */
      _name: string;
    }> = [];

    for (const line of rawItems) {
      const productId = String(line.product_id || "").trim();
      const product = byId.get(productId);
      if (!product || product.is_active === false) {
        return withWorkshopCors(
          NextResponse.json(
            { error: `صنف غير موجود أو غير نشط: ${productId || "؟"}` },
            { status: 400 }
          )
        );
      }

      const quantity = Number(line.quantity);
      if (!(quantity > 0)) {
        return withWorkshopCors(
          NextResponse.json(
            { error: `كمية غير صالحة للصنف «${product.name}»` },
            { status: 400 }
          )
        );
      }

      const stock = Number(product.quantity) || 0;
      if (quantity > stock + 0.0005) {
        return withWorkshopCors(
          NextResponse.json(
            {
              error: `المخزون غير كافٍ لـ «${product.name}» (متاح ${stock})`,
            },
            { status: 400 }
          )
        );
      }

      const sellPrice = Number(product.sell_price) || 0;
      const buyPrice = Number(product.buy_price) || 0;
      const unitPrice =
        line.unit_price != null && !Number.isNaN(Number(line.unit_price))
          ? Math.max(0, Number(line.unit_price))
          : sellPrice;
      const lineDiscount = Math.max(0, Number(line.discount) || 0);
      const lineTotal = roundMoney(
        Math.max(0, quantity * unitPrice - lineDiscount)
      );

      let unitCost = buyPrice;
      if (!(unitCost > 0)) {
        unitCost = catalogUnitCostFromProduct({
          sell_price: sellPrice,
          category: product.category,
        });
      }

      cart.push({
        product: {
          id: product.id,
          buy_price: buyPrice,
          sell_price: sellPrice,
          category: product.category,
        },
        quantity,
        unit_price: unitPrice,
        discount: lineDiscount,
        total: lineTotal,
        unit_cost: unitCost,
        _name: product.name,
      });
    }

    const subtotal = roundMoney(cart.reduce((sum, item) => sum + item.total, 0));
    const discountAmount = roundMoney(
      discountType === "percent"
        ? (subtotal * discountInput) / 100
        : discountInput
    );
    if (discountAmount > subtotal + 0.001) {
      return withWorkshopCors(
        NextResponse.json(
          { error: "الخصم أكبر من إجمالي البنود" },
          { status: 400 }
        )
      );
    }
    const total = roundMoney(Math.max(0, subtotal - discountAmount));

    const saleItems = mapCartToInvoiceItems("pending", cart, { kind: "sale" });

    const notesParts = [
      String(body.notes || "").trim() || null,
      projectName ? `مشروع: ${projectName}` : `مشروع: ${projectKey}`,
    ].filter(Boolean);

    const invoice = await createCompletedInvoice(client, {
      type: "sale",
      items: saleItems,
      subtotal,
      taxAmount: 0,
      discountAmount,
      total,
      paidAmount: total,
      paymentMethod: "cash",
      safeId: null,
      notes: notesParts.join(" — "),
      clientOpId: body.client_op_id || null,
      forWorkshop: true,
    });

    const { error: assignErr } = await client
      .from("workshop_invoice_inbox")
      .update({
        status: "assigned",
        assigned_project_key: projectKey,
        assigned_project_name: projectName,
        assigned_at: new Date().toISOString(),
      })
      .eq("invoice_id", invoice.id);

    if (assignErr) {
      throw new Error(
        assignErr.message || "تم إنشاء الفاتورة لكن تعذر تعيين المشروع"
      );
    }

    const items_summary = cart.map((item) => ({
      product_id: item.product.id,
      name: item._name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total: item.total,
    }));

    return withWorkshopCors(
      NextResponse.json({
        ok: true,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        subtotal,
        discount_amount: discountAmount,
        total,
        items_summary,
        project_key: projectKey,
        project_name: projectName,
        status: "assigned",
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "تعذر صرف الخامات";
    return withWorkshopCors(
      NextResponse.json({ error: message }, { status: 400 })
    );
  }
}

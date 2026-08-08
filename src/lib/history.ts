import { createClient } from "@/lib/supabase";
import { partyPaymentDocNumber } from "@/lib/party-payments";

export type MovementRow = {
  id: string;
  quantity: number;
  unit_price: number;
  total: number;
  isOpening?: boolean;
  /** الرصيد بعد الحركة (محسوب من الافتتاحي ثم الحركات بالترتيب الزمني) */
  running_balance?: number;
  invoice: {
    id: string;
    invoice_number: string;
    type: string;
    created_at: string;
    status: string;
    customer?: { name: string } | null;
    supplier?: { name: string } | null;
  } | null;
};

export type PartyInvoiceRow = {
  id: string;
  invoice_number: string;
  type: string;
  total: number;
  paid_amount: number;
  created_at: string;
  status: string;
  notes?: string | null;
  payment_method?: string | null;
  isOpening?: boolean;
  /** صف تحصيل/سداد مجمّع من party_payments */
  isPartyPayment?: boolean;
  partyPaymentId?: string;
};

const typeLabels: Record<string, string> = {
  sale: "بيع",
  purchase: "شراء",
  sale_return: "مرتجع بيع",
  purchase_return: "مرتجع شراء",
  opening: "رصيد افتتاحي",
  collection: "تحصيل",
  disbursement: "سداد",
  settlement: "مقاصة",
};

export function invoiceTypeLabel(type: string) {
  return typeLabels[type] || type;
}

/** Stock direction for display: + in, - out */
export function movementSign(type: string): number {
  if (type === "purchase" || type === "sale_return" || type === "opening") return 1;
  if (type === "sale" || type === "purchase_return") return -1;
  return 0;
}

/** Deep-link to open/edit the related operation from product history */
export function invoiceOperationHref(type: string, invoiceId: string): string {
  switch (type) {
    case "sale":
      return `/pos?edit=${invoiceId}`;
    case "purchase":
      return `/pos?mode=purchase&edit=${invoiceId}`;
    case "sale_return":
    case "purchase_return":
      return `/sales?tab=returns`;
    default:
      return `/sales`;
  }
}

/** صف رصيد افتتاحي يظهر أول حركة الصنف (حتى لو صفر) */
export function buildOpeningMovementRow(product: {
  id: string;
  opening_quantity?: number;
  buy_price: number;
  created_at: string;
}): MovementRow {
  const qty = Number(product.opening_quantity ?? 0);
  return {
    id: `opening-${product.id}`,
    quantity: qty,
    unit_price: Number(product.buy_price) || 0,
    total: qty * (Number(product.buy_price) || 0),
    isOpening: true,
    invoice: {
      id: product.id,
      invoice_number: "افتتاحي",
      type: "opening",
      // تاريخ قديم لضمان ظهوره أول الجدول زمنياً
      created_at: product.created_at || "1970-01-01T00:00:00.000Z",
      status: "completed",
    },
  };
}

/**
 * يرتّب حركة الصنف: رصيد افتتاحي أولاً ثم الحركات من الأقدم للأحدث،
 * ويحسب الرصيد الجاري بعد كل صف.
 */
export function assembleProductMovements(
  product: {
    id: string;
    opening_quantity?: number;
    buy_price: number;
    created_at: string;
  },
  rows: MovementRow[]
): MovementRow[] {
  const opening = buildOpeningMovementRow(product);
  const sorted = [...rows]
    .filter((row) => row.invoice && !row.isOpening && row.invoice.type !== "opening")
    .sort(
      (a, b) =>
        new Date(a.invoice!.created_at).getTime() -
        new Date(b.invoice!.created_at).getTime()
    );

  const sequence = [opening, ...sorted];
  let balance = 0;
  return sequence.map((row) => {
    const sign = movementSign(row.invoice!.type);
    balance += sign * Number(row.quantity);
    return { ...row, running_balance: balance };
  });
}

/** صف رصيد افتتاحي لحركة عميل/مورد */
export function buildPartyOpeningRow(party: {
  id: string;
  opening_balance?: number;
  created_at: string;
}): PartyInvoiceRow | null {
  const opening = Number(party.opening_balance ?? 0);
  if (opening === 0) return null;
  return {
    id: `opening-${party.id}`,
    invoice_number: "افتتاحي",
    type: "opening",
    total: Math.abs(opening),
    paid_amount: 0,
    created_at: party.created_at,
    status: "completed",
    notes: opening > 0 ? "مدين (عليه/علينا)" : "دائن (له/لنا)",
    isOpening: true,
  };
}

export async function fetchProductMovements(productId: string): Promise<MovementRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("invoice_items")
    .select(
      "id, quantity, unit_price, total, invoice:invoices(id, invoice_number, type, created_at, status, customer:customers(name), supplier:suppliers(name))"
    )
    .eq("product_id", productId)
    .order("id", { ascending: false })
    .limit(500);

  const rows = (data || []) as unknown as MovementRow[];
  return rows
    .filter((row) => row.invoice && row.invoice.status !== "cancelled")
    .sort(
      (a, b) =>
        new Date(a.invoice!.created_at).getTime() -
        new Date(b.invoice!.created_at).getTime()
    );
}

export async function fetchCustomerHistory(customerId: string): Promise<PartyInvoiceRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, type, total, paid_amount, created_at, status, notes, payment_method"
    )
    .eq("customer_id", customerId)
    .in("type", ["sale", "sale_return"])
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data || []) as PartyInvoiceRow[]).filter(
    (row) => row.status !== "cancelled"
  );
}

export async function fetchSupplierHistory(supplierId: string): Promise<PartyInvoiceRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, type, total, paid_amount, created_at, status, notes, payment_method"
    )
    .eq("supplier_id", supplierId)
    .in("type", ["purchase", "purchase_return"])
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data || []) as PartyInvoiceRow[]).filter(
    (row) => row.status !== "cancelled"
  );
}

/** تحويل دفعة مجمّعة لصف يظهر في حركة العميل/المورد والطباعة */
export function partyPaymentToHistoryRow(payment: {
  id: string;
  party_type: "customer" | "supplier";
  amount: number;
  created_at: string;
  notes?: string | null;
  safe_name?: string;
  is_settlement?: boolean | null;
  allocations?: { invoice_number?: string; amount: number }[];
}): PartyInvoiceRow {
  const amount = Number(payment.amount) || 0;
  const isSettlement = Boolean(payment.is_settlement);
  const allocNote = (payment.allocations || [])
    .map(
      (a) =>
        `${a.invoice_number || "فاتورة"}: ${Number(a.amount).toFixed(2)}`
    )
    .join(" · ");
  const notes = [payment.notes, allocNote ? `توزيع: ${allocNote}` : null]
    .filter(Boolean)
    .join(" — ");

  const shortId = payment.id.replace(/-/g, "").slice(0, 8).toUpperCase();

  return {
    id: `party-pay-${payment.id}`,
    invoice_number: isSettlement
      ? `مقاصة-${shortId}`
      : partyPaymentDocNumber(payment.id, payment.party_type),
    type: isSettlement
      ? "settlement"
      : payment.party_type === "customer"
        ? "collection"
        : "disbursement",
    total: amount,
    paid_amount: amount,
    created_at: payment.created_at,
    status: "completed",
    notes: notes || null,
    payment_method: isSettlement ? "مقاصة" : payment.safe_name || null,
    isPartyPayment: true,
    partyPaymentId: payment.id,
  };
}

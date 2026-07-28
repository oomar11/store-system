import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "invoice.delete"
  | "product.price_change"
  | "safe.movement"
  | "safe.transfer"
  | "settings.update"
  | "user.update"
  | "user.delete"
  | "system.factory_reset";

export type LogAuditEventInput = {
  action: AuditAction | string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  source?: string;
  /** For service-role calls without auth.uid() */
  actorId?: string | null;
};

export async function logAuditEvent(
  supabase: SupabaseClient,
  input: LogAuditEventInput
): Promise<void> {
  const { error } = await supabase.rpc("log_audit_event", {
    p_action: input.action,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId || null,
    p_entity_label: input.entityLabel || null,
    p_before: input.before ?? null,
    p_after: input.after ?? null,
    p_meta: input.meta ?? {},
    p_source: input.source || "app",
    p_actor_id: input.actorId || null,
  });

  if (error) {
    // Never block the primary business action on audit failure
    console.error("audit log failed:", error.message);
  }
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "invoice.delete": "حذف فاتورة",
  "product.price_change": "تغيير سعر صنف",
  "product.delete": "حذف صنف",
  "product.activate": "تفعيل صنف",
  "product.deactivate": "إيقاف صنف",
  "customer.delete": "حذف عميل",
  "customer.activate": "تفعيل عميل",
  "customer.deactivate": "إيقاف عميل",
  "supplier.delete": "حذف مورد",
  "supplier.activate": "تفعيل مورد",
  "supplier.deactivate": "إيقاف مورد",
  "safe.activate": "تفعيل خزنة",
  "safe.deactivate": "إيقاف خزنة",
  "safe.movement": "حركة خزنة يدوية",
  "safe.movement.edit": "تعديل حركة خزنة",
  "safe.movement.delete": "حذف حركة خزنة",
  "safe.transfer": "تحويل بين خزائن",
  "safe.transfer.edit": "تعديل تحويل خزنة",
  "safe.transfer.delete": "حذف تحويل خزنة",
  "safe.update": "تعديل خزنة",
  "safe.delete": "حذف خزنة",
  "expense.create": "إضافة مصروف",
  "expense.update": "تعديل مصروف",
  "expense.delete": "حذف مصروف",
  "settings.update": "تعديل إعدادات",
  "user.update": "تعديل مستخدم",
  "user.delete": "حذف مستخدم",
  "system.factory_reset": "إعادة ضبط المصنع",
};

export const AUDIT_ENTITY_TYPE_LABELS: Record<string, string> = {
  invoice: "فاتورة",
  product: "صنف",
  safe: "خزنة",
  settings: "إعدادات",
  user: "مستخدم",
  system: "نظام",
  customer: "عميل",
  supplier: "مورد",
  expense: "مصروف",
};

export const AUDIT_SOURCE_LABELS: Record<string, string> = {
  app: "التطبيق",
  api: "واجهة برمجية",
  system: "النظام",
};

/** Technical keys hidden from the human-readable diff table */
const HIDDEN_AUDIT_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "actor_id",
  "user_id",
  "password",
  "password_hash",
  "hashed_password",
]);

export const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: "الاسم",
  full_name: "الاسم الكامل",
  email: "البريد",
  phone: "الهاتف",
  address: "العنوان",
  role: "الدور",
  is_active: "نشط",
  buy_price: "سعر الشراء",
  sell_price: "سعر البيع",
  quantity: "الكمية",
  sku: "الكود",
  barcode: "الباركود",
  pack_size: "التعبئة",
  min_stock: "حد التنبيه",
  category: "التصنيف",
  invoice_number: "رقم الفاتورة",
  total: "الإجمالي",
  subtotal: "المجموع",
  discount_amount: "الخصم",
  tax_amount: "الضريبة",
  paid_amount: "المدفوع",
  payment_method: "طريقة الدفع",
  customer_id: "العميل",
  supplier_id: "المورد",
  notes: "ملاحظات",
  type: "النوع",
  amount: "المبلغ",
  from_safe_id: "من خزنة",
  to_safe_id: "إلى خزنة",
  safe_id: "الخزنة",
  store_name: "اسم المحل",
  currency: "العملة",
  tax_enabled: "تفعيل الضريبة",
  tax_rate: "نسبة الضريبة",
  invoice_tagline: "عبارة الفاتورة",
  print_offset: "إزاحة الطباعة",
  password_changed: "تغيير كلمة المرور",
  balance: "الرصيد",
  kind: "النوع",
  status: "الحالة",
};

export type AuditFieldChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function auditFieldLabel(key: string): string {
  return AUDIT_FIELD_LABELS[key] || key;
}

export function formatAuditValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value === "boolean") {
    return value ? "نعم" : "لا";
  }

  if (key === "payment_method") {
    if (value === "cash") return "نقدي";
    if (value === "credit") return "آجل";
  }

  if (key === "type") {
    if (value === "deposit") return "إيداع";
    if (value === "withdraw" || value === "withdrawal") return "سحب";
  }

  if (key === "role") {
    if (value === "owner") return "مالك";
    if (value === "manager") return "مدير";
    if (value === "employee") return "موظف";
  }

  const moneyKeys = new Set([
    "buy_price",
    "sell_price",
    "total",
    "subtotal",
    "discount_amount",
    "tax_amount",
    "paid_amount",
    "amount",
    "balance",
  ]);
  if (moneyKeys.has(key) && (typeof value === "number" || typeof value === "string")) {
    const n = Number(value);
    if (!Number.isNaN(n)) {
      return `${n.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
    }
  }

  if (typeof value === "number") {
    return value.toLocaleString("ar-EG");
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function collectKeys(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  meta: Record<string, unknown> | null | undefined
): string[] {
  const keys = new Set<string>();
  for (const obj of [before, after, meta]) {
    if (!obj) continue;
    for (const key of Object.keys(obj)) {
      if (!HIDDEN_AUDIT_KEYS.has(key)) keys.add(key);
    }
  }
  return Array.from(keys);
}

/** Build Arabic before/after rows for changed (or present) fields */
export function buildAuditFieldChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  meta?: Record<string, unknown> | null
): AuditFieldChange[] {
  const beforeObj = before || {};
  const afterObj = after || {};
  const metaObj = meta || {};
  const keys = collectKeys(before, after, meta);

  const rows: AuditFieldChange[] = [];
  for (const key of keys) {
    const hasBefore = Object.prototype.hasOwnProperty.call(beforeObj, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(afterObj, key);
    const hasMeta = Object.prototype.hasOwnProperty.call(metaObj, key);

    if (hasBefore || hasAfter) {
      const b = hasBefore ? beforeObj[key] : undefined;
      const a = hasAfter ? afterObj[key] : undefined;
      if (hasBefore && hasAfter && JSON.stringify(b) === JSON.stringify(a)) {
        continue;
      }
      rows.push({
        key,
        label: auditFieldLabel(key),
        before: formatAuditValue(key, b),
        after: formatAuditValue(key, a),
      });
      continue;
    }

    if (hasMeta) {
      rows.push({
        key,
        label: auditFieldLabel(key),
        before: "—",
        after: formatAuditValue(key, metaObj[key]),
      });
    }
  }

  return rows;
}

export function entityTypeLabel(entityType: string): string {
  return AUDIT_ENTITY_TYPE_LABELS[entityType] || entityType;
}

export function sourceLabel(source: string): string {
  return AUDIT_SOURCE_LABELS[source] || source;
}

export type AuditLogRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  source: string;
};

/** رابط الصفحة المرتبطة بسجل التدقيق إن أمكن */
export function resolveAuditEntityHref(row: {
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data?: Record<string, unknown> | null;
  after_data?: Record<string, unknown> | null;
}): string | null {
  const id = row.entity_id;
  if (!id) {
    if (row.entity_type === "settings") return "/settings";
    if (row.entity_type === "safe") return "/treasury";
    if (row.entity_type === "expense") return "/expenses";
    return null;
  }

  switch (row.entity_type) {
    case "product":
      return `/products/${id}`;
    case "customer":
      return `/customers/${id}`;
    case "supplier":
      return `/suppliers/${id}`;
    case "invoice": {
      const type =
        (row.before_data?.type as string) ||
        (row.after_data?.type as string) ||
        "";
      if (type === "purchase" || type === "purchase_return") return `/purchases`;
      if (type === "sale_return") return `/sales?tab=returns`;
      if (type === "sale") return `/pos?edit=${id}`;
      return `/sales`;
    }
    case "expense":
      return `/expenses`;
    case "safe":
      return `/treasury`;
    case "user":
      return `/settings`;
    case "settings":
      return `/settings`;
    default:
      return null;
  }
}

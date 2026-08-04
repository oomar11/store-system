/** Local-first offline types: HLC ops, entities, sync */

import type { Hlc } from "@/lib/offline/hlc";

export type SyncEntityType =
  | "products"
  | "categories"
  | "customers"
  | "suppliers"
  | "safes"
  | "invoices"
  | "invoice_items"
  | "documents"
  | "document_items"
  | "settings"
  | "shifts"
  | "party_payments"
  | "party_payment_allocations"
  | "accounts"
  | "journal_entries"
  | "journal_lines"
  | "safe_transactions"
  | "inventory_counts"
  | "inventory_count_items"
  | "price_tiers"
  | "product_tier_prices"
  | "tier_category_discounts"
  | "tier_product_discounts"
  | "profiles"
  | "audit_logs";

export type OutboxOpKind = "upsert" | "delete" | "domain";

export type OutboxStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "superseded"
  | "rejected"
  | "conflict"
  | "cancelled";

export type SyncOutboxEntry = {
  id: string;
  device_id: string;
  entity_type: SyncEntityType | string;
  entity_id: string;
  op_kind: OutboxOpKind;
  domain_op: string | null;
  payload: Record<string, unknown>;
  base_version: number | null;
  hlc_physical_ms: number;
  hlc_counter: number;
  hlc_device_id: string;
  status: OutboxStatus;
  lastError: string | null;
  attempts: number;
  created_at: string;
  synced_at: string | null;
  result: Record<string, unknown> | null;
};

/** Legacy outbox shapes kept for migration / UI labels */
export type OutboxOpType = "invoice" | "party_payment" | "expense";

export type OutboxInvoicePayload = {
  type: "sale" | "purchase" | "sale_return" | "purchase_return";
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    unit_cost?: number;
    discount: number;
    total: number;
  }>;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paidAmount: number;
  paymentMethod: "cash" | "credit";
  customerId?: string | null;
  supplierId?: string | null;
  safeId?: string | null;
  notes?: string | null;
  originalInvoiceId?: string | null;
  tempNumber: string;
  label?: string;
  occurredAt?: string;
};

export type OutboxPartyPaymentPayload = {
  kind: "customer" | "supplier";
  partyId: string;
  amount: number;
  safeId: string;
  notes?: string | null;
  partyName?: string;
  tempNumber: string;
};

export type OutboxExpensePayload = {
  date: string;
  amount: number;
  description: string;
  notes?: string | null;
  expenseAccountId: string;
  safeId: string;
  accountName?: string;
  tempNumber: string;
};

/** @deprecated use SyncOutboxEntry — kept for OfflineQueuePanel compat */
export type OutboxEntry = {
  id: string;
  type: OutboxOpType;
  payload: OutboxInvoicePayload | OutboxPartyPaymentPayload | OutboxExpensePayload;
  occurred_at: string;
  status: OutboxStatus;
  lastError: string | null;
  attempts: number;
  created_at: string;
  synced_at: string | null;
  result_id: string | null;
  result_number: string | null;
};

export type IdMapRow = {
  local_id: string;
  remote_id: string;
  remote_number: string;
  kind: string;
  updated_at: string;
};

export type LocalEntityRow = {
  id: string;
  data: Record<string, unknown>;
  sync_version: number;
  deleted_at: string | null;
  last_hlc_physical_ms: number;
  last_hlc_counter: number;
  last_hlc_device_id: string | null;
  updated_at: string;
};

export type TombstoneRow = {
  entity_type: string;
  entity_id: string;
  hlc_physical_ms: number;
  hlc_counter: number;
  hlc_device_id: string;
  deleted_at: string;
  server_seq: number | null;
};

export type SyncChangeRow = {
  server_seq: number;
  entity_type: string;
  entity_id: string;
  op_kind: string;
  version: number;
  hlc_physical_ms: number;
  hlc_counter: number;
  hlc_device_id: string;
  row_data: Record<string, unknown> | null;
  deleted: boolean;
};

export type DeviceState = {
  id: "main";
  device_id: string;
  label: string;
  checkpoint: number;
  bootstrapped_at: string | null;
  last_sync_at: string | null;
  clock_offset_ms: number;
  storage_persisted: boolean | null;
  last_hlc: Hlc | null;
};

export type MetaRow = { key: string; value: string };

export type SnapshotProduct = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  buy_price: number;
  sell_price: number;
  unit: string | null;
  category_id: string | null;
  is_active: boolean;
  pack_size?: number | null;
  notify_low_stock?: boolean | null;
  min_quantity?: number | null;
};

export type SnapshotParty = {
  id: string;
  name: string;
  phone: string | null;
  balance: number;
  kind: "customer" | "supplier";
  price_tier_id?: string | null;
  /** Nested tier for POS badge offline (optional, rebuilt from price_tiers) */
  price_tier?: {
    id: string;
    name: string;
    is_default: boolean;
  } | null;
  is_active?: boolean;
  last_activity_at?: string | null;
};

export type SnapshotSafe = {
  id: string;
  name: string;
  balance: number;
  is_active: boolean;
  sort_order?: number | null;
};

export type SnapshotSettings = Record<string, unknown>;

export type SnapshotTierPricing = {
  tiers?: Array<{
    id: string;
    name: string;
    is_default: boolean;
  }>;
  tierPrices: Array<{ product_id: string; tier_id: string; sell_price: number }>;
  categoryDiscounts: Array<{
    tier_id: string;
    category_id: string;
    discount_percent: number;
  }>;
  productDiscounts: Array<{
    tier_id: string;
    product_id: string;
    discount_percent: number;
  }>;
  defaultTierIds: string[];
};

export type SnapshotRecentInvoice = {
  id: string;
  invoice_number: string;
  type: string;
  status: string;
  total: number;
  paid_amount: number;
  created_at: string;
  customer_id?: string | null;
  supplier_id?: string | null;
  customer_name?: string | null;
  supplier_name?: string | null;
  payment_method?: string | null;
};

export type SnapshotInvoiceStats = {
  todayKey: string;
  todayCount: number;
  todayRevenue: number;
  weeklySales: Array<{ label: string; value: number; key: string }>;
};

/** Compat snapshot view built from normalized stores */
export type SnapshotBundle = {
  id: "main";
  products: SnapshotProduct[];
  customers: SnapshotParty[];
  suppliers: SnapshotParty[];
  safes: SnapshotSafe[];
  settings: SnapshotSettings | null;
  recentInvoices: SnapshotRecentInvoice[];
  invoiceStats: SnapshotInvoiceStats | null;
  tierPricing?: SnapshotTierPricing | null;
  pulled_at: string;
};

/** Business tables included in backup / restore (profiles excluded). */

export const BACKUP_TABLES = [
  "settings",
  "categories",
  "customers",
  "suppliers",
  "accounts",
  "safes",
  "products",
  "price_tiers",
  "product_tier_prices",
  "tier_category_discounts",
  "tier_product_discounts",
  "invoices",
  "invoice_items",
  "documents",
  "document_items",
  "party_payments",
  "party_payment_allocations",
  "journal_entries",
  "journal_lines",
  "safe_transactions",
  "inventory_counts",
  "inventory_count_items",
  "document_sequences",
  "shifts",
  "audit_logs",
  "app_notifications",
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

/** Insert order: parents before children. */
export const RESTORE_ORDER: BackupTableName[] = [
  "settings",
  "categories",
  "customers",
  "suppliers",
  "accounts",
  "safes",
  "products",
  "price_tiers",
  "product_tier_prices",
  "tier_category_discounts",
  "tier_product_discounts",
  "invoices",
  "invoice_items",
  "documents",
  "document_items",
  "party_payments",
  "party_payment_allocations",
  "journal_entries",
  "journal_lines",
  "safe_transactions",
  "inventory_counts",
  "inventory_count_items",
  "document_sequences",
  "shifts",
  "audit_logs",
  "app_notifications",
];

export const BACKUP_VERSION = 4;

export const FACTORY_RESET_CONFIRM = "مسح الكل";
export const RESTORE_CONFIRM = "استعادة";

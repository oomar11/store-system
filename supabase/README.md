# Supabase — store-system

## Sources of truth

| File | Role |
|------|------|
| `schema.sql` | **Baseline** bootstrap only (older core tables). Not the full current DB. |
| `migrations/*.sql` | **Required** incremental updates. Filename order = apply order. |

Do **not** paste only `schema.sql` and stop — the live app needs the migrations.

## Fresh project setup

1. Create a Supabase project and copy URL / anon / service-role keys into `.env.local`.
2. In SQL Editor, run `schema.sql`.
3. Run **every** file in `migrations/` in lexicographic order.
4. Manufacturing history: `20260721_upvc_manufacturing.sql` then `20260722_drop_manufacturing.sql` — keep both; manufacturing lives in `workshop-system` only.
5. Create the first Auth user, then set `profiles.role = 'owner'`.

## Existing project updates

- Apply only **new** migration files that have not been run yet.
- Never edit an already-applied migration; add a new dated file instead.
- Never reintroduce `mfg_*` tables into this database.

## Tables expected after all migrations (store scope)

Core: `profiles`, `categories`, `products`, `customers`, `suppliers`, `invoices`, `invoice_items`, `documents`, `document_items`, `accounts`, `journal_entries`, `journal_lines`, `safes`, `safe_transactions`, `settings`, `inventory_counts`, `inventory_count_items`, `backup_runs`, `telegram_config`

Added by migrations: `shifts`, `app_notifications`, `party_payments`, `party_payment_allocations`, `document_sequences`, `audit_logs`, `price_tiers`, `product_tier_prices`, `tier_category_discounts`, `tier_product_discounts`, `client_operations`, `sync_devices`, `sync_operations`, `sync_changes`

-- Complete wipe_business_data: all operational tables + sync feed.
-- Keeps: profiles, auth.users, telegram_config, backup_runs.

CREATE OR REPLACE FUNCTION wipe_business_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Child / dependent tables first; CASCADE covers FKs not listed.
  TRUNCATE TABLE
    inventory_count_items,
    inventory_counts,
    invoice_items,
    invoices,
    document_items,
    documents,
    party_payment_allocations,
    party_payments,
    journal_lines,
    journal_entries,
    safe_transactions,
    product_tier_prices,
    tier_category_discounts,
    tier_product_discounts,
    price_tiers,
    products,
    categories,
    customers,
    suppliers,
    shifts,
    safes,
    accounts,
    settings,
    document_sequences,
    audit_logs,
    app_notifications,
    client_operations,
    sync_operations,
    sync_changes,
    sync_devices
  RESTART IDENTITY CASCADE;

  -- sync_changes uses an external sequence (not IDENTITY)
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'sync_change_seq' AND c.relkind = 'S'
  ) THEN
    EXECUTE 'ALTER SEQUENCE public.sync_change_seq RESTART WITH 1';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION wipe_business_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wipe_business_data() TO service_role;

-- Reaffirm factory_reset seed (users + telegram kept by wipe).
CREATE OR REPLACE FUNCTION factory_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM wipe_business_data();

  INSERT INTO settings (store_name, tax_rate, tax_enabled, currency, print_offset)
  VALUES ('ويندور', 15, false, 'EGP', 0);

  INSERT INTO safes (name, balance) VALUES ('الخزنة الرئيسية', 0);

  INSERT INTO accounts (code, name, type) VALUES
    ('1000', 'الأصول', 'asset'),
    ('1100', 'النقدية', 'asset'),
    ('1200', 'العملاء', 'asset'),
    ('1300', 'المخزون', 'asset'),
    ('2000', 'الخصوم', 'liability'),
    ('2100', 'الموردين', 'liability'),
    ('3000', 'حقوق الملكية', 'equity'),
    ('3100', 'رأس المال', 'equity'),
    ('4000', 'الإيرادات', 'revenue'),
    ('4100', 'المبيعات', 'revenue'),
    ('5000', 'المصروفات', 'expense'),
    ('5100', 'تكلفة البضاعة المباعة', 'expense'),
    ('5200', 'مصروفات عمومية', 'expense');

  INSERT INTO accounts (code, name, type, parent_id)
  SELECT v.code, v.name, 'expense', p.id
  FROM (VALUES
    ('5210', 'إيجار'),
    ('5220', 'كهرباء ومياه'),
    ('5230', 'رواتب وأجور'),
    ('5240', 'صيانة'),
    ('5250', 'مواصلات'),
    ('5260', 'اتصالات وإنترنت'),
    ('5290', 'مصروفات أخرى')
  ) AS v(code, name)
  LEFT JOIN accounts p ON p.code = '5200';
END;
$$;

REVOKE ALL ON FUNCTION factory_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION factory_reset() TO service_role;

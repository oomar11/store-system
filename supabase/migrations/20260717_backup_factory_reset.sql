-- =========================================================================
-- Backup runs log + factory_reset / wipe_business_data RPCs
-- =========================================================================

CREATE TABLE IF NOT EXISTS backup_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL CHECK (source IN ('manual', 'cron', 'telegram', 'restore', 'factory_reset')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  byte_size INTEGER,
  error_message TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_created ON backup_runs(created_at DESC);

ALTER TABLE backup_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated access" ON backup_runs;
CREATE POLICY "Authenticated access" ON backup_runs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Wipe all business data (keeps profiles / auth.users / backup_runs)
CREATE OR REPLACE FUNCTION wipe_business_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE TABLE
    inventory_count_items,
    inventory_counts,
    invoice_items,
    invoices,
    document_items,
    documents,
    journal_lines,
    journal_entries,
    safe_transactions,
    products,
    categories,
    customers,
    suppliers,
    safes,
    accounts,
    settings
  CASCADE;
END;
$$;

-- Factory reset: wipe + reseed defaults (users kept)
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

REVOKE ALL ON FUNCTION wipe_business_data() FROM PUBLIC;
REVOKE ALL ON FUNCTION factory_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wipe_business_data() TO service_role;
GRANT EXECUTE ON FUNCTION factory_reset() TO service_role;

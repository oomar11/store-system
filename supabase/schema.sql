-- =============================================
-- نظام إدارة المخزون والحسابات - قاعدة البيانات
-- BASELINE ONLY — not the full current schema.
-- Fresh project: run this file, then ALL files in
--   migrations/ in lexicographic order.
-- See supabase/README.md for the full checklist.
-- Manufacturing (mfg_*) does NOT belong here; use workshop-system.
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. Profiles (linked to Supabase Auth)
-- =============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('owner', 'manager', 'employee')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 2. Categories
-- =============================================
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 3. Products
-- =============================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'قطعة',
  buy_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  sell_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  opening_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_quantity DECIMAL(12,2) NOT NULL DEFAULT 5,
  notify_low_stock BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 4. Customers
-- =============================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 5. Suppliers
-- =============================================
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 6. Invoices
-- =============================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'sale_return', 'purchase_return')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'completed', 'cancelled')),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'credit', 'bank_transfer')),
  safe_id UUID REFERENCES safes(id) ON DELETE SET NULL,
  notes TEXT,
  original_invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_original_invoice_sale_purchase_null CHECK (
    type NOT IN ('sale', 'purchase') OR original_invoice_id IS NULL
  )
);

-- =============================================
-- 7. Invoice Items
-- =============================================
CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity DECIMAL(12,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(12,2),
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL
);

-- =============================================
-- 8. Commercial Documents (Purchase Orders & Quotes)
-- =============================================
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('purchase_order', 'quote')),
  stage TEXT NOT NULL DEFAULT 'draft'
    CHECK (stage IN ('draft', 'sent', 'approved', 'rejected', 'converted', 'cancelled')),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  valid_until DATE,
  expected_date DATE,
  converted_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity DECIMAL(12,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL
);

-- =============================================
-- 9. Accounts (Chart of Accounts)
-- =============================================
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id UUID REFERENCES accounts(id),
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 10. Journal Entries
-- =============================================
CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_number TEXT NOT NULL UNIQUE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  notes TEXT,
  is_posted BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 11. Journal Lines
-- =============================================
CREATE TABLE journal_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  debit DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit DECIMAL(12,2) NOT NULL DEFAULT 0,
  description TEXT
);

-- =============================================
-- 12. Safes
-- =============================================
CREATE TABLE safes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 13. Safe Transactions
-- =============================================
CREATE TABLE safe_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  safe_id UUID NOT NULL REFERENCES safes(id),
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer')),
  amount DECIMAL(12,2) NOT NULL,
  description TEXT,
  notes TEXT,
  reference_type TEXT,
  reference_id UUID,
  related_safe_id UUID REFERENCES safes(id) ON DELETE SET NULL,
  transfer_group_id UUID,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 14. Settings
-- =============================================
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_name TEXT NOT NULL DEFAULT 'المحل',
  phone TEXT,
  address TEXT,
  tax_rate DECIMAL(5,2) NOT NULL DEFAULT 15,
  tax_enabled BOOLEAN NOT NULL DEFAULT false,
  currency TEXT NOT NULL DEFAULT 'EGP',
  logo_url TEXT,
  tax_number TEXT,
  commercial_register TEXT,
  receipt_footer TEXT,
  default_low_stock_threshold NUMERIC(12, 2) NOT NULL DEFAULT 0,
  print_offset INTEGER NOT NULL DEFAULT 0,
  invoice_tagline TEXT,
  inventory_sheet_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 15. Inventory Counts (جرد)
-- =============================================
CREATE TABLE inventory_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory_count_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_id UUID NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  system_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  counted_quantity DECIMAL(12,2),
  notes TEXT,
  UNIQUE (count_id, product_id)
);

-- =============================================
-- 16. Backup Runs (log)
-- =============================================
CREATE TABLE backup_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL CHECK (source IN ('manual', 'cron', 'telegram', 'restore', 'factory_reset')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  byte_size INTEGER,
  error_message TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- 17. Telegram Config (survives factory reset)
-- =============================================
CREATE TABLE telegram_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_token TEXT,
  chat_id TEXT,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO telegram_config (id, bot_token, chat_id)
VALUES ('b0000000-0000-0000-0000-000000000001', NULL, NULL);

-- =============================================
-- Indexes
-- =============================================
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX idx_invoices_type ON invoices(type);
CREATE INDEX idx_invoices_created_at ON invoices(created_at);
CREATE INDEX idx_invoices_safe ON invoices(safe_id);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX idx_documents_type ON documents(type);
CREATE INDEX idx_documents_stage ON documents(stage);
CREATE INDEX idx_documents_customer ON documents(customer_id);
CREATE INDEX idx_documents_supplier ON documents(supplier_id);
CREATE INDEX idx_documents_created_at ON documents(created_at);
CREATE INDEX idx_document_items_document ON document_items(document_id);
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX idx_journal_entries_date ON journal_entries(date);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_safe_transactions_safe ON safe_transactions(safe_id);
CREATE INDEX idx_safe_transactions_created ON safe_transactions(created_at);
CREATE INDEX idx_safe_transactions_reference ON safe_transactions(reference_type, reference_id);
CREATE INDEX idx_inventory_counts_status ON inventory_counts(status);
CREATE INDEX idx_inventory_counts_created ON inventory_counts(created_at);
CREATE INDEX idx_inventory_count_items_count ON inventory_count_items(count_id);
CREATE INDEX idx_inventory_count_items_product ON inventory_count_items(product_id);
CREATE INDEX idx_backup_runs_created ON backup_runs(created_at DESC);

-- =============================================
-- Row Level Security (RLS)
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE safes ENABLE ROW LEVEL SECURITY;
ALTER TABLE safe_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_config ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to access all data
CREATE POLICY "Authenticated users can view all" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Authenticated access" ON categories FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON document_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON accounts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON journal_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON journal_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON safes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON safe_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON inventory_counts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON inventory_count_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated access" ON backup_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================
-- Backup / factory reset RPCs (service_role only)
-- =============================================
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

  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'sync_change_seq' AND c.relkind = 'S'
  ) THEN
    EXECUTE 'ALTER SEQUENCE public.sync_change_seq RESTART WITH 1';
  END IF;
END;
$$;

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

-- =============================================
-- Trigger: Auto-create profile on signup
-- =============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'مستخدم جديد'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================
-- Trigger: Update updated_at on products
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- إلغاء الوثيقة المحوّلة عند حذف فاتورةها
CREATE OR REPLACE FUNCTION cancel_documents_on_invoice_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE documents
  SET
    stage = 'cancelled',
    notes = CASE
      WHEN notes IS NULL OR btrim(notes) = '' THEN
        'أُلغي تلقائياً بعد حذف الفاتورة المرتبطة ' || COALESCE(OLD.invoice_number, '')
      WHEN notes ILIKE '%أُلغي تلقائياً بعد حذف الفاتورة%' THEN
        notes
      ELSE
        notes || E'\nأُلغي تلقائياً بعد حذف الفاتورة المرتبطة ' || COALESCE(OLD.invoice_number, '')
    END,
    updated_at = NOW()
  WHERE converted_invoice_id = OLD.id
    AND stage = 'converted';
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_cancel_documents_on_invoice_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION cancel_documents_on_invoice_delete();

CREATE INDEX IF NOT EXISTS idx_documents_converted_invoice
  ON documents(converted_invoice_id);

-- =============================================
-- Initial Data: Default settings
-- =============================================
INSERT INTO settings (store_name, tax_rate, tax_enabled, currency, print_offset)
VALUES ('ويندور', 15, false, 'EGP', 0);

-- Default safe
INSERT INTO safes (name, balance) VALUES ('الخزنة الرئيسية', 0);

-- Default chart of accounts
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

-- Expense sub-accounts (parent = 5200 when present)
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

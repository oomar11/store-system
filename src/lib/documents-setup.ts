/** SQL المطلوب مرة واحدة لتفعيل الوثائق (عروض/طلبات) والميزات المعلّقة */
export const DOCUMENTS_SETUP_SQL = `-- ويندور: عروض الأسعار وطلبات الشراء
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS documents (
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

CREATE TABLE IF NOT EXISTS document_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity DECIMAL(12,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_stage ON documents(stage);
CREATE INDEX IF NOT EXISTS idx_documents_customer ON documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_supplier ON documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
CREATE INDEX IF NOT EXISTS idx_document_items_document ON document_items(document_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'documents' AND policyname = 'Authenticated access'
  ) THEN
    CREATE POLICY "Authenticated access" ON documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'document_items' AND policyname = 'Authenticated access'
  ) THEN
    CREATE POLICY "Authenticated access" ON document_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_updated_at ON documents;
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_updated_at();

-- إلغاء عرض السعر / طلب الشراء عند حذف الفاتورة المرتبطة
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

DROP TRIGGER IF EXISTS trg_cancel_documents_on_invoice_delete ON invoices;
CREATE TRIGGER trg_cancel_documents_on_invoice_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION cancel_documents_on_invoice_delete();

CREATE INDEX IF NOT EXISTS idx_documents_converted_invoice
  ON documents(converted_invoice_id);
`;

export const SUPABASE_SQL_EDITOR_URL =
  "https://supabase.com/dashboard/project/qcvhddjvftpjczdxcfjz/sql/new";

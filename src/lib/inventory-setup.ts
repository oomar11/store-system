/**
 * SQL مطلوب مرة واحدة لتفعيل نظام الجرد + ترقيم الجلسات.
 * يشمل الجداول وـ document_sequences / next_document_number حتى يعمل «جرد جديد».
 */
export const INVENTORY_SETUP_SQL = `-- ويندور: نظام الجرد + ترقيم الجلسات
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS inventory_sheet_config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS inventory_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_id UUID NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  system_quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  counted_quantity DECIMAL(12,2),
  notes TEXT,
  UNIQUE (count_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_counts_status ON inventory_counts(status);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_created ON inventory_counts(created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_count ON inventory_count_items(count_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_items_product ON inventory_count_items(product_id);

ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventory_counts' AND policyname = 'Authenticated access'
  ) THEN
    CREATE POLICY "Authenticated access" ON inventory_counts
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inventory_count_items' AND policyname = 'Authenticated access'
  ) THEN
    CREATE POLICY "Authenticated access" ON inventory_count_items
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ترقيم جلسات الجرد (مطلوب لزر «جرد جديد»)
CREATE TABLE IF NOT EXISTS public.document_sequences (
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  last_value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, period),
  CONSTRAINT document_sequences_period_format CHECK (period ~ '^[0-9]{4}$'),
  CONSTRAINT document_sequences_last_value_nonneg CHECK (last_value >= 0)
);

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_document_number(p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := lower(trim(p_kind));
  v_prefix text;
  v_period text;
  v_next bigint;
  v_pad int;
  v_ok boolean := auth.uid() IS NOT NULL;
BEGIN
  IF to_regprocedure('public.is_active_user()') IS NOT NULL THEN
    EXECUTE 'SELECT public.is_active_user()' INTO v_ok;
    v_ok := COALESCE(v_ok, false) AND auth.uid() IS NOT NULL;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  v_prefix := CASE v_kind
    WHEN 'sale' THEN 'INV'
    WHEN 'purchase' THEN 'PUR'
    WHEN 'quote' THEN 'QT'
    WHEN 'purchase_order' THEN 'PO'
    WHEN 'sale_return' THEN 'RET'
    WHEN 'purchase_return' THEN 'PRR'
    WHEN 'inventory_count' THEN 'CNT'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'نوع المستند غير صالح: %', p_kind;
  END IF;

  v_period := to_char((now() AT TIME ZONE 'Africa/Cairo'), 'YYMM');

  INSERT INTO public.document_sequences AS ds (kind, period, last_value)
  VALUES (v_kind, v_period, 1)
  ON CONFLICT (kind, period)
  DO UPDATE SET last_value = ds.last_value + 1
  RETURNING ds.last_value INTO v_next;

  v_pad := GREATEST(4, length(v_next::text));
  RETURN v_prefix || '-' || v_period || '-' || lpad(v_next::text, v_pad, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_document_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_document_number(text) TO authenticated;
`;

export const INVENTORY_SETUP_SQL_URL =
  "https://supabase.com/dashboard/project/qcvhddjvftpjczdxcfjz/sql/new";

export function isInventoryTablesMissing(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("inventory_counts") ||
    m.includes("inventory_count_items") ||
    (m.includes("relation") && m.includes("does not exist")) ||
    m.includes("could not find the table")
  );
}

/** True when next_document_number / document_sequences is missing (tables alone are not enough). */
export function isDocumentNumberRpcMissing(
  message: string | undefined | null
): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("next_document_number") ||
    m.includes("document_sequences") ||
    (m.includes("function") && m.includes("does not exist")) ||
    m.includes("could not find the function") ||
    m.includes("تعذر توليد رقم المستند")
  );
}

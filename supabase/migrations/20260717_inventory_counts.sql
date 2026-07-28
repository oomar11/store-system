-- =============================================
-- Inventory counts (جرد) + sheet layout config
-- =============================================

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

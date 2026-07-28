-- Snapshot product cost on invoice lines for reliable profit reporting.
-- NULL means legacy rows (profit must fall back to current products.buy_price).
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(12,2);

COMMENT ON COLUMN invoice_items.unit_cost IS
  'Product buy cost captured at sale/return time. NULL = legacy estimated cost.';

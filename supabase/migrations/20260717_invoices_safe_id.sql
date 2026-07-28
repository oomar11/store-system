-- Link invoices to the safe that received/paid the cash amount
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS safe_id UUID REFERENCES safes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_safe ON invoices(safe_id);

-- Custom tagline under store name on sales receipts
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS invoice_tagline TEXT;

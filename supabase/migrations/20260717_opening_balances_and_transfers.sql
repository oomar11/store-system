-- Opening balances + treasury transfers

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE safes
  ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Existing safes: treat current balance as opening if never tracked
UPDATE safes
SET opening_balance = balance
WHERE opening_balance = 0 AND balance <> 0;

ALTER TABLE safe_transactions
  ADD COLUMN IF NOT EXISTS related_safe_id UUID REFERENCES safes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_safe_transactions_transfer_group
  ON safe_transactions(transfer_group_id);

CREATE INDEX IF NOT EXISTS idx_safe_transactions_related_safe
  ON safe_transactions(related_safe_id);

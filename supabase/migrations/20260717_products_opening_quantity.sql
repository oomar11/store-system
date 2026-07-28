-- Opening stock balance for products

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS opening_quantity DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Existing stock: treat current quantity as opening if never tracked
UPDATE products
SET opening_quantity = quantity
WHERE opening_quantity = 0 AND quantity <> 0;

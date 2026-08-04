-- Catalog cost ALWAYS from products.sell_price (not invoice prices):
--   قطاعات (except كورين) → sell × 0.8
--   كورين + everything else → sell × 0.9
-- Then align past sale unit_cost snapshots the same way. Purchase invoice money untouched.

UPDATE products p
SET buy_price = ROUND(
  p.sell_price * CASE
    WHEN EXISTS (
      SELECT 1 FROM categories c
      WHERE c.id = p.category_id
        AND c.name ILIKE '%قطاع%'
        AND c.name NOT ILIKE '%كورين%'
    ) THEN 0.8
    ELSE 0.9
  END,
  2
)
WHERE p.sell_price > 0;

UPDATE invoice_items ii
SET unit_cost = ROUND(
  p.sell_price * CASE
    WHEN EXISTS (
      SELECT 1 FROM categories c
      WHERE c.id = p.category_id
        AND c.name ILIKE '%قطاع%'
        AND c.name NOT ILIKE '%كورين%'
    ) THEN 0.8
    ELSE 0.9
  END,
  2
)
FROM products p, invoices i
WHERE ii.product_id = p.id
  AND i.id = ii.invoice_id
  AND i.status = 'completed'
  AND i.type IN ('sale', 'sale_return')
  AND ii.unit_cost IS NOT NULL
  AND p.sell_price > 0;

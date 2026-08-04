-- قطاعات: estimated purchase cost = sell − 20% (was sell − 10% from prior migration).
-- Only rewrite catalog estimates (exactly 10% off sell). Leave products that already
-- have a real purchase cost (e.g. ~40% off from purchase invoices) unchanged.

UPDATE products p
SET buy_price = ROUND(p.sell_price * 0.8, 2)
FROM categories c
WHERE c.id = p.category_id
  AND c.name ILIKE '%قطاع%'
  AND p.sell_price > 0
  AND ABS(p.buy_price - ROUND(p.sell_price * 0.9, 2)) < 0.01;

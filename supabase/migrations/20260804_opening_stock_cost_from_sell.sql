-- Opening / catalog cost when buy was never set: use sell − 10% (trade discount).
-- Many products had buy_price copied from sell_price, so any customer discount
-- looked like a loss. Reprice those to the default estimated cost.
-- Products that already have a real buy below sell are left unchanged.

UPDATE products
SET buy_price = ROUND(sell_price * 0.9, 2)
WHERE sell_price > 0
  AND (
    buy_price = 0
    OR buy_price = sell_price
  );

-- Sale lines that snapshotted cost = sell (legacy) → same estimated cost
UPDATE invoice_items ii
SET unit_cost = ROUND(p.sell_price * 0.9, 2)
FROM products p, invoices i
WHERE ii.product_id = p.id
  AND i.id = ii.invoice_id
  AND i.type IN ('sale', 'sale_return')
  AND ii.unit_cost IS NOT NULL
  AND p.sell_price > 0
  AND ABS(ii.unit_cost - p.sell_price) < 0.005;

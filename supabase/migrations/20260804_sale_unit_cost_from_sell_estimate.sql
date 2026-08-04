-- Follow-up: sale lines that snapshotted unit_cost = sell (legacy catalog)
-- get the same estimated cost (sell − 10%). Idempotent if already applied.

UPDATE invoice_items ii
SET unit_cost = ROUND(p.sell_price * 0.9, 2)
FROM products p, invoices i
WHERE ii.product_id = p.id
  AND i.id = ii.invoice_id
  AND i.type IN ('sale', 'sale_return')
  AND ii.unit_cost IS NOT NULL
  AND p.sell_price > 0
  AND ABS(ii.unit_cost - p.sell_price) < 0.005;

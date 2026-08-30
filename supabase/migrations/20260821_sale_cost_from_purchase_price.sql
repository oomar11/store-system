-- Sale costing follows actual purchase price (products.buy_price / last
-- purchase net unit_cost), not catalog sell−10%/20%.
-- Idempotent: only rewrites catalog estimates; real buy prices stay.

-- 1) Restore catalog buy_price from the latest completed purchase net cost
--    when the product still holds a sell-based estimate (or zero).
UPDATE products p
SET buy_price = latest.unit_cost
FROM (
  SELECT DISTINCT ON (ii.product_id)
    ii.product_id,
    ii.unit_cost
  FROM invoice_items ii
  JOIN invoices i ON i.id = ii.invoice_id
  WHERE i.status = 'completed'
    AND i.type = 'purchase'
    AND ii.unit_cost IS NOT NULL
    AND ii.unit_cost > 0
  ORDER BY ii.product_id, i.created_at DESC, ii.id DESC
) latest
WHERE p.id = latest.product_id
  AND latest.unit_cost > 0
  AND (
    p.buy_price IS NULL
    OR p.buy_price <= 0
    OR (
      p.sell_price > 0
      AND (
        ABS(p.buy_price - ROUND(p.sell_price * 0.9, 2)) < 0.01
        OR ABS(p.buy_price - ROUND(p.sell_price * 0.8, 2)) < 0.01
      )
    )
  );

-- 2) Sale/return snapshots that still equal the catalog estimate → current buy
UPDATE invoice_items ii
SET unit_cost = p.buy_price
FROM products p, invoices i
WHERE ii.product_id = p.id
  AND i.id = ii.invoice_id
  AND i.status = 'completed'
  AND i.type IN ('sale', 'sale_return')
  AND ii.unit_cost IS NOT NULL
  AND p.buy_price > 0
  AND p.sell_price > 0
  AND (
    ABS(ii.unit_cost - ROUND(p.sell_price * 0.9, 2)) < 0.01
    OR ABS(ii.unit_cost - ROUND(p.sell_price * 0.8, 2)) < 0.01
  )
  AND ABS(ii.unit_cost - p.buy_price) > 0.01;

-- بانل كورين: catalog / sale cost = sell − 10% (not the 20% سيتي sectors rule).

UPDATE products p
SET buy_price = ROUND(p.sell_price * 0.9, 2)
FROM categories c
WHERE c.id = p.category_id
  AND c.name ILIKE '%كورين%'
  AND p.sell_price > 0;

UPDATE invoice_items ii
SET unit_cost = ROUND(p.sell_price * 0.9, 2)
FROM products p, invoices i, categories c
WHERE ii.product_id = p.id
  AND i.id = ii.invoice_id
  AND c.id = p.category_id
  AND c.name ILIKE '%كورين%'
  AND i.status = 'completed'
  AND i.type IN ('sale', 'sale_return')
  AND ii.unit_cost IS NOT NULL
  AND p.sell_price > 0;

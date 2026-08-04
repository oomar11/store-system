-- Undo purchase-invoice / supplier money changes from reprice_startup_purchase_20.
-- Keep catalog + sale costing only: قطاعات = sell−20%, everything else catalog = sell−10%.
-- Do NOT rewrite purchase totals, payments, or supplier AR again.

DO $$
DECLARE
  pur_id uuid := 'af21b375-d804-4b7b-9304-e7c8694df21d';
  supplier uuid;
BEGIN
  SELECT supplier_id INTO supplier FROM invoices WHERE id = pur_id;
  IF supplier IS NULL AND NOT EXISTS (SELECT 1 FROM invoices WHERE id = pur_id) THEN
    RAISE NOTICE 'PUR-2607-0002 not found — skip money revert';
  ELSE
    -- Restore original 40% trade discount on the purchase document
    UPDATE invoices
    SET discount_amount = ROUND(subtotal * 0.4, 2),
        total = ROUND(subtotal * 0.6, 2)
    WHERE id = pur_id;

    -- Purchase line unit_cost = what was actually paid (40% off list)
    UPDATE invoice_items
    SET unit_cost = ROUND(unit_price * 0.6, 2)
    WHERE invoice_id = pur_id;

    -- Supplier balance from opening + unpaid purchases
    IF supplier IS NOT NULL THEN
      UPDATE suppliers s
      SET balance = COALESCE(s.opening_balance, 0) + COALESCE((
        SELECT SUM(i.total - i.paid_amount)
        FROM invoices i
        WHERE i.supplier_id = s.id
          AND i.status = 'completed'
          AND i.type = 'purchase'
      ), 0)
      WHERE s.id = supplier;
    END IF;
  END IF;

  -- Catalog cost: sectors 20%, non-sectors that were wrongly set to 20% → 10%
  -- (only rewrite exact 20%-of-sell estimates outside قطاعات; leave real costs alone)
  UPDATE products p
  SET buy_price = ROUND(p.sell_price * 0.9, 2)
  WHERE p.sell_price > 0
    AND ABS(p.buy_price - ROUND(p.sell_price * 0.8, 2)) < 0.01
    AND NOT EXISTS (
      SELECT 1 FROM categories c
      WHERE c.id = p.category_id AND c.name ILIKE '%قطاع%'
    );

  -- Ensure all قطاعات catalog cost = sell − 20%
  UPDATE products p
  SET buy_price = ROUND(p.sell_price * 0.8, 2)
  FROM categories c
  WHERE c.id = p.category_id
    AND c.name ILIKE '%قطاع%'
    AND p.sell_price > 0
    AND ABS(p.buy_price - ROUND(p.sell_price * 0.8, 2)) >= 0.01;

  -- Sale/return cost snapshots follow catalog rules (sectors 20%, else current buy)
  UPDATE invoice_items ii
  SET unit_cost = CASE
    WHEN EXISTS (
      SELECT 1 FROM categories c
      WHERE c.id = p.category_id AND c.name ILIKE '%قطاع%'
    ) THEN ROUND(p.sell_price * 0.8, 2)
    ELSE p.buy_price
  END
  FROM products p, invoices i
  WHERE ii.product_id = p.id
    AND i.id = ii.invoice_id
    AND i.status = 'completed'
    AND i.type IN ('sale', 'sale_return')
    AND ii.unit_cost IS NOT NULL;
END $$;

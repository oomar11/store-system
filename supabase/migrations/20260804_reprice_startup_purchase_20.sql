-- Reprice the startup purchase (PUR-2607-0002) from 40% off sell → 20% off sell,
-- then sync product buy_price + past sale unit_cost snapshots, and supplier AR.

DO $$
DECLARE
  pur_id uuid := 'af21b375-d804-4b7b-9304-e7c8694df21d';
  old_total numeric;
  new_discount numeric;
  new_total numeric;
  supplier uuid;
BEGIN
  SELECT total, supplier_id INTO old_total, supplier
  FROM invoices WHERE id = pur_id;

  IF old_total IS NULL THEN
    RAISE NOTICE 'PUR-2607-0002 not found — skip';
    RETURN;
  END IF;

  SELECT ROUND(subtotal * 0.2, 2), ROUND(subtotal * 0.8, 2)
  INTO new_discount, new_total
  FROM invoices WHERE id = pur_id;

  -- 1) Invoice header: 40% → 20% trade discount
  UPDATE invoices
  SET discount_amount = new_discount,
      total = new_total
  WHERE id = pur_id;

  -- 2) Purchase line net unit costs
  UPDATE invoice_items ii
  SET unit_cost = ROUND(ii.unit_price * 0.8, 2)
  WHERE ii.invoice_id = pur_id;

  -- 3) Catalog buy_price for products on that purchase
  UPDATE products p
  SET buy_price = ROUND(p.sell_price * 0.8, 2)
  WHERE p.sell_price > 0
    AND p.id IN (
      SELECT ii.product_id FROM invoice_items ii WHERE ii.invoice_id = pur_id
    );

  -- 4) Past sale/return cost snapshots → current buy (purchase products + sectors)
  UPDATE invoice_items ii
  SET unit_cost = p.buy_price
  FROM products p, invoices i
  WHERE ii.product_id = p.id
    AND i.id = ii.invoice_id
    AND i.status = 'completed'
    AND i.type IN ('sale', 'sale_return')
    AND ii.unit_cost IS NOT NULL
    AND ABS(ii.unit_cost - p.buy_price) > 0.01
    AND (
      p.id IN (SELECT product_id FROM invoice_items WHERE invoice_id = pur_id)
      OR EXISTS (
        SELECT 1 FROM categories c
        WHERE c.id = p.category_id AND c.name ILIKE '%قطاع%'
      )
    );

  -- 5) Supplier balance = opening + unpaid purchase totals
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
END $$;

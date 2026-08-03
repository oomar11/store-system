-- Convert the one-time "starting" inventory count into product opening balances.
-- CNT-2608-0001 («جرد قطاعات البدايىة») was used to enter initial stock, not a
-- mid-period count. Move counted qty → opening_quantity, then drop the session.

UPDATE products p
SET opening_quantity = ici.counted_quantity
FROM inventory_count_items ici
JOIN inventory_counts ic ON ic.id = ici.count_id
WHERE ic.count_number = 'CNT-2608-0001'
  AND ici.product_id = p.id
  AND ici.counted_quantity IS NOT NULL;

DELETE FROM inventory_counts
WHERE count_number = 'CNT-2608-0001';

-- Leftover stock entered without opening and without any invoice/count movement
UPDATE products p
SET opening_quantity = p.quantity
WHERE COALESCE(p.opening_quantity, 0) = 0
  AND p.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM invoice_items ii WHERE ii.product_id = p.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM inventory_count_items ici WHERE ici.product_id = p.id
  );

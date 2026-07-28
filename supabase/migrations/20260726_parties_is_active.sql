-- =============================================
-- تفعيل/إيقاف العملاء والموردين + تاريخ آخر تعامل
-- =============================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN customers.is_active IS
  'عند false لا يظهر العميل في نقطة البيع والفواتير والمستندات';

COMMENT ON COLUMN suppliers.is_active IS
  'عند false لا يظهر المورد في المشتريات والفواتير والمستندات';

CREATE INDEX IF NOT EXISTS idx_customers_is_active
  ON customers (is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_suppliers_is_active
  ON suppliers (is_active)
  WHERE is_active = true;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

COMMENT ON COLUMN customers.last_activity_at IS
  'آخر فاتورة أو دفعة مرتبطة بالعميل';

COMMENT ON COLUMN suppliers.last_activity_at IS
  'آخر فاتورة أو دفعة مرتبطة بالمورد';

-- Backfill من الفواتير والمدفوعات الحالية
UPDATE customers c
SET last_activity_at = GREATEST(
  (SELECT MAX(i.created_at) FROM invoices i WHERE i.customer_id = c.id),
  (
    SELECT MAX(p.created_at)
    FROM party_payments p
    WHERE p.party_type = 'customer' AND p.party_id = c.id
  )
)
WHERE c.last_activity_at IS NULL;

UPDATE suppliers s
SET last_activity_at = GREATEST(
  (SELECT MAX(i.created_at) FROM invoices i WHERE i.supplier_id = s.id),
  (
    SELECT MAX(p.created_at)
    FROM party_payments p
    WHERE p.party_type = 'supplier' AND p.party_id = s.id
  )
)
WHERE s.last_activity_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_party_last_activity_from_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE customers
    SET last_activity_at = GREATEST(
      COALESCE(last_activity_at, '-infinity'::timestamptz),
      COALESCE(NEW.created_at, NOW())
    )
    WHERE id = NEW.customer_id;
  END IF;

  IF NEW.supplier_id IS NOT NULL THEN
    UPDATE suppliers
    SET last_activity_at = GREATEST(
      COALESCE(last_activity_at, '-infinity'::timestamptz),
      COALESCE(NEW.created_at, NOW())
    )
    WHERE id = NEW.supplier_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_party_last_activity_from_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.party_type = 'customer' AND NEW.party_id IS NOT NULL THEN
    UPDATE customers
    SET last_activity_at = GREATEST(
      COALESCE(last_activity_at, '-infinity'::timestamptz),
      COALESCE(NEW.created_at, NOW())
    )
    WHERE id = NEW.party_id;
  ELSIF NEW.party_type = 'supplier' AND NEW.party_id IS NOT NULL THEN
    UPDATE suppliers
    SET last_activity_at = GREATEST(
      COALESCE(last_activity_at, '-infinity'::timestamptz),
      COALESCE(NEW.created_at, NOW())
    )
    WHERE id = NEW.party_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_touch_party_activity ON invoices;
CREATE TRIGGER trg_invoices_touch_party_activity
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_party_last_activity_from_invoice();

DROP TRIGGER IF EXISTS trg_party_payments_touch_party_activity ON party_payments;
CREATE TRIGGER trg_party_payments_touch_party_activity
  AFTER INSERT ON party_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_party_last_activity_from_payment();

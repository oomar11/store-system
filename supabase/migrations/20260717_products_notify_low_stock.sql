-- =============================================
-- إشعارات نواقص المخزون: خيار كتم التنبيه لكل صنف
-- =============================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS notify_low_stock BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN products.notify_low_stock IS
  'عند تفعيله يظهر الصنف في إشعارات النواقص عندما الكمية <= الحد الأدنى';

CREATE INDEX IF NOT EXISTS idx_products_notify_low_stock
  ON products (notify_low_stock)
  WHERE notify_low_stock = true AND is_active = true;

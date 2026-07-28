-- Extra store settings: legal IDs, receipt footer, default low-stock threshold
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS tax_number TEXT,
  ADD COLUMN IF NOT EXISTS commercial_register TEXT,
  ADD COLUMN IF NOT EXISTS receipt_footer TEXT,
  ADD COLUMN IF NOT EXISTS default_low_stock_threshold NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.settings.tax_number IS 'رقم التسجيل الضريبي';
COMMENT ON COLUMN public.settings.commercial_register IS 'السجل التجاري';
COMMENT ON COLUMN public.settings.receipt_footer IS 'نص أسفل الفاتورة (سياسة مرتجعات / ملاحظة)';
COMMENT ON COLUMN public.settings.default_low_stock_threshold IS 'قيمة افتراضية لـ min_quantity عند إنشاء منتج جديد';

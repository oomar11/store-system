-- Remove English name fields from products and settings
ALTER TABLE products DROP COLUMN IF EXISTS name_en;
ALTER TABLE settings DROP COLUMN IF EXISTS store_name_en;

-- Keep factory_reset insert in sync (redefine function body insert)
CREATE OR REPLACE FUNCTION factory_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM wipe_business_data();

  INSERT INTO settings (store_name, tax_rate, tax_enabled, currency, print_offset)
  VALUES ('ويندور', 15, false, 'EGP', 0);

  INSERT INTO safes (name, balance) VALUES ('الخزنة الرئيسية', 0);

  INSERT INTO accounts (code, name, type) VALUES
    ('1000', 'الأصول', 'asset'),
    ('1100', 'النقدية', 'asset'),
    ('1200', 'العملاء', 'asset'),
    ('1300', 'المخزون', 'asset'),
    ('2000', 'الخصوم', 'liability'),
    ('2100', 'الموردين', 'liability'),
    ('3000', 'حقوق الملكية', 'equity'),
    ('3100', 'رأس المال', 'equity'),
    ('4000', 'الإيرادات', 'revenue'),
    ('4100', 'المبيعات', 'revenue'),
    ('5000', 'المصروفات', 'expense'),
    ('5100', 'تكلفة البضاعة المباعة', 'expense'),
    ('5200', 'مصروفات عمومية', 'expense');

  INSERT INTO accounts (code, name, type, parent_id)
  SELECT v.code, v.name, 'expense', p.id
  FROM (VALUES
    ('5210', 'إيجار'),
    ('5220', 'كهرباء ومياه'),
    ('5230', 'رواتب وأجور'),
    ('5240', 'صيانة'),
    ('5250', 'مواصلات'),
    ('5260', 'اتصالات وإنترنت'),
    ('5290', 'مصروفات أخرى')
  ) AS v(code, name)
  LEFT JOIN accounts p ON p.code = '5200';
END;
$$;

REVOKE ALL ON FUNCTION factory_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION factory_reset() TO service_role;

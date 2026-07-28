ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS drawer_safe_id UUID REFERENCES public.safes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.settings.drawer_safe_id IS
  'Safe used as cashier drawer for shift open/close';

-- Managers can access store settings (including drawer) by default
CREATE OR REPLACE FUNCTION public.effective_permissions(p_role text, p_permissions jsonb)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result text[];
BEGIN
  IF p_permissions IS NOT NULL AND jsonb_typeof(p_permissions) = 'array' THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[])
    INTO result
    FROM jsonb_array_elements_text(p_permissions) AS t(x);
    RETURN result;
  END IF;

  IF p_role = 'owner' THEN
    RETURN ARRAY[
      'dashboard','pos','sales','purchases','products','products.write','inventory',
      'customers','customers.write','suppliers','treasury','expenses','reports',
      'settings','settings.backup','users.manage','invoices.delete','prices.edit','shifts'
    ];
  ELSIF p_role = 'manager' THEN
    RETURN ARRAY[
      'dashboard','pos','sales','purchases','products','products.write','inventory',
      'customers','customers.write','suppliers','treasury','expenses','reports',
      'prices.edit','shifts','settings'
    ];
  ELSE
    RETURN ARRAY[
      'dashboard','pos','sales','products','inventory','customers','shifts'
    ];
  END IF;
END;
$$;

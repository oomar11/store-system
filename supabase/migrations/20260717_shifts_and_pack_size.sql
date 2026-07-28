-- Phase 2: shifts (day close) + product pack_size for unit conversions

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pack_size DECIMAL(12,4) NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.products.pack_size IS
  'How many base units in one pack/carton. Stock stays in base units.';

CREATE TABLE IF NOT EXISTS public.shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  safe_id UUID NOT NULL REFERENCES public.safes(id),
  opened_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_cash DECIMAL(14,2) NOT NULL DEFAULT 0,
  expected_cash DECIMAL(14,2),
  counted_cash DECIMAL(14,2),
  variance DECIMAL(14,2),
  sales_total DECIMAL(14,2) DEFAULT 0,
  purchases_total DECIMAL(14,2) DEFAULT 0,
  cash_in DECIMAL(14,2) DEFAULT 0,
  cash_out DECIMAL(14,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_status ON public.shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened_at ON public.shifts(opened_at DESC);

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_select ON public.shifts;
DROP POLICY IF EXISTS shifts_insert ON public.shifts;
DROP POLICY IF EXISTS shifts_update ON public.shifts;
DROP POLICY IF EXISTS shifts_delete ON public.shifts;

CREATE POLICY shifts_select ON public.shifts
  FOR SELECT TO authenticated
  USING (public.has_app_permission('treasury') OR public.has_app_permission('pos'));

CREATE POLICY shifts_insert ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('treasury') OR public.has_app_permission('pos'));

CREATE POLICY shifts_update ON public.shifts
  FOR UPDATE TO authenticated
  USING (public.has_app_permission('treasury') OR public.has_app_permission('pos'))
  WITH CHECK (public.has_app_permission('treasury') OR public.has_app_permission('pos'));

CREATE POLICY shifts_delete ON public.shifts
  FOR DELETE TO authenticated
  USING (public.has_app_permission('settings.backup'));

-- Only one open shift at a time (app-enforced; partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open
  ON public.shifts ((status))
  WHERE status = 'open';

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
      'customers','customers.write','suppliers','treasury','expenses','reports','prices.edit','shifts'
    ];
  ELSE
    RETURN ARRAY[
      'dashboard','pos','sales','products','inventory','customers','shifts'
    ];
  END IF;
END;
$$;

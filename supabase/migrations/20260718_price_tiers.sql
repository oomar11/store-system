-- =========================================================================
-- Price tiers / customer price lists (retail default + optional wholesale etc.)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_tiers_one_default
  ON public.price_tiers ((is_default))
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_price_tiers_sort ON public.price_tiers (sort_order, name);

CREATE TABLE IF NOT EXISTS public.product_tier_prices (
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES public.price_tiers(id) ON DELETE CASCADE,
  sell_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, tier_id),
  CONSTRAINT product_tier_prices_sell_nonneg CHECK (sell_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_product_tier_prices_tier
  ON public.product_tier_prices (tier_id);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS price_tier_id UUID REFERENCES public.price_tiers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_price_tier
  ON public.customers (price_tier_id);

ALTER TABLE public.price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_tier_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_tiers_select ON public.price_tiers;
DROP POLICY IF EXISTS price_tiers_write ON public.price_tiers;
DROP POLICY IF EXISTS product_tier_prices_select ON public.product_tier_prices;
DROP POLICY IF EXISTS product_tier_prices_write ON public.product_tier_prices;

CREATE POLICY price_tiers_select ON public.price_tiers
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY price_tiers_write ON public.price_tiers
  FOR ALL TO authenticated
  USING (public.has_app_permission('settings') OR public.has_app_permission('products.write'))
  WITH CHECK (public.has_app_permission('settings') OR public.has_app_permission('products.write'));

CREATE POLICY product_tier_prices_select ON public.product_tier_prices
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY product_tier_prices_write ON public.product_tier_prices
  FOR ALL TO authenticated
  USING (public.has_app_permission('products.write'))
  WITH CHECK (public.has_app_permission('products.write'));

-- Seed default retail tier
INSERT INTO public.price_tiers (id, name, is_default, sort_order)
SELECT gen_random_uuid(), 'تجزئة', true, 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.price_tiers WHERE is_default = true
);

-- Mirror products.sell_price into default tier
INSERT INTO public.product_tier_prices (product_id, tier_id, sell_price)
SELECT p.id, t.id, COALESCE(p.sell_price, 0)
FROM public.products p
CROSS JOIN public.price_tiers t
WHERE t.is_default = true
ON CONFLICT (product_id, tier_id)
DO UPDATE SET sell_price = EXCLUDED.sell_price;

-- Keep default-tier row in sync when products.sell_price changes
CREATE OR REPLACE FUNCTION public.sync_default_tier_price_from_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier_id uuid;
BEGIN
  SELECT id INTO v_tier_id FROM public.price_tiers WHERE is_default = true LIMIT 1;
  IF v_tier_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.product_tier_prices (product_id, tier_id, sell_price)
  VALUES (NEW.id, v_tier_id, COALESCE(NEW.sell_price, 0))
  ON CONFLICT (product_id, tier_id)
  DO UPDATE SET sell_price = EXCLUDED.sell_price;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_default_tier_price ON public.products;
CREATE TRIGGER trg_sync_default_tier_price
  AFTER INSERT OR UPDATE OF sell_price ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_default_tier_price_from_product();

-- When default-tier price is edited, mirror back to products.sell_price
CREATE OR REPLACE FUNCTION public.sync_product_sell_from_default_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.price_tiers t
    WHERE t.id = NEW.tier_id AND t.is_default = true
  ) THEN
    UPDATE public.products
    SET sell_price = COALESCE(NEW.sell_price, 0),
        updated_at = NOW()
    WHERE id = NEW.product_id
      AND COALESCE(sell_price, 0) IS DISTINCT FROM COALESCE(NEW.sell_price, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_sell_from_tier ON public.product_tier_prices;
CREATE TRIGGER trg_sync_product_sell_from_tier
  AFTER INSERT OR UPDATE OF sell_price ON public.product_tier_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_sell_from_default_tier();

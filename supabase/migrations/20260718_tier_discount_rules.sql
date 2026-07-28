-- =========================================================================
-- Flexible tier discount rules: category % and product % off retail
-- Priority at sale: fixed product_tier_prices → product % → category % → retail
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tier_category_discounts (
  tier_id UUID NOT NULL REFERENCES public.price_tiers(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tier_id, category_id),
  CONSTRAINT tier_category_discounts_pct_range
    CHECK (discount_percent >= 0 AND discount_percent <= 100)
);

CREATE INDEX IF NOT EXISTS idx_tier_category_discounts_category
  ON public.tier_category_discounts (category_id);

CREATE TABLE IF NOT EXISTS public.tier_product_discounts (
  tier_id UUID NOT NULL REFERENCES public.price_tiers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tier_id, product_id),
  CONSTRAINT tier_product_discounts_pct_range
    CHECK (discount_percent >= 0 AND discount_percent <= 100)
);

CREATE INDEX IF NOT EXISTS idx_tier_product_discounts_product
  ON public.tier_product_discounts (product_id);

ALTER TABLE public.tier_category_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_product_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tier_category_discounts_select ON public.tier_category_discounts;
DROP POLICY IF EXISTS tier_category_discounts_write ON public.tier_category_discounts;
DROP POLICY IF EXISTS tier_product_discounts_select ON public.tier_product_discounts;
DROP POLICY IF EXISTS tier_product_discounts_write ON public.tier_product_discounts;

CREATE POLICY tier_category_discounts_select ON public.tier_category_discounts
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY tier_category_discounts_write ON public.tier_category_discounts
  FOR ALL TO authenticated
  USING (public.has_app_permission('settings') OR public.has_app_permission('products.write'))
  WITH CHECK (public.has_app_permission('settings') OR public.has_app_permission('products.write'));

CREATE POLICY tier_product_discounts_select ON public.tier_product_discounts
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY tier_product_discounts_write ON public.tier_product_discounts
  FOR ALL TO authenticated
  USING (public.has_app_permission('settings') OR public.has_app_permission('products.write'))
  WITH CHECK (public.has_app_permission('settings') OR public.has_app_permission('products.write'));

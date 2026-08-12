-- Customer business-line classification: سلك (wire/plisse) · محل (store) · ورشة (aa/workshop)
-- Auto-derived from activity, with optional manual lock.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS business_lines text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS business_lines_manual text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS business_lines_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_business_lines_valid;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_business_lines_valid
  CHECK (
    business_lines <@ ARRAY['wire', 'store', 'workshop']::text[]
  );

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_business_lines_manual_valid;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_business_lines_manual_valid
  CHECK (
    business_lines_manual <@ ARRAY['wire', 'store', 'workshop']::text[]
  );

CREATE INDEX IF NOT EXISTS idx_customers_business_lines
  ON public.customers USING GIN (business_lines);

COMMENT ON COLUMN public.customers.business_lines IS
  'Effective lines shown in UI: wire=سلك, store=محل, workshop=ورشة';
COMMENT ON COLUMN public.customers.business_lines_manual IS
  'User-chosen tags merged into business_lines when unlocked';
COMMENT ON COLUMN public.customers.business_lines_locked IS
  'When true, auto-derive will not overwrite business_lines';

-- Backfill from existing maps, ledger, and store invoices
WITH derived AS (
  SELECT
    c.id AS customer_id,
    ARRAY(
      SELECT DISTINCT x
      FROM unnest(
        ARRAY_REMOVE(
          ARRAY[
            CASE
              WHEN EXISTS (
                SELECT 1 FROM public.workshop_party_map m
                WHERE m.store_party_id = c.id
                  AND m.party_type = 'customer'
                  AND m.source_system = 'plisse'
              )
              OR EXISTS (
                SELECT 1 FROM public.cross_app_ledger_entries e
                WHERE e.party_type = 'customer'
                  AND e.party_id = c.id
                  AND e.source_system = 'plisse'
              )
              THEN 'wire'
            END,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM public.workshop_party_map m
                WHERE m.store_party_id = c.id
                  AND m.party_type = 'customer'
                  AND m.source_system = 'aa'
              )
              OR EXISTS (
                SELECT 1 FROM public.cross_app_ledger_entries e
                WHERE e.party_type = 'customer'
                  AND e.party_id = c.id
                  AND e.source_system = 'aa'
              )
              THEN 'workshop'
            END,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM public.invoices i
                WHERE i.customer_id = c.id
                  AND i.status = 'completed'
                  AND i.type IN ('sale', 'sale_return')
              )
              OR EXISTS (
                SELECT 1 FROM public.party_payments p
                WHERE p.party_type = 'customer'
                  AND p.party_id = c.id
              )
              OR COALESCE(c.balance, 0) <> 0
              OR COALESCE(c.opening_balance, 0) <> 0
              THEN 'store'
            END
          ]::text[],
          NULL
        )
      ) AS x
      ORDER BY x
    ) AS lines
  FROM public.customers c
)
UPDATE public.customers c
SET business_lines = d.lines
FROM derived d
WHERE c.id = d.customer_id
  AND c.business_lines_locked = false
  AND cardinality(d.lines) > 0;

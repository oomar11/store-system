-- Display order for safes (POS / dropdowns / settings)

ALTER TABLE public.safes
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.safes.sort_order IS
  'Lower values appear first in POS and other safe pickers.';

-- Backfill by current name order
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name ASC, created_at ASC) - 1 AS rn
  FROM public.safes
)
UPDATE public.safes s
SET sort_order = ordered.rn
FROM ordered
WHERE s.id = ordered.id;

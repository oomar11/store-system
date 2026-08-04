-- Unified free-form notes across recorded operations.
-- Keep existing description fields for semantic/system-generated text.

ALTER TABLE public.safe_transactions
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS notes text;

-- Optional backfill: copy existing descriptions into notes when notes is empty.
UPDATE public.safe_transactions
SET notes = description
WHERE notes IS NULL
  AND NULLIF(btrim(COALESCE(description, '')), '') IS NOT NULL;

UPDATE public.journal_entries
SET notes = description
WHERE notes IS NULL
  AND NULLIF(btrim(COALESCE(description, '')), '') IS NOT NULL;

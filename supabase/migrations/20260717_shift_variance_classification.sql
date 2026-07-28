-- Classify shift drawer variance (manager reconciles difference after close)

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS variance_class TEXT
    CHECK (
      variance_class IS NULL
      OR variance_class IN (
        'transfer',
        'withdrawal',
        'deposit',
        'shortage',
        'surplus',
        'other'
      )
    );

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS variance_reason TEXT;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS variance_related_safe_id UUID
    REFERENCES public.safes(id) ON DELETE SET NULL;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS variance_classified_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS variance_classified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.shifts.variance_class IS
  'Manager classification of counted vs expected drawer difference after close.';
COMMENT ON COLUMN public.shifts.variance_reason IS
  'Free-text explanation of the variance classification.';
COMMENT ON COLUMN public.shifts.variance_related_safe_id IS
  'Other safe involved when variance_class = transfer.';

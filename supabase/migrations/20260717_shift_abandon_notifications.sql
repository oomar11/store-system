-- Abandoned shift close + in-app notifications for managers

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS close_reason TEXT
    CHECK (
      close_reason IS NULL
      OR close_reason IN ('normal', 'abandoned_unload', 'abandoned_logout')
    );

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS abandon_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN public.shifts.close_reason IS
  'How the shift was closed: normal hand-over, or auto-closed after unload/logout.';
COMMENT ON COLUMN public.shifts.abandon_requested_at IS
  'Set on page unload; cleared if the session returns quickly. Finalize after grace period.';

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  meta JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_notifications_user_unread
  ON public.app_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_app_notifications_user_created
  ON public.app_notifications (user_id, created_at DESC);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_notifications_select ON public.app_notifications;
DROP POLICY IF EXISTS app_notifications_update ON public.app_notifications;
DROP POLICY IF EXISTS app_notifications_delete ON public.app_notifications;

CREATE POLICY app_notifications_select ON public.app_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY app_notifications_update ON public.app_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY app_notifications_delete ON public.app_notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Inserts via service role only (no INSERT policy for authenticated)

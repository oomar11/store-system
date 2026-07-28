-- Fix shift close RLS: employees could update open→closed but SELECT policy
-- then hid the new row (no treasury/reports), causing:
--   "new row violates row-level security policy for table shifts"
-- Align write policies with the dedicated `shifts` permission.

DROP POLICY IF EXISTS shifts_select ON public.shifts;
DROP POLICY IF EXISTS shifts_insert ON public.shifts;
DROP POLICY IF EXISTS shifts_update ON public.shifts;

-- Employees: open shifts + shifts they opened/closed (so close UPDATE RETURNING works).
-- Managers: full history via treasury/reports/backup.
CREATE POLICY shifts_select ON public.shifts
  FOR SELECT TO authenticated
  USING (
    status = 'open'
    OR opened_by = auth.uid()
    OR closed_by = auth.uid()
    OR public.has_app_permission('treasury')
    OR public.has_app_permission('reports')
    OR public.has_app_permission('settings.backup')
  );

CREATE POLICY shifts_insert ON public.shifts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_permission('shifts')
    OR public.has_app_permission('pos')
    OR public.has_app_permission('treasury')
  );

CREATE POLICY shifts_update ON public.shifts
  FOR UPDATE TO authenticated
  USING (
    public.has_app_permission('shifts')
    OR public.has_app_permission('pos')
    OR public.has_app_permission('treasury')
  )
  WITH CHECK (
    public.has_app_permission('shifts')
    OR public.has_app_permission('pos')
    OR public.has_app_permission('treasury')
  );

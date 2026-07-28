-- Employees can read open shifts; closed history only for managers/owners
DROP POLICY IF EXISTS shifts_select ON public.shifts;

CREATE POLICY shifts_select ON public.shifts
  FOR SELECT TO authenticated
  USING (
    status = 'open'
    OR public.has_app_permission('treasury')
    OR public.has_app_permission('reports')
    OR public.has_app_permission('settings.backup')
  );

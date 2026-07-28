-- Allow service_role (auth.uid() IS NULL) to update role / is_active
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
      RAISE EXCEPTION 'فقط المالك يمكنه تعديل الدور أو حالة التفعيل';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

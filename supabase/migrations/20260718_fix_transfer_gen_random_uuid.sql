-- Fix: uuid_generate_v4 lives in extensions schema; SECURITY DEFINER
-- functions with search_path=public cannot see it. Use gen_random_uuid().

CREATE OR REPLACE FUNCTION public.transfer_between_safes(
  p_from_safe_id uuid,
  p_to_safe_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_balance numeric;
  to_balance numeric;
  note text;
  group_id uuid := gen_random_uuid();
  from_name text;
  to_name text;
BEGIN
  IF NOT public.has_app_permission('treasury') THEN
    RAISE EXCEPTION 'تحويلات الخزينة غير مسموحة لصلاحياتك';
  END IF;

  IF p_from_safe_id IS NULL OR p_to_safe_id IS NULL OR p_from_safe_id = p_to_safe_id THEN
    RAISE EXCEPTION 'اختر خزنتين مختلفتين للتحويل';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'مبلغ التحويل غير صالح';
  END IF;

  SELECT balance, name INTO from_balance, from_name
  FROM public.safes
  WHERE id = p_from_safe_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخزنة المصدر غير موجودة';
  END IF;

  SELECT balance, name INTO to_balance, to_name
  FROM public.safes
  WHERE id = p_to_safe_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخزنة الهدف غير موجودة';
  END IF;

  IF COALESCE(from_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'رصيد الخزنة المصدر غير كافٍ';
  END IF;

  note := NULLIF(trim(COALESCE(p_description, '')), '');
  IF note IS NULL THEN
    note := format('تحويل من %s إلى %s', from_name, to_name);
  END IF;

  UPDATE public.safes SET balance = from_balance - p_amount WHERE id = p_from_safe_id;
  UPDATE public.safes SET balance = COALESCE(to_balance, 0) + p_amount WHERE id = p_to_safe_id;

  INSERT INTO public.safe_transactions (
    safe_id, type, amount, description, related_safe_id, transfer_group_id, reference_type
  ) VALUES
    (p_from_safe_id, 'transfer', p_amount, note, p_to_safe_id, group_id, 'transfer_out'),
    (p_to_safe_id, 'transfer', p_amount, note, p_from_safe_id, group_id, 'transfer_in');

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'log_audit_event'
  ) THEN
    PERFORM public.log_audit_event(
      'safe.transfer',
      'safe',
      p_from_safe_id,
      format('%s ← %s', from_name, to_name),
      jsonb_build_object('from_balance', from_balance, 'to_balance', to_balance),
      jsonb_build_object(
        'from_balance', from_balance - p_amount,
        'to_balance', COALESCE(to_balance, 0) + p_amount
      ),
      jsonb_build_object(
        'amount', p_amount,
        'from_safe_id', p_from_safe_id,
        'to_safe_id', p_to_safe_id,
        'from_name', from_name,
        'to_name', to_name,
        'description', note
      ),
      'rpc'
    );
  END IF;
END;
$$;

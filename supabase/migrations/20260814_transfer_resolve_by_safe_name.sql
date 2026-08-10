-- Hard fix: resolve transfer safes by name when id is missing/stale.
-- Fixes mobile «الخزنة الرئيسية» ↔ «خزنة المحل» / «المحل» when the phone sends a ghost id.

CREATE OR REPLACE FUNCTION public.transfer_between_safes(
  p_from_safe_id uuid,
  p_to_safe_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_from_safe_name text DEFAULT NULL,
  p_to_safe_name text DEFAULT NULL
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
  v_from_id uuid := p_from_safe_id;
  v_to_id uuid := p_to_safe_id;
  v_from_name text := NULLIF(trim(COALESCE(p_from_safe_name, '')), '');
  v_to_name text := NULLIF(trim(COALESCE(p_to_safe_name, '')), '');
BEGIN
  IF NOT public.has_app_permission('treasury') THEN
    RAISE EXCEPTION 'تحويلات الخزينة غير مسموحة لصلاحياتك';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'مبلغ التحويل غير صالح';
  END IF;

  -- Normalize Arabic vault labels for loose matching.
  -- «المحل» ↔ «خزنة المحل», ة/ه, أ/ا, drop leading «خزنة ».
  IF v_from_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.safes s WHERE s.id = v_from_id) THEN
    IF v_from_name IS NOT NULL THEN
      SELECT s.id INTO v_from_id
      FROM public.safes s
      WHERE s.name = v_from_name
      ORDER BY (s.deleted_at IS NULL) DESC, (COALESCE(s.is_active, true)) DESC, s.created_at DESC NULLS LAST
      LIMIT 1;
    END IF;
  END IF;

  IF v_from_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.safes s WHERE s.id = v_from_id) THEN
    IF v_from_name IS NOT NULL THEN
      SELECT s.id INTO v_from_id
      FROM public.safes s
      WHERE (
        replace(replace(replace(s.name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا')
          = replace(replace(replace(v_from_name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا')
        OR replace(replace(replace(replace(replace(s.name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا'), 'الخزنه ', ''), 'خزنه ', '')
          = replace(replace(replace(replace(replace(v_from_name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا'), 'الخزنه ', ''), 'خزنه ', '')
        OR replace(replace(replace(s.name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا')
             LIKE '%' || replace(replace(replace(replace(replace(v_from_name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا'), 'الخزنه ', ''), 'خزنه ', '') || '%'
        OR replace(replace(replace(v_from_name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا')
             LIKE '%' || replace(replace(replace(replace(replace(s.name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا'), 'الخزنه ', ''), 'خزنه ', '') || '%'
      )
      ORDER BY (s.deleted_at IS NULL) DESC, (COALESCE(s.is_active, true)) DESC, s.created_at DESC NULLS LAST
      LIMIT 1;
    END IF;
  END IF;

  IF v_to_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.safes s WHERE s.id = v_to_id) THEN
    IF v_to_name IS NOT NULL THEN
      SELECT s.id INTO v_to_id
      FROM public.safes s
      WHERE s.name = v_to_name
      ORDER BY (s.deleted_at IS NULL) DESC, (COALESCE(s.is_active, true)) DESC, s.created_at DESC NULLS LAST
      LIMIT 1;
    END IF;
  END IF;

  IF v_to_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.safes s WHERE s.id = v_to_id) THEN
    IF v_to_name IS NOT NULL THEN
      SELECT s.id INTO v_to_id
      FROM public.safes s
      WHERE (
        replace(replace(replace(s.name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا')
          = replace(replace(replace(v_to_name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا')
        OR replace(replace(replace(replace(replace(s.name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا'), 'الخزنه ', ''), 'خزنه ', '')
          = replace(replace(replace(replace(replace(v_to_name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا'), 'الخزنه ', ''), 'خزنه ', '')
        OR replace(replace(replace(s.name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا')
             LIKE '%' || replace(replace(replace(replace(replace(v_to_name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا'), 'الخزنه ', ''), 'خزنه ', '') || '%'
        OR replace(replace(replace(v_to_name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا')
             LIKE '%' || replace(replace(replace(replace(replace(s.name, 'ة', 'ه'), 'أ', 'ا'), 'إ', 'ا'), 'الخزنه ', ''), 'خزنه ', '') || '%'
      )
      ORDER BY (s.deleted_at IS NULL) DESC, (COALESCE(s.is_active, true)) DESC, s.created_at DESC NULLS LAST
      LIMIT 1;
    END IF;
  END IF;

  IF v_from_id IS NULL OR v_to_id IS NULL OR v_from_id = v_to_id THEN
    RAISE EXCEPTION 'اختر خزنتين مختلفتين للتحويل';
  END IF;

  -- Revive soft-deleted / inactive vaults so transfers still work.
  UPDATE public.safes
  SET
    deleted_at = NULL,
    is_active = true,
    updated_at = NOW()
  WHERE id IN (v_from_id, v_to_id)
    AND (deleted_at IS NOT NULL OR COALESCE(is_active, true) = false);

  SELECT balance, name INTO from_balance, from_name
  FROM public.safes
  WHERE id = v_from_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخزنة المصدر غير موجودة (%)', COALESCE(v_from_name, v_from_id::text);
  END IF;

  SELECT balance, name INTO to_balance, to_name
  FROM public.safes
  WHERE id = v_to_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخزنة الهدف غير موجودة (%)', COALESCE(v_to_name, v_to_id::text);
  END IF;

  IF COALESCE(from_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'رصيد الخزنة المصدر غير كافٍ';
  END IF;

  note := NULLIF(trim(COALESCE(p_description, '')), '');
  IF note IS NULL THEN
    note := format('تحويل من %s إلى %s', from_name, to_name);
  END IF;

  UPDATE public.safes SET balance = from_balance - p_amount WHERE id = v_from_id;
  UPDATE public.safes SET balance = COALESCE(to_balance, 0) + p_amount WHERE id = v_to_id;

  INSERT INTO public.safe_transactions (
    safe_id, type, amount, description, related_safe_id, transfer_group_id, reference_type
  ) VALUES
    (v_from_id, 'transfer', p_amount, note, v_to_id, group_id, 'transfer_out'),
    (v_to_id, 'transfer', p_amount, note, v_from_id, group_id, 'transfer_in');

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'log_audit_event'
  ) THEN
    PERFORM public.log_audit_event(
      'safe.transfer',
      'safe',
      v_from_id,
      format('%s ← %s', from_name, to_name),
      jsonb_build_object('from_balance', from_balance, 'to_balance', to_balance),
      jsonb_build_object(
        'from_balance', from_balance - p_amount,
        'to_balance', COALESCE(to_balance, 0) + p_amount
      ),
      jsonb_build_object(
        'amount', p_amount,
        'from_safe_id', v_from_id,
        'to_safe_id', v_to_id,
        'from_name', from_name,
        'to_name', to_name,
        'description', note
      ),
      'rpc'
    );
  END IF;
END;
$$;

-- Keep both signatures callable during rollout.
REVOKE ALL ON FUNCTION public.transfer_between_safes(uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_between_safes(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_between_safes(uuid, uuid, numeric, text, text, text) TO authenticated;

-- Recreate 4-arg wrapper so older clients keep working.
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
BEGIN
  PERFORM public.transfer_between_safes(
    p_from_safe_id,
    p_to_safe_id,
    p_amount,
    p_description,
    NULL,
    NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_between_safes(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_between_safes(uuid, uuid, numeric, text, text, text) TO authenticated;

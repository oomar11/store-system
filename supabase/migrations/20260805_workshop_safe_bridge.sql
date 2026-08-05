-- Bridge: workshop (aa) posts cash movements into store safes via service role.
-- apply_safe_movement requires auth.uid(); this RPC is service_role-only.

CREATE OR REPLACE FUNCTION public.apply_workshop_safe_movement(
  p_safe_id uuid,
  p_type text,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance numeric;
  next_balance numeric;
  updated_rows integer;
  v_safe_name text;
  v_tx_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح — جسر الورشة فقط';
  END IF;

  IF p_safe_id IS NULL OR COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'مبلغ أو خزنة غير صالحين';
  END IF;

  IF p_type NOT IN ('deposit', 'withdrawal') THEN
    RAISE EXCEPTION 'نوع حركة الخزنة غير صالح';
  END IF;

  IF COALESCE(p_reference_type, '') NOT LIKE 'workshop_%' THEN
    RAISE EXCEPTION 'نوع مرجع الورشة غير صالح';
  END IF;

  SELECT balance, name INTO current_balance, v_safe_name
  FROM public.safes
  WHERE id = p_safe_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر قراءة رصيد الخزنة';
  END IF;

  current_balance := COALESCE(current_balance, 0);
  next_balance := CASE
    WHEN p_type = 'deposit' THEN current_balance + p_amount
    ELSE current_balance - p_amount
  END;

  IF p_type = 'withdrawal' AND next_balance < 0 THEN
    RAISE EXCEPTION 'رصيد الخزنة غير كافٍ لإتمام العملية';
  END IF;

  UPDATE public.safes
  SET balance = next_balance
  WHERE id = p_safe_id;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows = 0 THEN
    RAISE EXCEPTION 'تعذر تحديث رصيد الخزنة';
  END IF;

  INSERT INTO public.safe_transactions (
    safe_id, type, amount, description, notes, reference_type, reference_id, created_at
  ) VALUES (
    p_safe_id, p_type, p_amount, p_description, p_notes, p_reference_type, p_reference_id,
    COALESCE(p_created_at, NOW())
  )
  RETURNING id INTO v_tx_id;

  PERFORM public.log_audit_event(
    'safe.movement',
    'safe',
    p_safe_id,
    v_safe_name,
    jsonb_build_object('balance', current_balance),
    jsonb_build_object('balance', next_balance),
    jsonb_build_object(
      'type', p_type,
      'amount', p_amount,
      'description', p_description,
      'reference_type', p_reference_type,
      'reference_id', p_reference_id,
      'source', 'workshop_bridge'
    ),
    'rpc'
  );

  RETURN v_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_workshop_safe_movement(
  uuid, text, numeric, text, text, uuid, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_workshop_safe_movement(
  uuid, text, numeric, text, text, uuid, text, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.apply_workshop_safe_movement IS
  'Service-role only: apply deposit/withdrawal from UPVC workshop bridge into store safes.';

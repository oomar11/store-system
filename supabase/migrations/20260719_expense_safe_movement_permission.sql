-- Allow expense-linked safe movements for users with the expenses permission.
-- Previously apply_safe_movement treated any non-invoice movement as a manual
-- treasury op and required the treasury permission, so expenses-only staff
-- could open /expenses but failed when deducting from a safe.

CREATE OR REPLACE FUNCTION public.apply_safe_movement(
  p_safe_id uuid,
  p_type text,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance numeric;
  next_balance numeric;
  updated_rows integer;
  v_safe_name text;
  v_ref text := COALESCE(p_reference_type, '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  -- Invoice cash movements: any active staff who can complete sales/purchases.
  IF v_ref IN ('invoice', 'invoice_reversal') THEN
    NULL;
  -- Expense create/reverse: expenses permission (not treasury).
  ELSIF v_ref = 'expense' THEN
    IF NOT public.has_app_permission('expenses') THEN
      RAISE EXCEPTION 'تسجيل المصروفات غير مسموح لصلاحياتك';
    END IF;
  -- Party collect/pay: customers/suppliers writers or treasury.
  ELSIF v_ref IN ('party_payment', 'party_payment_reversal') THEN
    IF NOT (
      public.has_app_permission('treasury')
      OR public.has_app_permission('customers.write')
      OR public.has_app_permission('suppliers')
    ) THEN
      RAISE EXCEPTION 'تحصيل/سداد الأطراف غير مسموح لصلاحياتك';
    END IF;
  -- Shift variance settlement: shifts or treasury.
  ELSIF v_ref = 'shift_variance' THEN
    IF NOT (
      public.has_app_permission('treasury')
      OR public.has_app_permission('shifts')
    ) THEN
      RAISE EXCEPTION 'تسوية فرق الوردية غير مسموحة لصلاحياتك';
    END IF;
  -- Manual / opening / other treasury ops.
  ELSIF NOT public.has_app_permission('treasury') THEN
    RAISE EXCEPTION 'عمليات الخزينة اليدوية غير مسموحة لصلاحياتك';
  END IF;

  IF p_safe_id IS NULL OR COALESCE(p_amount, 0) <= 0 THEN
    RETURN;
  END IF;

  IF p_type NOT IN ('deposit', 'withdrawal') THEN
    RAISE EXCEPTION 'نوع حركة الخزنة غير صالح';
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
    safe_id, type, amount, description, reference_type, reference_id
  ) VALUES (
    p_safe_id, p_type, p_amount, p_description, p_reference_type, p_reference_id
  );

  IF v_ref NOT IN ('invoice', 'invoice_reversal') THEN
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
        'reference_id', p_reference_id
      ),
      'rpc'
    );
  END IF;
END;
$$;

-- Allow expenses staff to remove the original expense withdrawal row after
-- the compensating deposit is applied (see deleteExpense).
DROP POLICY IF EXISTS safe_transactions_delete ON public.safe_transactions;
CREATE POLICY safe_transactions_delete ON public.safe_transactions
  FOR DELETE TO authenticated
  USING (
    public.has_app_permission('settings.backup')
    OR public.has_app_permission('treasury')
    OR (
      public.has_app_permission('expenses')
      AND COALESCE(reference_type, '') = 'expense'
    )
  );

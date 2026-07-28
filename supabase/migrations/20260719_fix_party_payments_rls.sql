-- Fix party_payments RLS: employees with `customers` (read) could open collect
-- UI but INSERT required `customers.write`, causing:
--   "new row violates row-level security policy for table party_payments"
-- Align write policies + apply_safe_movement with the same keys the UI uses.

DROP POLICY IF EXISTS party_payments_insert ON public.party_payments;
CREATE POLICY party_payments_insert ON public.party_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_permission('customers')
    OR public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

DROP POLICY IF EXISTS party_payments_update ON public.party_payments;
CREATE POLICY party_payments_update ON public.party_payments
  FOR UPDATE TO authenticated
  USING (
    public.has_app_permission('customers')
    OR public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  )
  WITH CHECK (
    public.has_app_permission('customers')
    OR public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

DROP POLICY IF EXISTS party_payments_delete ON public.party_payments;
CREATE POLICY party_payments_delete ON public.party_payments
  FOR DELETE TO authenticated
  USING (
    public.has_app_permission('customers')
    OR public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

DROP POLICY IF EXISTS party_payment_allocations_insert ON public.party_payment_allocations;
CREATE POLICY party_payment_allocations_insert ON public.party_payment_allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_permission('customers')
    OR public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

DROP POLICY IF EXISTS party_payment_allocations_delete ON public.party_payment_allocations;
CREATE POLICY party_payment_allocations_delete ON public.party_payment_allocations
  FOR DELETE TO authenticated
  USING (
    public.has_app_permission('customers')
    OR public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

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
  -- Party collect/pay: customers (read or write), suppliers, or treasury.
  ELSIF v_ref IN ('party_payment', 'party_payment_reversal') THEN
    IF NOT (
      public.has_app_permission('treasury')
      OR public.has_app_permission('customers')
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

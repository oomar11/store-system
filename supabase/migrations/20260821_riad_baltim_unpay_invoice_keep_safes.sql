-- رياض بلطيم: فاتورة بيع INV-2608-0006 يوم 3/8 سُجّلت نقداً بالكامل
-- ثم سداد مورد بنفس المبلغ تقريباً لنقل الحساب قبل دمج العميل/المورد.
-- المطلوب: الفاتورة آجل غير مدفوعة + حذف السداد، من غير تحريك أرصدة الخزن
-- (الحركتان تعادلتا في الخزنة الرئيسية؛ عكسهما بالطريقة العادية هيخرّب الرصيد).

DO $$
DECLARE
  v_sale public.invoices%ROWTYPE;
  v_purchase public.invoices%ROWTYPE;
  v_payment public.party_payments%ROWTYPE;
  v_customer_id uuid;
  v_supplier_id uuid;
  v_safe_id uuid;
  v_safe_before numeric;
  v_safe_after numeric;
  v_deposit_id uuid := 'a8b7542a-7cbf-473f-afa5-187a5c32d59e';
  v_withdraw_id uuid := '9e147420-8311-4830-b8d2-daa799b1a131';
BEGIN
  SELECT * INTO v_sale
  FROM public.invoices
  WHERE invoice_number = 'INV-2608-0006'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'INV-2608-0006 not found, skip';
    RETURN;
  END IF;

  IF v_sale.type IS DISTINCT FROM 'sale'
     OR v_sale.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'INV-2608-0006 unexpected type/status';
  END IF;

  -- Already corrected
  IF v_sale.payment_method = 'credit'
     AND COALESCE(v_sale.paid_amount, 0) = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.party_payments
       WHERE id = '377d7160-b9af-41bc-a503-320b16c609f3'
     ) THEN
    RAISE NOTICE 'INV-2608-0006 already credit and payment gone, skip';
    RETURN;
  END IF;

  IF COALESCE(v_sale.paid_amount, 0) IS DISTINCT FROM 10012.34
     OR v_sale.payment_method IS DISTINCT FROM 'cash' THEN
    RAISE EXCEPTION
      'INV-2608-0006 unexpected paid/method: % %',
      v_sale.paid_amount, v_sale.payment_method;
  END IF;

  v_customer_id := v_sale.customer_id;
  v_safe_id := v_sale.safe_id;

  SELECT * INTO v_purchase
  FROM public.invoices
  WHERE invoice_number = 'PUR-2607-0002'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUR-2607-0002 not found';
  END IF;

  IF COALESCE(v_purchase.paid_amount, 0) IS DISTINCT FROM 10012.00 THEN
    RAISE EXCEPTION 'PUR-2607-0002 unexpected paid_amount: %', v_purchase.paid_amount;
  END IF;

  v_supplier_id := v_purchase.supplier_id;

  SELECT * INTO v_payment
  FROM public.party_payments
  WHERE id = '377d7160-b9af-41bc-a503-320b16c609f3'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier payment 377d7160 not found';
  END IF;

  IF v_payment.party_type IS DISTINCT FROM 'supplier'
     OR COALESCE(v_payment.amount, 0) IS DISTINCT FROM 10012.00
     OR v_payment.party_id IS DISTINCT FROM v_supplier_id THEN
    RAISE EXCEPTION 'supplier payment unexpected';
  END IF;

  IF v_safe_id IS NULL THEN
    v_safe_id := v_payment.safe_id;
  END IF;

  SELECT balance INTO v_safe_before
  FROM public.safes
  WHERE id = v_safe_id
  FOR UPDATE;

  UPDATE public.invoices
  SET paid_amount = 0,
      payment_method = 'credit',
      safe_id = NULL
  WHERE id = v_sale.id;

  UPDATE public.customers
  SET balance = COALESCE(balance, 0) + 10012.34
  WHERE id = v_customer_id;

  UPDATE public.invoices
  SET paid_amount = 0
  WHERE id = v_purchase.id;

  UPDATE public.suppliers
  SET balance = COALESCE(balance, 0) + 10012.00
  WHERE id = v_supplier_id;

  DELETE FROM public.party_payment_allocations
  WHERE payment_id = v_payment.id;

  DELETE FROM public.party_payments
  WHERE id = v_payment.id;

  -- Remove the offsetting cash rows only; do not touch safes.balance
  DELETE FROM public.safe_transactions
  WHERE id IN (v_deposit_id, v_withdraw_id)
    AND (
      (id = v_deposit_id AND reference_type = 'invoice' AND reference_id = v_sale.id)
      OR (id = v_withdraw_id AND reference_type = 'party_payment' AND reference_id = v_payment.id)
    );

  SELECT balance INTO v_safe_after
  FROM public.safes
  WHERE id = v_safe_id;

  IF v_safe_after IS DISTINCT FROM v_safe_before THEN
    RAISE EXCEPTION 'safe balance changed from % to %', v_safe_before, v_safe_after;
  END IF;

  INSERT INTO public.audit_logs (
    actor_name, action, entity_type, entity_id, entity_label,
    before_data, after_data, meta, source
  ) VALUES (
    'cloud-agent',
    'invoice.unpay_without_safe',
    'invoice',
    v_sale.id,
    'INV-2608-0006 / رياض بلطيم',
    jsonb_build_object(
      'sale_paid', v_sale.paid_amount,
      'sale_method', v_sale.payment_method,
      'purchase_paid', v_purchase.paid_amount,
      'payment_id', v_payment.id,
      'safe_balance', v_safe_before
    ),
    jsonb_build_object(
      'sale_paid', 0,
      'sale_method', 'credit',
      'purchase_paid', 0,
      'payment_deleted', true,
      'safe_balance', v_safe_after
    ),
    jsonb_build_object(
      'reason',
      'إلغاء سداد شكلي لنقل حساب رياض بلطيم قبل دمج العميل/المورد مع الإبقاء على أرصدة الخزن'
    ),
    'manual_correction'
  );
END $$;

-- =========================================================================
-- Atomic create completed sale/purchase invoice (single transaction)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_completed_invoice(
  p_type text,
  p_items jsonb,
  p_subtotal numeric,
  p_total numeric,
  p_tax_amount numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_paid_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'cash',
  p_customer_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_safe_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text := lower(trim(p_type));
  v_method text := lower(trim(COALESCE(p_payment_method, 'cash')));
  v_paid numeric := COALESCE(p_paid_amount, 0);
  v_total numeric := COALESCE(p_total, 0);
  v_remaining numeric;
  v_invoice_id uuid;
  v_invoice_number text;
  v_kind text;
  v_stock_dir integer;
  v_safe_type text;
  v_type_label text;
  v_line jsonb;
  v_qty numeric;
  v_unit_price numeric;
  v_unit_cost numeric;
  v_discount numeric;
  v_line_total numeric;
  v_product_id uuid;
  v_item_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF v_type NOT IN ('sale', 'purchase') THEN
    RAISE EXCEPTION 'نوع الفاتورة غير صالح';
  END IF;

  IF v_method NOT IN ('cash', 'credit') THEN
    RAISE EXCEPTION 'طريقة الدفع غير صالحة';
  END IF;

  IF v_type = 'sale' THEN
    IF NOT (
      public.has_app_permission('pos')
      OR public.has_app_permission('sales')
    ) THEN
      RAISE EXCEPTION 'غير مصرح بإنشاء فاتورة مبيعات';
    END IF;
    v_kind := 'sale';
    v_stock_dir := -1;
    v_safe_type := 'deposit';
    v_type_label := 'بيع';
  ELSE
    IF NOT public.has_app_permission('purchases') THEN
      RAISE EXCEPTION 'غير مصرح بإنشاء فاتورة مشتريات';
    END IF;
    v_kind := 'purchase';
    v_stock_dir := 1;
    v_safe_type := 'withdrawal';
    v_type_label := 'شراء';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'بنود الفاتورة مطلوبة';
  END IF;

  IF v_total < 0 OR v_paid < 0 THEN
    RAISE EXCEPTION 'المبالغ غير صالحة';
  END IF;

  IF v_paid > v_total + 0.001 THEN
    RAISE EXCEPTION 'المبلغ المدفوع أكبر من إجمالي الفاتورة';
  END IF;

  v_remaining := GREATEST(0, v_total - v_paid);

  IF v_type = 'purchase' AND p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'المورد مطلوب لفاتورة المشتريات';
  END IF;

  IF v_type = 'sale' AND v_remaining > 0 AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'العميل مطلوب للفواتير الآجلة';
  END IF;

  IF v_type = 'purchase' AND v_remaining > 0 AND p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'المورد مطلوب للفواتير الآجلة';
  END IF;

  IF v_paid > 0 AND p_safe_id IS NULL THEN
    RAISE EXCEPTION 'الرجاء تحديد الخزنة للمدفوعات';
  END IF;

  -- Allocate number inside the same transaction
  v_invoice_number := public.next_document_number(v_kind);

  INSERT INTO public.invoices (
    invoice_number,
    type,
    status,
    customer_id,
    supplier_id,
    subtotal,
    tax_amount,
    discount_amount,
    total,
    paid_amount,
    payment_method,
    notes,
    safe_id,
    created_at
  ) VALUES (
    v_invoice_number,
    v_type,
    'completed',
    CASE WHEN v_type = 'sale' THEN p_customer_id ELSE NULL END,
    CASE WHEN v_type = 'purchase' THEN p_supplier_id ELSE NULL END,
    COALESCE(p_subtotal, v_total),
    COALESCE(p_tax_amount, 0),
    COALESCE(p_discount_amount, 0),
    v_total,
    v_paid,
    v_method,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    CASE WHEN v_paid > 0 THEN p_safe_id ELSE NULL END,
    COALESCE(p_created_at, NOW())
  )
  RETURNING id INTO v_invoice_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty := COALESCE((v_line->>'quantity')::numeric, 0);
    v_unit_price := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_discount := COALESCE((v_line->>'discount')::numeric, 0);
    v_line_total := COALESCE(
      (v_line->>'total')::numeric,
      (v_qty * v_unit_price) - v_discount
    );
    v_unit_cost := COALESCE(
      (v_line->>'unit_cost')::numeric,
      CASE WHEN v_type = 'purchase' THEN v_unit_price ELSE 0 END
    );

    IF v_product_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'بند فاتورة غير صالح';
    END IF;

    INSERT INTO public.invoice_items (
      invoice_id, product_id, quantity, unit_price, unit_cost, discount, total
    ) VALUES (
      v_invoice_id, v_product_id, v_qty, v_unit_price, v_unit_cost, v_discount, v_line_total
    );

    v_item_count := v_item_count + 1;
  END LOOP;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'بنود الفاتورة مطلوبة';
  END IF;

  -- Stock
  PERFORM public.adjust_product_stock(
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'product_id', elem->>'product_id',
        'quantity', (elem->>'quantity')::numeric
      )), '[]'::jsonb)
      FROM jsonb_array_elements(p_items) AS elem
    ),
    v_stock_dir,
    false
  );

  -- Party balance (credit remaining)
  IF v_remaining > 0 THEN
    IF v_type = 'sale' THEN
      PERFORM public.adjust_customer_balance(p_customer_id, v_remaining);
    ELSE
      PERFORM public.adjust_supplier_balance(p_supplier_id, v_remaining);
    END IF;
  END IF;

  -- Safe payment
  IF v_paid > 0 THEN
    PERFORM public.apply_safe_movement(
      p_safe_id,
      v_safe_type,
      v_paid,
      format('دفع %s رقم %s', v_type_label, v_invoice_number),
      'invoice',
      v_invoice_id
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_invoice_id,
    'invoice_number', v_invoice_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_completed_invoice(
  text, jsonb, numeric, numeric, numeric, numeric, numeric, text, uuid, uuid, uuid, text, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_completed_invoice(
  text, jsonb, numeric, numeric, numeric, numeric, numeric, text, uuid, uuid, uuid, text, timestamptz
) TO authenticated;

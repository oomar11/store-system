-- Snapshot retail (before tier) unit price on invoice/document lines for print.

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS list_unit_price DECIMAL(12,2);

ALTER TABLE public.document_items
  ADD COLUMN IF NOT EXISTS list_unit_price DECIMAL(12,2);

COMMENT ON COLUMN public.invoice_items.list_unit_price IS
  'Retail/list unit price before tier markdown; null when same as unit_price';
COMMENT ON COLUMN public.document_items.list_unit_price IS
  'Retail/list unit price before tier markdown; null when same as unit_price';


-- Persist list_unit_price from p_items JSON when creating invoices
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
  p_created_at timestamptz DEFAULT NULL,
  p_original_invoice_id uuid DEFAULT NULL,
  p_client_op_id uuid DEFAULT NULL
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
  v_list_unit_price numeric;
  v_line_total numeric;
  v_product_id uuid;
  v_item_count integer := 0;
  v_allow_negative boolean := false;
  v_balance_sign integer := 1;
  v_customer_id uuid := p_customer_id;
  v_supplier_id uuid := p_supplier_id;
  v_original_id uuid := p_original_invoice_id;
  v_orig_type text;
  v_orig_status text;
  v_orig_customer uuid;
  v_orig_supplier uuid;
  v_orig_qty numeric;
  v_returned_qty numeric;
  v_orig_unit_cost numeric;
  v_occurred_at timestamptz := COALESCE(p_created_at, NOW());
  v_existing public.client_operations%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF p_client_op_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.client_operations
    WHERE client_op_id = p_client_op_id;

    IF FOUND AND v_existing.result IS NOT NULL THEN
      RETURN v_existing.result;
    END IF;
  END IF;

  IF v_type NOT IN ('sale', 'purchase', 'sale_return', 'purchase_return') THEN
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
    v_balance_sign := 1;
  ELSIF v_type = 'purchase' THEN
    IF NOT public.has_app_permission('purchases') THEN
      RAISE EXCEPTION 'غير مصرح بإنشاء فاتورة مشتريات';
    END IF;
    v_kind := 'purchase';
    v_stock_dir := 1;
    v_safe_type := 'withdrawal';
    v_type_label := 'شراء';
    v_balance_sign := 1;
  ELSIF v_type = 'sale_return' THEN
    IF NOT (
      public.has_app_permission('pos')
      OR public.has_app_permission('sales')
    ) THEN
      RAISE EXCEPTION 'غير مصرح بإنشاء مرتجع مبيعات';
    END IF;
    v_kind := 'sale_return';
    v_stock_dir := 1;
    v_safe_type := 'withdrawal';
    v_type_label := 'مرتجع مبيعات';
    v_balance_sign := -1;
  ELSE
    IF NOT public.has_app_permission('purchases') THEN
      RAISE EXCEPTION 'غير مصرح بإنشاء مرتجع مشتريات';
    END IF;
    v_kind := 'purchase_return';
    v_stock_dir := -1;
    v_safe_type := 'deposit';
    v_type_label := 'مرتجع مشتريات';
    v_allow_negative := true;
    v_balance_sign := -1;
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

  IF v_type IN ('sale_return', 'purchase_return') THEN
    IF v_original_id IS NULL THEN
      RAISE EXCEPTION 'الفاتورة الأصلية مطلوبة للمرتجع';
    END IF;

    SELECT i.type, i.status, i.customer_id, i.supplier_id
      INTO v_orig_type, v_orig_status, v_orig_customer, v_orig_supplier
    FROM public.invoices i
    WHERE i.id = v_original_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'الفاتورة الأصلية غير موجودة';
    END IF;

    IF v_orig_status <> 'completed' THEN
      RAISE EXCEPTION 'الفاتورة الأصلية غير مكتملة';
    END IF;

    IF v_type = 'sale_return' AND v_orig_type <> 'sale' THEN
      RAISE EXCEPTION 'مرتجع المبيعات يجب أن يكون من فاتورة بيع';
    END IF;

    IF v_type = 'purchase_return' AND v_orig_type <> 'purchase' THEN
      RAISE EXCEPTION 'مرتجع المشتريات يجب أن يكون من فاتورة شراء';
    END IF;

    v_customer_id := COALESCE(v_customer_id, v_orig_customer);
    v_supplier_id := COALESCE(v_supplier_id, v_orig_supplier);
  ELSE
    v_original_id := NULL;
  END IF;

  IF v_type = 'purchase' AND v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'المورد مطلوب لفاتورة المشتريات';
  END IF;

  IF v_type = 'sale' AND v_remaining > 0 AND v_customer_id IS NULL THEN
    RAISE EXCEPTION 'العميل مطلوب للفواتير الآجلة';
  END IF;

  IF v_type = 'sale_return' AND v_method = 'credit' AND v_customer_id IS NULL THEN
    RAISE EXCEPTION 'العميل مطلوب لمرتجعات المبيعات الآجلة';
  END IF;

  IF v_type = 'purchase_return' AND v_method = 'credit' AND v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'المورد مطلوب لمرتجعات المشتريات الآجلة';
  END IF;

  IF v_paid > 0 AND p_safe_id IS NULL THEN
    RAISE EXCEPTION 'الرجاء تحديد الخزنة للمدفوعات';
  END IF;

  v_invoice_number := public.next_document_number(v_kind, v_occurred_at);

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
    created_at,
    original_invoice_id
  ) VALUES (
    v_invoice_number,
    v_type,
    'completed',
    CASE WHEN v_type IN ('sale', 'sale_return') THEN v_customer_id ELSE NULL END,
    CASE WHEN v_type IN ('purchase', 'purchase_return') THEN v_supplier_id ELSE NULL END,
    COALESCE(p_subtotal, v_total),
    COALESCE(p_tax_amount, 0),
    COALESCE(p_discount_amount, 0),
    v_total,
    v_paid,
    v_method,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    CASE WHEN v_paid > 0 THEN p_safe_id ELSE NULL END,
    v_occurred_at,
    v_original_id
  )
  RETURNING id INTO v_invoice_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty := COALESCE((v_line->>'quantity')::numeric, 0);
    v_unit_price := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_discount := COALESCE((v_line->>'discount')::numeric, 0);
    v_list_unit_price := CASE
      WHEN NULLIF(v_line->>'list_unit_price', '') IS NULL THEN NULL
      ELSE (v_line->>'list_unit_price')::numeric
    END;
    v_line_total := COALESCE(
      (v_line->>'total')::numeric,
      (v_qty * v_unit_price) - v_discount
    );

    IF v_product_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'بند فاتورة غير صالح';
    END IF;

    IF v_type IN ('sale_return', 'purchase_return') THEN
      SELECT COALESCE(SUM(ii.quantity), 0),
             (ARRAY_AGG(ii.unit_cost ORDER BY ii.id))[1]
        INTO v_orig_qty, v_orig_unit_cost
      FROM public.invoice_items ii
      WHERE ii.invoice_id = v_original_id
        AND ii.product_id = v_product_id
        AND ABS(ii.unit_price - v_unit_price) < 0.001;

      IF v_orig_qty <= 0 THEN
        RAISE EXCEPTION 'الصنف غير موجود في الفاتورة الأصلية بهذا السعر';
      END IF;

      SELECT COALESCE(SUM(ii.quantity), 0)
        INTO v_returned_qty
      FROM public.invoices r
      JOIN public.invoice_items ii ON ii.invoice_id = r.id
      WHERE r.original_invoice_id = v_original_id
        AND r.type = v_type
        AND r.status = 'completed'
        AND ii.product_id = v_product_id
        AND ABS(ii.unit_price - v_unit_price) < 0.001;

      IF v_qty > (v_orig_qty - v_returned_qty) + 0.001 THEN
        RAISE EXCEPTION 'كمية الإرجاع أكبر من الكمية المتبقية في الفاتورة الأصلية';
      END IF;

      v_unit_cost := COALESCE(
        (v_line->>'unit_cost')::numeric,
        v_orig_unit_cost,
        CASE WHEN v_type = 'purchase_return' THEN v_unit_price ELSE 0 END
      );
    ELSE
      v_unit_cost := COALESCE(
        (v_line->>'unit_cost')::numeric,
        CASE WHEN v_type = 'purchase' THEN v_unit_price ELSE 0 END
      );
    END IF;

    INSERT INTO public.invoice_items (
      invoice_id, product_id, quantity, unit_price, unit_cost, discount, total, list_unit_price
    ) VALUES (
      v_invoice_id, v_product_id, v_qty, v_unit_price, v_unit_cost, v_discount, v_line_total, v_list_unit_price
    );

    v_item_count := v_item_count + 1;
  END LOOP;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'بنود الفاتورة مطلوبة';
  END IF;

  PERFORM public.adjust_product_stock(
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'product_id', elem->>'product_id',
        'quantity', (elem->>'quantity')::numeric
      )), '[]'::jsonb)
      FROM jsonb_array_elements(p_items) AS elem
    ),
    v_stock_dir,
    v_allow_negative
  );

  IF v_remaining > 0 THEN
    IF v_type IN ('sale', 'sale_return') THEN
      PERFORM public.adjust_customer_balance(v_customer_id, v_balance_sign * v_remaining);
    ELSE
      PERFORM public.adjust_supplier_balance(v_supplier_id, v_balance_sign * v_remaining);
    END IF;
  END IF;

  IF v_paid > 0 THEN
    PERFORM public.apply_safe_movement(
      p_safe_id,
      v_safe_type,
      v_paid,
      format('دفع %s رقم %s', v_type_label, v_invoice_number),
      'invoice',
      v_invoice_id,
      v_occurred_at
    );
  END IF;

  v_result := jsonb_build_object(
    'id', v_invoice_id,
    'invoice_number', v_invoice_number
  );

  IF p_client_op_id IS NOT NULL THEN
    INSERT INTO public.client_operations (
      client_op_id, user_id, op_type, occurred_at, entity_id, entity_number, result
    ) VALUES (
      p_client_op_id,
      auth.uid(),
      'invoice',
      v_occurred_at,
      v_invoice_id,
      v_invoice_number,
      v_result
    )
    ON CONFLICT (client_op_id) DO UPDATE
    SET
      entity_id = EXCLUDED.entity_id,
      entity_number = EXCLUDED.entity_number,
      result = EXCLUDED.result,
      synced_at = NOW();
  END IF;

  RETURN v_result;
END;
$$;

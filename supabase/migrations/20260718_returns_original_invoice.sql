-- =========================================================================
-- Link returns to original sale/purchase invoices + enforce prices/qty
-- =========================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS original_invoice_id UUID REFERENCES public.invoices(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_invoices_original_invoice_id
  ON public.invoices(original_invoice_id);

-- Sale/purchase must never point at another invoice; returns may be NULL for legacy rows
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_original_invoice_sale_purchase_null'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_original_invoice_sale_purchase_null
      CHECK (
        type NOT IN ('sale', 'purchase')
        OR original_invoice_id IS NULL
      );
  END IF;
END $$;

-- Drop previous overload so PostgREST picks up the new signature
DROP FUNCTION IF EXISTS public.create_completed_invoice(
  text, jsonb, numeric, numeric, numeric, numeric, numeric, text, uuid, uuid, uuid, text, timestamptz
);

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
  p_original_invoice_id uuid DEFAULT NULL
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
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

  -- Returns must be linked to a completed source invoice
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
    COALESCE(p_created_at, NOW()),
    v_original_id
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
      invoice_id, product_id, quantity, unit_price, unit_cost, discount, total
    ) VALUES (
      v_invoice_id, v_product_id, v_qty, v_unit_price, v_unit_cost, v_discount, v_line_total
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
  text, jsonb, numeric, numeric, numeric, numeric, numeric, text, uuid, uuid, uuid, text, timestamptz, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_completed_invoice(
  text, jsonb, numeric, numeric, numeric, numeric, numeric, text, uuid, uuid, uuid, text, timestamptz, uuid
) TO authenticated;

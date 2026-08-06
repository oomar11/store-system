-- Keep workshop inbox snapshots in sync when store sales are edited.

ALTER TABLE public.workshop_invoice_inbox
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.enqueue_workshop_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_summary jsonb;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'الحساب غير مفعّل';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة';
  END IF;

  IF v_inv.type IS DISTINCT FROM 'sale' THEN
    RAISE EXCEPTION 'صندوق الورشة للفواتير البيع فقط';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', ii.product_id,
        'name', COALESCE(p.name, 'صنف'),
        'quantity', ii.quantity,
        'unit_price', ii.unit_price,
        'total', ii.total
      )
      ORDER BY ii.id
    ),
    '[]'::jsonb
  )
  INTO v_summary
  FROM public.invoice_items ii
  LEFT JOIN public.products p ON p.id = ii.product_id
  WHERE ii.invoice_id = p_invoice_id;

  INSERT INTO public.workshop_invoice_inbox (
    invoice_id,
    invoice_number,
    total,
    invoice_date,
    notes,
    items_summary,
    status,
    updated_at
  ) VALUES (
    v_inv.id,
    v_inv.invoice_number,
    COALESCE(v_inv.total, 0),
    COALESCE(v_inv.created_at, NOW()),
    v_inv.notes,
    v_summary,
    'pending',
    NOW()
  )
  ON CONFLICT (invoice_id) DO UPDATE
  SET
    invoice_number = EXCLUDED.invoice_number,
    total = EXCLUDED.total,
    invoice_date = EXCLUDED.invoice_date,
    notes = EXCLUDED.notes,
    items_summary = EXCLUDED.items_summary,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_workshop_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_workshop_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_workshop_invoice(uuid) TO service_role;

COMMENT ON FUNCTION public.enqueue_workshop_invoice(uuid) IS
  'Upsert workshop inbox snapshot; preserves status on edit (pending/assigned/dismissed)';

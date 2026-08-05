-- Inbox: store sale invoices flagged for workshop project expense assignment

CREATE TABLE IF NOT EXISTS public.workshop_invoice_inbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  invoice_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  items_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'assigned', 'dismissed')),
  assigned_project_key TEXT,
  assigned_project_name TEXT,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workshop_invoice_inbox_invoice_unique UNIQUE (invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_invoice_inbox_status
  ON public.workshop_invoice_inbox(status, created_at DESC);

ALTER TABLE public.workshop_invoice_inbox ENABLE ROW LEVEL SECURITY;

-- Authenticated staff can enqueue/read; workshop bridge uses service_role
DROP POLICY IF EXISTS "Authenticated read workshop inbox" ON public.workshop_invoice_inbox;
CREATE POLICY "Authenticated read workshop inbox"
  ON public.workshop_invoice_inbox FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated insert workshop inbox" ON public.workshop_invoice_inbox;
CREATE POLICY "Authenticated insert workshop inbox"
  ON public.workshop_invoice_inbox FOR INSERT TO authenticated
  WITH CHECK (true);

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
    status
  ) VALUES (
    v_inv.id,
    v_inv.invoice_number,
    COALESCE(v_inv.total, 0),
    COALESCE(v_inv.created_at, NOW()),
    v_inv.notes,
    v_summary,
    'pending'
  )
  ON CONFLICT (invoice_id) DO UPDATE
  SET
    invoice_number = EXCLUDED.invoice_number,
    total = EXCLUDED.total,
    invoice_date = EXCLUDED.invoice_date,
    notes = EXCLUDED.notes,
    items_summary = EXCLUDED.items_summary
  WHERE public.workshop_invoice_inbox.status = 'pending'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.workshop_invoice_inbox
    WHERE invoice_id = p_invoice_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_workshop_invoice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_workshop_invoice(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_workshop_invoice(uuid) TO service_role;

COMMENT ON TABLE public.workshop_invoice_inbox IS
  'Sale invoices flagged for workshop; assigned later to a UPVC project as expense';

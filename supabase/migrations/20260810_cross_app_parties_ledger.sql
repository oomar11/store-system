-- Cross-app parties + ledger: store is source of truth for customers/suppliers.
-- Workshops (aa / plisse) upsert parties and post AR lines via bridge (service_role).

-- -------------------------------------------------------------------------
-- Allow service_role to adjust party balances (called from bridge RPCs)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_customer_balance(
  p_id uuid,
  p_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF p_id IS NULL OR COALESCE(p_delta, 0) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.customers
  SET balance = COALESCE(balance, 0) + p_delta
  WHERE id = p_id;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows = 0 THEN
    RAISE EXCEPTION 'العميل غير موجود';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_supplier_balance(
  p_id uuid,
  p_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF p_id IS NULL OR COALESCE(p_delta, 0) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.suppliers
  SET balance = COALESCE(balance, 0) + p_delta
  WHERE id = p_id;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows = 0 THEN
    RAISE EXCEPTION 'المورد غير موجود';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_customer_balance(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_supplier_balance(uuid, numeric) TO service_role;

-- -------------------------------------------------------------------------
-- Phone normalize helper
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_party_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g'), '');
$$;

COMMENT ON FUNCTION public.normalize_party_phone(text) IS
  'Digits-only phone for cross-app party matching';

-- -------------------------------------------------------------------------
-- Optional denormalized phone for indexed lookup
-- -------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS phone_normalized text;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS phone_normalized text;

UPDATE public.customers
SET phone_normalized = public.normalize_party_phone(phone)
WHERE phone_normalized IS DISTINCT FROM public.normalize_party_phone(phone);

UPDATE public.suppliers
SET phone_normalized = public.normalize_party_phone(phone)
WHERE phone_normalized IS DISTINCT FROM public.normalize_party_phone(phone);

CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized
  ON public.customers (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

CREATE INDEX IF NOT EXISTS idx_suppliers_phone_normalized
  ON public.suppliers (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

CREATE OR REPLACE FUNCTION public.trg_sync_party_phone_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone_normalized := public.normalize_party_phone(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_phone_normalized ON public.customers;
CREATE TRIGGER customers_phone_normalized
  BEFORE INSERT OR UPDATE OF phone ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_party_phone_normalized();

DROP TRIGGER IF EXISTS suppliers_phone_normalized ON public.suppliers;
CREATE TRIGGER suppliers_phone_normalized
  BEFORE INSERT OR UPDATE OF phone ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_party_phone_normalized();

-- -------------------------------------------------------------------------
-- Map workshop local party ids → store party ids
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workshop_party_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system text NOT NULL CHECK (source_system IN ('aa', 'plisse')),
  local_party_id text NOT NULL,
  party_type text NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  store_party_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, party_type, local_party_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_party_map_store
  ON public.workshop_party_map (party_type, store_party_id);

ALTER TABLE public.workshop_party_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workshop_party_map_select ON public.workshop_party_map;
CREATE POLICY workshop_party_map_select ON public.workshop_party_map
  FOR SELECT TO authenticated
  USING (public.is_active_user());

-- service_role bypasses RLS

COMMENT ON TABLE public.workshop_party_map IS
  'Maps workshop-local customer/supplier ids to store parties';

-- -------------------------------------------------------------------------
-- Cross-app ledger (workshop sales/collections that are not POS stock invoices)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cross_app_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type text NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  party_id uuid NOT NULL,
  source_system text NOT NULL CHECK (source_system IN ('aa', 'plisse')),
  source_ref text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN (
    'workshop_sale',
    'workshop_collection',
    'workshop_adjustment',
    'workshop_void'
  )),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  project_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_cross_app_ledger_party_date
  ON public.cross_app_ledger_entries (party_type, party_id, occurred_at);

ALTER TABLE public.cross_app_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cross_app_ledger_select ON public.cross_app_ledger_entries;
CREATE POLICY cross_app_ledger_select ON public.cross_app_ledger_entries
  FOR SELECT TO authenticated
  USING (public.is_active_user());

COMMENT ON TABLE public.cross_app_ledger_entries IS
  'Workshop AR/AP lines mirrored into store for unified party statements';

-- Balance delta: debit increases party balance, credit decreases.
CREATE OR REPLACE FUNCTION public.apply_cross_app_ledger_entry(
  p_source_system text,
  p_source_ref text,
  p_party_type text,
  p_party_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_direction text,
  p_occurred_at timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_project_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_system text := lower(trim(COALESCE(p_source_system, '')));
  v_ref text := trim(COALESCE(p_source_ref, ''));
  v_party_type text := lower(trim(COALESCE(p_party_type, '')));
  v_entry_type text := lower(trim(COALESCE(p_entry_type, '')));
  v_direction text := lower(trim(COALESCE(p_direction, '')));
  v_amount numeric := GREATEST(0, COALESCE(p_amount, 0));
  v_occurred timestamptz := COALESCE(p_occurred_at, NOW());
  v_existing public.cross_app_ledger_entries%ROWTYPE;
  v_old_signed numeric := 0;
  v_new_signed numeric := 0;
  v_delta numeric := 0;
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح — جسر الورشة فقط';
  END IF;

  IF v_system NOT IN ('aa', 'plisse') THEN
    RAISE EXCEPTION 'source_system غير صالح';
  END IF;
  IF v_ref = '' THEN
    RAISE EXCEPTION 'source_ref مطلوب';
  END IF;
  IF v_party_type NOT IN ('customer', 'supplier') THEN
    RAISE EXCEPTION 'party_type غير صالح';
  END IF;
  IF p_party_id IS NULL THEN
    RAISE EXCEPTION 'party_id مطلوب';
  END IF;
  IF v_entry_type NOT IN (
    'workshop_sale', 'workshop_collection', 'workshop_adjustment', 'workshop_void'
  ) THEN
    RAISE EXCEPTION 'entry_type غير صالح';
  END IF;
  IF v_direction NOT IN ('debit', 'credit') THEN
    RAISE EXCEPTION 'direction غير صالح';
  END IF;

  IF v_party_type = 'customer' THEN
    IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_party_id) THEN
      RAISE EXCEPTION 'العميل غير موجود';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_party_id) THEN
      RAISE EXCEPTION 'المورد غير موجود';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.cross_app_ledger_entries
  WHERE source_system = v_system AND source_ref = v_ref
  FOR UPDATE;

  IF FOUND THEN
    v_old_signed := CASE
      WHEN v_existing.direction = 'debit' THEN v_existing.amount
      ELSE -v_existing.amount
    END;
  END IF;

  -- amount 0 or void → remove effect
  IF v_amount < 0.0005 OR v_entry_type = 'workshop_void' THEN
    v_new_signed := 0;
    IF FOUND THEN
      DELETE FROM public.cross_app_ledger_entries WHERE id = v_existing.id;
      v_id := v_existing.id;
    ELSE
      v_id := NULL;
    END IF;
  ELSE
    v_new_signed := CASE WHEN v_direction = 'debit' THEN v_amount ELSE -v_amount END;
    IF FOUND THEN
      UPDATE public.cross_app_ledger_entries
      SET
        party_type = v_party_type,
        party_id = p_party_id,
        entry_type = v_entry_type,
        amount = v_amount,
        direction = v_direction,
        occurred_at = v_occurred,
        notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
        project_label = NULLIF(trim(COALESCE(p_project_label, '')), ''),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.cross_app_ledger_entries (
        party_type, party_id, source_system, source_ref, entry_type,
        amount, direction, occurred_at, notes, project_label
      ) VALUES (
        v_party_type, p_party_id, v_system, v_ref, v_entry_type,
        v_amount, v_direction, v_occurred,
        NULLIF(trim(COALESCE(p_notes, '')), ''),
        NULLIF(trim(COALESCE(p_project_label, '')), '')
      )
      RETURNING id INTO v_id;
    END IF;
  END IF;

  v_delta := v_new_signed - v_old_signed;

  IF ABS(v_delta) >= 0.0005 THEN
    IF v_party_type = 'customer' THEN
      PERFORM public.adjust_customer_balance(p_party_id, v_delta);
    ELSE
      PERFORM public.adjust_supplier_balance(p_party_id, v_delta);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'delta', v_delta,
    'amount', v_amount,
    'direction', v_direction,
    'voided', (v_amount < 0.0005 OR v_entry_type = 'workshop_void')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_cross_app_ledger_entry(
  text, text, text, uuid, text, numeric, text, timestamptz, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_cross_app_ledger_entry(
  text, text, text, uuid, text, numeric, text, timestamptz, text, text
) TO service_role;

-- -------------------------------------------------------------------------
-- System product for external workshop purchases (AP only; no meaningful stock)
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_cat uuid;
  v_sku text := 'WORKSHOP-EXTERNAL-SUPPLY';
BEGIN
  SELECT id INTO v_cat FROM public.categories ORDER BY created_at ASC LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO public.categories (name, description)
    VALUES ('عام', 'تصنيف افتراضي')
    RETURNING id INTO v_cat;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE sku = v_sku) THEN
    INSERT INTO public.products (
      name, sku, category_id, unit, buy_price, sell_price,
      quantity, min_quantity, is_active, description, notify_low_stock
    ) VALUES (
      'توريد خارجي — ورشة',
      v_sku,
      v_cat,
      'عملية',
      0, 0, 0, 0, true,
      'صنف نظامي لفواتير توريد الورش من خارج المحل (بدون تتبع مخزون فعلي)',
      false
    );
  END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- External workshop purchase → store purchase invoice + supplier AP
-- Skips stock movement on the system product.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_workshop_external_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_subtotal numeric,
  p_total numeric,
  p_paid_amount numeric DEFAULT 0,
  p_safe_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_at timestamptz DEFAULT NULL,
  p_source_system text DEFAULT 'aa',
  p_source_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier uuid := p_supplier_id;
  v_paid numeric := GREATEST(0, COALESCE(p_paid_amount, 0));
  v_total numeric := GREATEST(0, COALESCE(p_total, 0));
  v_subtotal numeric := GREATEST(0, COALESCE(p_subtotal, v_total));
  v_remaining numeric;
  v_occurred timestamptz := COALESCE(p_created_at, NOW());
  v_system text := lower(trim(COALESCE(p_source_system, 'aa')));
  v_ref text := NULLIF(trim(COALESCE(p_source_ref, '')), '');
  v_product_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_line jsonb;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_item_count integer := 0;
  v_notes text;
  v_result jsonb;
  v_ref_uuid uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'غير مصرح — جسر الورشة فقط';
  END IF;

  IF v_system NOT IN ('aa', 'plisse') THEN
    RAISE EXCEPTION 'source_system غير صالح';
  END IF;

  IF v_supplier IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.suppliers WHERE id = v_supplier
  ) THEN
    RAISE EXCEPTION 'المورد مطلوب';
  END IF;

  -- Idempotent by source_ref via notes marker / prior invoice lookup
  IF v_ref IS NOT NULL THEN
    SELECT id, invoice_number INTO v_invoice_id, v_invoice_number
    FROM public.invoices
    WHERE type = 'purchase'
      AND status = 'completed'
      AND notes LIKE '%[workshop_purchase:' || v_system || ':' || v_ref || ']%'
    LIMIT 1;
    IF v_invoice_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'idempotent', true
      );
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'بنود التوريد مطلوبة';
  END IF;

  IF v_paid > v_total + 0.001 THEN
    RAISE EXCEPTION 'المبلغ المدفوع أكبر من الإجمالي';
  END IF;

  IF v_paid > 0 AND p_safe_id IS NULL THEN
    RAISE EXCEPTION 'الرجاء تحديد الخزنة عند الدفع النقدي';
  END IF;

  SELECT id INTO v_product_id
  FROM public.products
  WHERE sku = 'WORKSHOP-EXTERNAL-SUPPLY'
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'صنف التوريد الخارجي غير موجود';
  END IF;

  v_remaining := GREATEST(0, v_total - v_paid);
  v_invoice_number := public.next_document_number('purchase', v_occurred);

  v_notes := NULLIF(trim(COALESCE(p_notes, '')), '');
  IF v_ref IS NOT NULL THEN
    v_notes := CASE
      WHEN v_notes IS NULL OR v_notes = '' THEN
        '[workshop_purchase:' || v_system || ':' || v_ref || ']'
      ELSE
        v_notes || E'\n' || '[workshop_purchase:' || v_system || ':' || v_ref || ']'
    END;
  END IF;

  INSERT INTO public.invoices (
    invoice_number, type, status, supplier_id,
    subtotal, tax_amount, discount_amount, total, paid_amount,
    payment_method, safe_id, notes, created_at
  ) VALUES (
    v_invoice_number, 'purchase', 'completed', v_supplier,
    v_subtotal, 0, 0, v_total, v_paid,
    CASE WHEN v_paid >= v_total - 0.001 THEN 'cash' ELSE 'credit' END,
    CASE WHEN v_paid > 0 THEN p_safe_id ELSE NULL END,
    v_notes, v_occurred
  )
  RETURNING id INTO v_invoice_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := GREATEST(0, COALESCE((v_line->>'quantity')::numeric, 0));
    v_unit_price := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_line_total := COALESCE(
      (v_line->>'total')::numeric,
      v_qty * v_unit_price
    );
    IF v_qty <= 0 AND v_line_total <= 0 THEN
      CONTINUE;
    END IF;
    IF v_qty <= 0 THEN
      v_qty := 1;
      v_unit_price := v_line_total;
    END IF;

    INSERT INTO public.invoice_items (
      invoice_id, product_id, quantity, unit_price, unit_cost, discount, total
    ) VALUES (
      v_invoice_id,
      v_product_id,
      v_qty,
      v_unit_price,
      v_unit_price,
      0,
      v_line_total
    );
    -- Append line description into notes for statement clarity
    IF NULLIF(trim(COALESCE(v_line->>'description', v_line->>'name', '')), '') IS NOT NULL THEN
      UPDATE public.invoices
      SET notes = trim(both E'\n' FROM COALESCE(notes, '') || E'\n' ||
        ('• ' || trim(COALESCE(v_line->>'description', v_line->>'name', '')) ||
         ' × ' || v_qty::text || ' = ' || round(v_line_total, 2)::text))
      WHERE id = v_invoice_id;
    END IF;

    v_item_count := v_item_count + 1;
  END LOOP;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'بنود التوريد مطلوبة';
  END IF;

  IF v_remaining > 0 THEN
    PERFORM public.adjust_supplier_balance(v_supplier, v_remaining);
  END IF;

  IF v_paid > 0 THEN
    v_ref_uuid := gen_random_uuid();
    PERFORM public.apply_workshop_safe_movement(
      p_safe_id,
      'withdrawal',
      v_paid,
      'توريد ورشة ' || v_invoice_number,
      'workshop_purchase',
      v_ref_uuid,
      COALESCE(v_notes, 'workshop_purchase'),
      v_occurred
    );
  END IF;

  UPDATE public.suppliers
  SET last_activity_at = v_occurred
  WHERE id = v_supplier;

  v_result := jsonb_build_object(
    'id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'idempotent', false
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workshop_external_purchase(
  uuid, jsonb, numeric, numeric, numeric, uuid, text, timestamptz, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workshop_external_purchase(
  uuid, jsonb, numeric, numeric, numeric, uuid, text, timestamptz, text, text
) TO service_role;

-- Allow workshop_purchase reference type on safe bridge (prefix workshop_)
-- already allowed by LIKE 'workshop_%'

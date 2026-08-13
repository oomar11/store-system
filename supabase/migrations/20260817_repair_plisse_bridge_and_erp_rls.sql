-- 1) Lock leftover ERP import tables (unused by the app; anon was fully exposed).
-- 2) Disable fetch_service_role_key Data API leak (do NOT rotate the live bridge secret).
-- 3) Backfill plisse customers + sales/collections onto the store ledger (idempotent).

-- ---------------------------------------------------------------------------
-- ERP RLS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'erp_vouchers',
    'erp_transactions',
    'erp_expenses',
    'erp_products',
    'erp_clients',
    'erp_suppliers',
    'erp_treasuries',
    'erp_cash_drawer'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Never expose service_role via RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fetch_service_role_key(proof text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_service_role_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fetch_service_role_key(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fetch_service_role_key(text) TO service_role;

-- ---------------------------------------------------------------------------
-- Plisse → store party map + ledger (AR only; cash stays on the next workshop sync)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cust record;
  inv record;
  pay record;
  v_store uuid;
  v_digits text;
  v_last9 text;
  v_details jsonb;
  v_n integer;
BEGIN
  IF to_regclass('public.pls_customers') IS NULL THEN
    RETURN;
  END IF;

  FOR cust IN
    SELECT id, name, phone, notes, store_customer_id
    FROM public.pls_customers
  LOOP
    v_store := cust.store_customer_id;
    v_digits := regexp_replace(COALESCE(cust.phone, ''), '\D', '', 'g');

    IF v_store IS NULL AND length(v_digits) >= 9 THEN
      v_last9 := right(v_digits, 9);
      SELECT cu.id
      INTO v_store
      FROM public.customers cu
      WHERE cu.is_active = true
        AND length(regexp_replace(COALESCE(cu.phone_normalized, cu.phone, ''), '\D', '', 'g')) >= 9
        AND right(
          regexp_replace(COALESCE(cu.phone_normalized, cu.phone, ''), '\D', '', 'g'),
          9
        ) = v_last9
      LIMIT 1;
    END IF;

    IF v_store IS NULL THEN
      INSERT INTO public.customers (
        name, phone, phone_normalized, notes, balance, opening_balance, is_active
      ) VALUES (
        NULLIF(trim(cust.name), ''),
        NULLIF(trim(COALESCE(cust.phone, '')), ''),
        NULLIF(v_digits, ''),
        NULLIF(trim(COALESCE(cust.notes, '')), ''),
        0,
        0,
        true
      )
      RETURNING id INTO v_store;
    END IF;

    UPDATE public.pls_customers
    SET store_customer_id = v_store
    WHERE id = cust.id
      AND store_customer_id IS DISTINCT FROM v_store;

    INSERT INTO public.workshop_party_map (
      source_system, party_type, local_party_id, store_party_id, updated_at
    ) VALUES (
      'plisse', 'customer', cust.id::text, v_store, NOW()
    )
    ON CONFLICT (source_system, party_type, local_party_id)
    DO UPDATE SET
      store_party_id = EXCLUDED.store_party_id,
      updated_at = NOW();
  END LOOP;

  FOR inv IN
    SELECT
      i.id,
      i.invoice_number,
      i.total,
      i.created_at,
      i.notes,
      pc.store_customer_id,
      pc.name AS customer_name,
      pc.id AS local_party_id
    FROM public.pls_invoices i
    JOIN public.pls_customers pc ON pc.id = i.customer_id
    WHERE i.status IS DISTINCT FROM 'cancelled'
      AND pc.store_customer_id IS NOT NULL
      AND COALESCE(i.total, 0) > 0
  LOOP
    SELECT jsonb_build_object(
      'kind', 'plisse_invoice',
      'invoice_id', inv.id,
      'invoice_number', inv.invoice_number,
      'local_party_id', inv.local_party_id,
      'customer_id', inv.local_party_id,
      'lines', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_name', ii.product_name,
            'system_label', ii.system_label,
            'handles_label', ii.handles_label,
            'closure_label', ii.closure_label,
            'length_m', ii.length_m,
            'width_m', ii.width_m,
            'area_m2', ii.area_m2,
            'unit_price', ii.unit_price,
            'line_total', ii.line_total,
            'notes', ii.notes
          )
        )
        FROM public.pls_invoice_items ii
        WHERE ii.invoice_id = inv.id
      ), '[]'::jsonb)
    )
    INTO v_details;

    INSERT INTO public.cross_app_ledger_entries (
      party_type, party_id, source_system, source_ref, entry_type,
      amount, direction, occurred_at, notes, project_label, details
    )
    VALUES (
      'customer',
      inv.store_customer_id,
      'plisse',
      'inv:' || inv.id::text,
      'workshop_sale',
      inv.total,
      'debit',
      inv.created_at,
      NULLIF(trim(COALESCE(inv.notes, '')), ''),
      inv.customer_name,
      v_details
    )
    ON CONFLICT (source_system, source_ref) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n > 0 THEN
      UPDATE public.customers
      SET balance = COALESCE(balance, 0) + inv.total
      WHERE id = inv.store_customer_id;
    END IF;
  END LOOP;

  FOR pay IN
    SELECT
      p.id,
      p.amount,
      p.created_at,
      p.note,
      i.id AS invoice_id,
      pc.store_customer_id,
      pc.name AS customer_name,
      pc.id AS local_party_id
    FROM public.pls_payments p
    JOIN public.pls_invoices i ON i.id = p.invoice_id
    JOIN public.pls_customers pc ON pc.id = i.customer_id
    WHERE i.status IS DISTINCT FROM 'cancelled'
      AND pc.store_customer_id IS NOT NULL
      AND COALESCE(p.amount, 0) > 0
  LOOP
    INSERT INTO public.cross_app_ledger_entries (
      party_type, party_id, source_system, source_ref, entry_type,
      amount, direction, occurred_at, notes, project_label, details
    )
    VALUES (
      'customer',
      pay.store_customer_id,
      'plisse',
      'pay:' || pay.id::text,
      'workshop_collection',
      pay.amount,
      'credit',
      pay.created_at,
      NULLIF(trim(COALESCE(pay.note, '')), ''),
      pay.customer_name,
      jsonb_build_object(
        'kind', 'plisse_payment',
        'payment_id', pay.id,
        'invoice_id', pay.invoice_id,
        'local_party_id', pay.local_party_id,
        'customer_id', pay.local_party_id
      )
    )
    ON CONFLICT (source_system, source_ref) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n > 0 THEN
      UPDATE public.customers
      SET balance = COALESCE(balance, 0) - pay.amount
      WHERE id = pay.store_customer_id;
    END IF;
  END LOOP;

  -- Tag linked plisse parties as wire (keep existing lines)
  UPDATE public.customers cu
  SET business_lines = (
    SELECT ARRAY(
      SELECT DISTINCT x
      FROM unnest(
        COALESCE(cu.business_lines, '{}'::text[]) || ARRAY['wire']::text[]
      ) AS x
      ORDER BY x
    )
  )
  WHERE cu.business_lines_locked = false
    AND EXISTS (
      SELECT 1
      FROM public.workshop_party_map m
      WHERE m.store_party_id = cu.id
        AND m.party_type = 'customer'
        AND m.source_system = 'plisse'
    );
END $$;

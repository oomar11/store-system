-- Store workshop invoice line details (dims, products, prices) on cross-app ledger.

ALTER TABLE public.cross_app_ledger_entries
  ADD COLUMN IF NOT EXISTS details jsonb;

COMMENT ON COLUMN public.cross_app_ledger_entries.details IS
  'Optional workshop line payload (e.g. plisse door dims/products) for party account UI';

-- Replace RPC: drop old 10-arg signature, create 11-arg with p_details.
DROP FUNCTION IF EXISTS public.apply_cross_app_ledger_entry(
  text, text, text, uuid, text, numeric, text, timestamptz, text, text
);

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
  p_project_label text DEFAULT NULL,
  p_details jsonb DEFAULT NULL
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
        details = COALESCE(p_details, details),
        updated_at = NOW()
      WHERE id = v_existing.id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.cross_app_ledger_entries (
        party_type, party_id, source_system, source_ref, entry_type,
        amount, direction, occurred_at, notes, project_label, details
      ) VALUES (
        v_party_type, p_party_id, v_system, v_ref, v_entry_type,
        v_amount, v_direction, v_occurred,
        NULLIF(trim(COALESCE(p_notes, '')), ''),
        NULLIF(trim(COALESCE(p_project_label, '')), ''),
        p_details
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
  text, text, text, uuid, text, numeric, text, timestamptz, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_cross_app_ledger_entry(
  text, text, text, uuid, text, numeric, text, timestamptz, text, text, jsonb
) TO service_role;

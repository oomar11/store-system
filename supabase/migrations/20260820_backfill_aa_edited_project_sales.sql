-- Backfill PVC job prices that were edited before live store sync.
-- Updates existing sale:{projectId} rows to the billed PVC amount
-- (agreedSale or sticker totals) and posts مهند شقة which never landed
-- because c-14 was pointing at the wrong store customer (عمر عاطف).
-- Does not invent cash — AR ledger + customer.balance only.

-- 1) مهند (PVC c-14) — create a real store customer, map, sale, collection.
DO $$
DECLARE
  v_party uuid;
  v_inserted integer;
BEGIN
  SELECT m.store_party_id INTO v_party
  FROM public.workshop_party_map m
  WHERE m.source_system = 'aa'
    AND m.party_type = 'customer'
    AND m.local_party_id = 'c-14'
  LIMIT 1;

  IF v_party IS NULL THEN
    INSERT INTO public.customers (
      name, phone, notes, balance, opening_balance, is_active, business_lines
    )
    VALUES (
      'مهند',
      NULL,
      'من ورشة PVC — شغلانة شقة',
      0,
      0,
      true,
      ARRAY['workshop']::text[]
    )
    RETURNING id INTO v_party;

    INSERT INTO public.workshop_party_map (
      source_system, local_party_id, party_type, store_party_id
    )
    VALUES ('aa', 'c-14', 'customer', v_party);
  END IF;

  INSERT INTO public.cross_app_ledger_entries (
    party_type, party_id, source_system, source_ref, entry_type,
    amount, direction, occurred_at, notes, project_label, details
  )
  SELECT
    'customer', v_party, 'aa', 'sale:p-18', 'workshop_sale',
    67353.59, 'debit', '2026-05-11T12:00:00Z'::timestamptz,
    'بيع مشروع شقة', 'شقة',
    jsonb_build_object(
      'kind', 'aa_project_sale',
      'project_id', 'p-18',
      'local_party_id', 'c-14',
      'backfill', true
    )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.cross_app_ledger_entries e
    WHERE e.source_system = 'aa' AND e.source_ref = 'sale:p-18'
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted > 0 THEN
    UPDATE public.customers
    SET balance = COALESCE(balance, 0) + 67353.59
    WHERE id = v_party;
  END IF;

  INSERT INTO public.cross_app_ledger_entries (
    party_type, party_id, source_system, source_ref, entry_type,
    amount, direction, occurred_at, notes, project_label, details
  )
  SELECT
    'customer', v_party, 'aa', 'pay:pay-46', 'workshop_collection',
    40000, 'credit', '2026-05-11T12:00:00Z'::timestamptz,
    'اتفاق / مقدمة', 'شقة',
    jsonb_build_object(
      'kind', 'aa_payment',
      'project_id', 'p-18',
      'payment_id', 'pay-46',
      'local_party_id', 'c-14',
      'backfill', true
    )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.cross_app_ledger_entries e
    WHERE e.source_system = 'aa' AND e.source_ref = 'pay:pay-46'
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted > 0 THEN
    UPDATE public.customers
    SET balance = COALESCE(balance, 0) - 40000
    WHERE id = v_party;
  END IF;
END $$;

-- 2) Align previously posted PVC sales with current billed totals.
-- sale:p-37 is a quote that should not sit on عبدالله الطباخ.
DO $$
DECLARE
  r record;
  e public.cross_app_ledger_entries%ROWTYPE;
  v_delta numeric;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('sale:p-19', 84605.39::numeric),
      ('sale:local-p-1785928928975', 25414.55),
      ('sale:p-6', 16100.35),
      ('sale:p-4', 28979.65),
      ('sale:p-33', 60912.88),
      ('sale:p-13', 18988.80),
      ('sale:p-25', 7486.25),
      ('sale:p-31', 20072.12),
      ('sale:p-8', 24920.60),
      ('sale:p-15', 34360.68),
      ('sale:p-22', 16014.08),
      ('sale:p-24', 42845.00),
      ('sale:p-37', 0)
    ) AS t(source_ref, new_amount)
  LOOP
    SELECT * INTO e
    FROM public.cross_app_ledger_entries
    WHERE source_system = 'aa' AND source_ref = r.source_ref
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_delta := r.new_amount - e.amount;
    IF ABS(v_delta) < 0.005 THEN
      CONTINUE;
    END IF;

    UPDATE public.cross_app_ledger_entries
    SET
      amount = r.new_amount,
      entry_type = CASE
        WHEN r.new_amount = 0 THEN 'workshop_void'
        ELSE 'workshop_sale'
      END,
      notes = CASE
        WHEN r.new_amount = 0 THEN 'إلغاء مقايسة ' || COALESCE(e.project_label, '')
        ELSE e.notes
      END,
      details = COALESCE(e.details, '{}'::jsonb) || jsonb_build_object(
        'billed_backfill', true,
        'previous_amount', e.amount
      ),
      updated_at = NOW()
    WHERE id = e.id;

    IF e.party_type = 'customer' THEN
      UPDATE public.customers
      SET balance = COALESCE(balance, 0) + v_delta
      WHERE id = e.party_id;
    END IF;
  END LOOP;
END $$;

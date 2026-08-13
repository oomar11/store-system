-- PVC job «شقة هشام» (sale:p-15) was posted at computed sale 29506.02
-- while collections on that same job are 32000. The 2493.98 credit was
-- reducing remaining on the open job «30/7» (10061.77 − 5000 = 5061.77)
-- so the store current balance showed 2567.79 instead of 5061.77.
-- Floor that sale posting to the collections on the same project.

DO $$
DECLARE
  r public.cross_app_ledger_entries%ROWTYPE;
  v_paid numeric;
  v_new numeric;
  v_delta numeric;
BEGIN
  SELECT * INTO r
  FROM public.cross_app_ledger_entries
  WHERE source_system = 'aa' AND source_ref = 'sale:p-15'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'sale:p-15 not found, skip';
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.cross_app_ledger_entries
  WHERE source_system = 'aa'
    AND party_type = r.party_type
    AND party_id = r.party_id
    AND entry_type = 'workshop_collection'
    AND project_label IS NOT DISTINCT FROM r.project_label;

  v_new := GREATEST(r.amount, v_paid);
  v_delta := v_new - r.amount;
  IF ABS(v_delta) < 0.005 THEN
    RETURN;
  END IF;

  UPDATE public.cross_app_ledger_entries
  SET
    amount = v_new,
    details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
      'computed_sale', r.amount,
      'paid_on_project', v_paid,
      'ledger_floor_to_paid', true
    ),
    updated_at = NOW()
  WHERE id = r.id;

  IF r.party_type = 'customer' THEN
    UPDATE public.customers
    SET balance = COALESCE(balance, 0) + v_delta
    WHERE id = r.party_id;
  END IF;
END $$;

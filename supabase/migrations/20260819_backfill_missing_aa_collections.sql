-- PVC payments that hit the store SAFE but never posted to the customer ledger.
-- Locate the customer from an existing sibling ledger row on the same job.

DO $$
DECLARE
  r record;
  v_party uuid;
  v_inserted integer;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('pay:pay-1786524358218', 'pay:pay-77', 11400::numeric, 'زهور', '2026-08-12T12:00:00Z'::timestamptz),
      ('pay:pay-1786548614552', 'pay:pay-92', 20000::numeric, 'كرافت ابيض', '2026-08-12T12:00:00Z'::timestamptz),
      ('pay:pay-1786285351865', 'pay:pay-1785931830588', 1500::numeric, 'باب كومبن مستعجل', '2026-08-09T12:00:00Z'::timestamptz),
      ('pay:pay-1785956799372', 'sale:local-p-1785928928975', 2000::numeric, 'مطوبس', '2026-08-05T12:00:00Z'::timestamptz),
      ('pay:pay-1786463419907', 'pay:pay-1786201609940', 2000::numeric, 'باب شطر', '2026-08-11T12:00:00Z'::timestamptz),
      ('pay:pay-1786463437073', 'pay:pay-1786201609940', 2000::numeric, 'باب شطر', '2026-08-11T12:00:00Z'::timestamptz)
    ) AS t(source_ref, sibling_ref, amount, project_label, occurred_at)
  LOOP
    SELECT e.party_id INTO v_party
    FROM public.cross_app_ledger_entries e
    WHERE e.source_system = 'aa' AND e.source_ref = r.sibling_ref
    LIMIT 1;

    IF v_party IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.cross_app_ledger_entries (
      party_type, party_id, source_system, source_ref, entry_type,
      amount, direction, occurred_at, notes, project_label, details
    )
    SELECT
      'customer', v_party, 'aa', r.source_ref, 'workshop_collection',
      r.amount, 'credit', r.occurred_at, 'دفعة ورشة — ترحيل كشف حساب',
      r.project_label,
      jsonb_build_object('kind', 'aa_payment', 'backfill', true)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.cross_app_ledger_entries e
      WHERE e.source_system = 'aa' AND e.source_ref = r.source_ref
    );

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted > 0 THEN
      UPDATE public.customers
      SET balance = COALESCE(balance, 0) - r.amount
      WHERE id = v_party;
    END IF;
  END LOOP;
END $$;

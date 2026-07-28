-- =========================================================================
-- Paged bootstrap (1 year history) + extra sync metadata tables
-- =========================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','journal_entries','journal_lines','safe_transactions',
    'party_payment_allocations','document_items','inventory_count_items','audit_logs'
  ]
  LOOP
    -- profiles uses id from auth.users; still add sync cols if missing
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1', t);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', t);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS last_hlc_physical_ms BIGINT NOT NULL DEFAULT 0', t);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS last_hlc_counter INTEGER NOT NULL DEFAULT 0', t);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS last_hlc_device_id UUID', t);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', t);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END LOOP;
END $$;

-- Attach change-feed triggers for new tables (skip child tables without stable upsert needs)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','journal_entries','safe_transactions','audit_logs'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_change_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_sync_change_%I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.trg_emit_entity_change()',
      t, t
    );
  END LOOP;
END $$;

-- Catalog of bootstrap entities: full = all rows; year = last 365 days
CREATE OR REPLACE FUNCTION public.sync_bootstrap_entities()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('entity', 'profiles', 'mode', 'full'),
    jsonb_build_object('entity', 'categories', 'mode', 'full'),
    jsonb_build_object('entity', 'products', 'mode', 'full'),
    jsonb_build_object('entity', 'customers', 'mode', 'full'),
    jsonb_build_object('entity', 'suppliers', 'mode', 'full'),
    jsonb_build_object('entity', 'safes', 'mode', 'full'),
    jsonb_build_object('entity', 'settings', 'mode', 'full'),
    jsonb_build_object('entity', 'accounts', 'mode', 'full'),
    jsonb_build_object('entity', 'price_tiers', 'mode', 'full'),
    jsonb_build_object('entity', 'product_tier_prices', 'mode', 'full'),
    jsonb_build_object('entity', 'tier_category_discounts', 'mode', 'full'),
    jsonb_build_object('entity', 'tier_product_discounts', 'mode', 'full'),
    jsonb_build_object('entity', 'documents', 'mode', 'year'),
    jsonb_build_object('entity', 'document_items', 'mode', 'year'),
    jsonb_build_object('entity', 'invoices', 'mode', 'year'),
    jsonb_build_object('entity', 'invoice_items', 'mode', 'year'),
    jsonb_build_object('entity', 'party_payments', 'mode', 'year'),
    jsonb_build_object('entity', 'party_payment_allocations', 'mode', 'year'),
    jsonb_build_object('entity', 'journal_entries', 'mode', 'year'),
    jsonb_build_object('entity', 'journal_lines', 'mode', 'year'),
    jsonb_build_object('entity', 'safe_transactions', 'mode', 'year'),
    jsonb_build_object('entity', 'shifts', 'mode', 'year'),
    jsonb_build_object('entity', 'inventory_counts', 'mode', 'year'),
    jsonb_build_object('entity', 'inventory_count_items', 'mode', 'year'),
    jsonb_build_object('entity', 'audit_logs', 'mode', 'year')
  );
$$;

REVOKE ALL ON FUNCTION public.sync_bootstrap_entities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_bootstrap_entities() TO authenticated;

-- Paged bootstrap: returns rows + next_cursor + has_more
CREATE OR REPLACE FUNCTION public.sync_bootstrap_page(
  p_entity text,
  p_since timestamptz DEFAULT (NOW() - INTERVAL '365 days'),
  p_cursor text DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity text := lower(trim(p_entity));
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 500), 1000));
  v_since timestamptz := COALESCE(p_since, NOW() - INTERVAL '365 days');
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_last_ts timestamptz;
  v_last_id uuid;
  v_has_more boolean := false;
  v_seq BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF p_cursor IS NOT NULL AND position('|' in p_cursor) > 0 THEN
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_id := NULLIF(split_part(p_cursor, '|', 2), '')::uuid;
  END IF;

  IF v_entity = 'profiles' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT * FROM public.profiles p
      WHERE p.deleted_at IS NULL
        AND (
          v_cursor_ts IS NULL
          OR (p.created_at, p.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid))
        )
      ORDER BY p.created_at, p.id
      LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'categories' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.categories c
      WHERE c.deleted_at IS NULL
        AND (v_cursor_ts IS NULL OR (c.created_at, c.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY c.created_at, c.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'products' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.products p
      WHERE p.deleted_at IS NULL
        AND (v_cursor_ts IS NULL OR (p.created_at, p.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY p.created_at, p.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'customers' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.customers c
      WHERE c.deleted_at IS NULL
        AND (v_cursor_ts IS NULL OR (c.created_at, c.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY c.created_at, c.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'suppliers' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.suppliers s
      WHERE s.deleted_at IS NULL
        AND (v_cursor_ts IS NULL OR (s.created_at, s.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY s.created_at, s.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'safes' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.safes s
      WHERE s.deleted_at IS NULL
        AND (v_cursor_ts IS NULL OR (s.created_at, s.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY s.created_at, s.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'settings' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.settings s
      WHERE s.deleted_at IS NULL
      ORDER BY s.created_at, s.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'accounts' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.accounts a
      WHERE a.deleted_at IS NULL
        AND (v_cursor_ts IS NULL OR (a.created_at, a.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY a.created_at, a.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'price_tiers' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.price_tiers t
      WHERE t.deleted_at IS NULL
        AND (v_cursor_ts IS NULL OR (t.created_at, t.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY t.created_at, t.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'product_tier_prices' THEN
    -- composite key: synthesize cursor on (product_id, tier_id) via created order of product_id text
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*)), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT *, (product_id::text || tier_id::text) AS _cid FROM public.product_tier_prices t
      WHERE (p_cursor IS NULL OR (t.product_id::text || t.tier_id::text) > p_cursor)
      ORDER BY t.product_id, t.tier_id
      LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'tier_category_discounts' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*)), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.tier_category_discounts t
      WHERE (p_cursor IS NULL OR (t.tier_id::text || t.category_id::text) > p_cursor)
      ORDER BY t.tier_id, t.category_id
      LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'tier_product_discounts' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*)), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.tier_product_discounts t
      WHERE (p_cursor IS NULL OR (t.tier_id::text || t.product_id::text) > p_cursor)
      ORDER BY t.tier_id, t.product_id
      LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'invoices' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.invoices i
      WHERE i.deleted_at IS NULL
        AND i.created_at >= v_since
        AND (v_cursor_ts IS NULL OR (i.created_at, i.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY i.created_at, i.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'invoice_items' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT ii.* FROM public.invoice_items ii
      JOIN public.invoices i ON i.id = ii.invoice_id
      WHERE i.deleted_at IS NULL
        AND i.created_at >= v_since
        AND (v_cursor_id IS NULL OR ii.id > v_cursor_id)
      ORDER BY ii.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'documents' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.documents d
      WHERE d.deleted_at IS NULL
        AND d.created_at >= v_since
        AND (v_cursor_ts IS NULL OR (d.created_at, d.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY d.created_at, d.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'document_items' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT di.* FROM public.document_items di
      JOIN public.documents d ON d.id = di.document_id
      WHERE d.deleted_at IS NULL
        AND d.created_at >= v_since
        AND (v_cursor_id IS NULL OR di.id > v_cursor_id)
      ORDER BY di.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'party_payments' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.party_payments p
      WHERE p.deleted_at IS NULL
        AND p.created_at >= v_since
        AND (v_cursor_ts IS NULL OR (p.created_at, p.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY p.created_at, p.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'party_payment_allocations' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT a.* FROM public.party_payment_allocations a
      JOIN public.party_payments p ON p.id = a.payment_id
      WHERE p.deleted_at IS NULL
        AND p.created_at >= v_since
        AND (v_cursor_id IS NULL OR a.id > v_cursor_id)
      ORDER BY a.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'journal_entries' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.journal_entries j
      WHERE j.deleted_at IS NULL
        AND j.created_at >= v_since
        AND (v_cursor_ts IS NULL OR (j.created_at, j.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY j.created_at, j.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'journal_lines' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT jl.* FROM public.journal_lines jl
      JOIN public.journal_entries j ON j.id = jl.entry_id
      WHERE j.deleted_at IS NULL
        AND j.created_at >= v_since
        AND (v_cursor_id IS NULL OR jl.id > v_cursor_id)
      ORDER BY jl.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'safe_transactions' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.safe_transactions s
      WHERE s.deleted_at IS NULL
        AND s.created_at >= v_since
        AND (v_cursor_ts IS NULL OR (s.created_at, s.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY s.created_at, s.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'shifts' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.opened_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.shifts s
      WHERE s.deleted_at IS NULL
        AND COALESCE(s.opened_at, s.created_at) >= v_since
        AND (v_cursor_ts IS NULL OR (COALESCE(s.opened_at, s.created_at), s.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY COALESCE(s.opened_at, s.created_at), s.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'inventory_counts' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.inventory_counts c
      WHERE c.deleted_at IS NULL
        AND c.created_at >= v_since
        AND (v_cursor_ts IS NULL OR (c.created_at, c.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY c.created_at, c.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'inventory_count_items' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT ii.* FROM public.inventory_count_items ii
      JOIN public.inventory_counts c ON c.id = ii.count_id
      WHERE c.deleted_at IS NULL
        AND c.created_at >= v_since
        AND (v_cursor_id IS NULL OR ii.id > v_cursor_id)
      ORDER BY ii.id LIMIT v_limit + 1
    ) r;
  ELSIF v_entity = 'audit_logs' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at, r.id), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.audit_logs a
      WHERE a.deleted_at IS NULL
        AND a.created_at >= v_since
        AND (v_cursor_ts IS NULL OR (a.created_at, a.id) > (v_cursor_ts, COALESCE(v_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      ORDER BY a.created_at, a.id LIMIT v_limit + 1
    ) r;
  ELSE
    RAISE EXCEPTION 'كيان غير معروف: %', p_entity;
  END IF;

  IF jsonb_array_length(v_rows) > v_limit THEN
    v_has_more := true;
    v_rows := (
      SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
      FROM (
        SELECT elem FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(elem, ord)
        WHERE ord <= v_limit
      ) x
    );
  END IF;

  -- Build next cursor from last row
  IF jsonb_array_length(v_rows) > 0 THEN
    IF v_entity IN (
      'invoice_items','document_items','journal_lines',
      'party_payment_allocations','inventory_count_items'
    ) THEN
      v_last_id := (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'id')::uuid;
    ELSIF v_entity = 'product_tier_prices' THEN
      -- cursor is product_id|tier_id text concat stored without ts
      NULL;
    ELSIF v_entity IN ('tier_category_discounts','tier_product_discounts') THEN
      NULL;
    ELSIF v_entity = 'shifts' THEN
      v_last_ts := COALESCE(
        (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'opened_at')::timestamptz,
        (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'created_at')::timestamptz
      );
      v_last_id := (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'id')::uuid;
    ELSE
      v_last_ts := (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'created_at')::timestamptz;
      v_last_id := (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'id')::uuid;
    END IF;
  END IF;

  SELECT COALESCE(MAX(server_seq), 0) INTO v_seq FROM public.sync_changes;

  RETURN jsonb_build_object(
    'entity', v_entity,
    'rows', v_rows,
    'has_more', v_has_more,
    'next_cursor', CASE
      WHEN NOT v_has_more THEN NULL
      WHEN v_entity = 'product_tier_prices' AND jsonb_array_length(v_rows) > 0 THEN
        (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'product_id')
        || (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'tier_id')
      WHEN v_entity = 'tier_category_discounts' AND jsonb_array_length(v_rows) > 0 THEN
        (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'tier_id')
        || (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'category_id')
      WHEN v_entity = 'tier_product_discounts' AND jsonb_array_length(v_rows) > 0 THEN
        (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'tier_id')
        || (v_rows -> (jsonb_array_length(v_rows) - 1) ->> 'product_id')
      WHEN v_entity IN (
        'invoice_items','document_items','journal_lines',
        'party_payment_allocations','inventory_count_items'
      ) AND v_last_id IS NOT NULL THEN
        '1970-01-01T00:00:00Z|' || v_last_id::text
      WHEN v_last_ts IS NOT NULL AND v_last_id IS NOT NULL THEN
        v_last_ts::text || '|' || v_last_id::text
      ELSE NULL
    END,
    'count', jsonb_array_length(v_rows),
    'checkpoint', v_seq,
    'server_ms', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
    'data_pack_version', 2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_bootstrap_page(text, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_bootstrap_page(text, timestamptz, text, integer) TO authenticated;

-- Keep old bootstrap for compatibility but include expenses/year history
CREATE OR REPLACE FUNCTION public.sync_bootstrap_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
  v_since timestamptz := NOW() - INTERVAL '365 days';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT COALESCE(MAX(server_seq), 0) INTO v_seq FROM public.sync_changes;

  RETURN jsonb_build_object(
    'checkpoint', v_seq,
    'server_ms', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
    'data_pack_version', 2,
    'prefer_paged', true,
    'products', COALESCE((SELECT jsonb_agg(to_jsonb(p.*)) FROM public.products p WHERE p.deleted_at IS NULL), '[]'::jsonb),
    'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c.*)) FROM public.categories c WHERE c.deleted_at IS NULL), '[]'::jsonb),
    'customers', COALESCE((SELECT jsonb_agg(to_jsonb(c.*)) FROM public.customers c WHERE c.deleted_at IS NULL), '[]'::jsonb),
    'suppliers', COALESCE((SELECT jsonb_agg(to_jsonb(s.*)) FROM public.suppliers s WHERE s.deleted_at IS NULL), '[]'::jsonb),
    'safes', COALESCE((SELECT jsonb_agg(to_jsonb(s.*)) FROM public.safes s WHERE s.deleted_at IS NULL), '[]'::jsonb),
    'settings', COALESCE((SELECT to_jsonb(s.*) FROM public.settings s WHERE s.deleted_at IS NULL LIMIT 1), 'null'::jsonb),
    'accounts', COALESCE((SELECT jsonb_agg(to_jsonb(a.*)) FROM public.accounts a WHERE a.deleted_at IS NULL), '[]'::jsonb),
    'profiles', COALESCE((SELECT jsonb_agg(to_jsonb(p.*)) FROM public.profiles p WHERE p.deleted_at IS NULL), '[]'::jsonb)
  );
END;
$$;

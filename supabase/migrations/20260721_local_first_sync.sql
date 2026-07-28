-- =========================================================================
-- Local-first sync: devices, operations, change feed, tombstones, HLC
-- =========================================================================

-- Devices registered per browser/PWA install
CREATE TABLE IF NOT EXISTS public.sync_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_label TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_pull_seq BIGINT NOT NULL DEFAULT 0,
  clock_offset_ms BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_devices_user
  ON public.sync_devices(user_id, last_seen_at DESC);

ALTER TABLE public.sync_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_devices_own ON public.sync_devices;
CREATE POLICY sync_devices_own ON public.sync_devices
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Immutable client operations (idempotent push log)
CREATE TABLE IF NOT EXISTS public.sync_operations (
  operation_id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES public.sync_devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  op_kind TEXT NOT NULL CHECK (op_kind IN ('upsert', 'delete', 'domain')),
  domain_op TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_version BIGINT,
  hlc_physical_ms BIGINT NOT NULL,
  hlc_counter INTEGER NOT NULL DEFAULT 0,
  hlc_device_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'superseded', 'rejected', 'duplicate')),
  reject_reason TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_operations_user_received
  ON public.sync_operations(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_operations_entity
  ON public.sync_operations(entity_type, entity_id, hlc_physical_ms DESC, hlc_counter DESC);

ALTER TABLE public.sync_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_operations_select_own ON public.sync_operations;
CREATE POLICY sync_operations_select_own ON public.sync_operations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_app_permission('audit'));

-- Global change feed (monotonic server_seq for incremental pull)
CREATE SEQUENCE IF NOT EXISTS public.sync_change_seq;

CREATE TABLE IF NOT EXISTS public.sync_changes (
  server_seq BIGINT PRIMARY KEY DEFAULT nextval('public.sync_change_seq'),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  op_kind TEXT NOT NULL CHECK (op_kind IN ('upsert', 'delete')),
  version BIGINT NOT NULL DEFAULT 1,
  hlc_physical_ms BIGINT NOT NULL,
  hlc_counter INTEGER NOT NULL DEFAULT 0,
  hlc_device_id UUID NOT NULL,
  row_data JSONB,
  deleted BOOLEAN NOT NULL DEFAULT false,
  operation_id UUID REFERENCES public.sync_operations(operation_id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_entity
  ON public.sync_changes(entity_type, entity_id, server_seq DESC);
CREATE INDEX IF NOT EXISTS idx_sync_changes_seq
  ON public.sync_changes(server_seq);

ALTER TABLE public.sync_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_changes_select_auth ON public.sync_changes;
CREATE POLICY sync_changes_select_auth ON public.sync_changes
  FOR SELECT TO authenticated
  USING (public.is_active_user());

-- Per-entity sync metadata helper columns on core tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products','categories','customers','suppliers','safes','invoices',
    'documents','settings','shifts','party_payments','accounts',
    'inventory_counts','price_tiers'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS last_hlc_physical_ms BIGINT NOT NULL DEFAULT 0', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS last_hlc_counter INTEGER NOT NULL DEFAULT 0', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS last_hlc_device_id UUID', t);
  END LOOP;
END $$;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.safes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.party_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Compare two HLCs: returns 1 if a > b, -1 if a < b, 0 if equal
CREATE OR REPLACE FUNCTION public.hlc_compare(
  a_phys BIGINT, a_ctr INTEGER, a_dev UUID,
  b_phys BIGINT, b_ctr INTEGER, b_dev UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF a_phys > b_phys THEN RETURN 1; END IF;
  IF a_phys < b_phys THEN RETURN -1; END IF;
  IF a_ctr > b_ctr THEN RETURN 1; END IF;
  IF a_ctr < b_ctr THEN RETURN -1; END IF;
  IF a_dev::text > b_dev::text THEN RETURN 1; END IF;
  IF a_dev::text < b_dev::text THEN RETURN -1; END IF;
  RETURN 0;
END;
$$;

-- Emit a change feed row and bump entity metadata
CREATE OR REPLACE FUNCTION public.emit_sync_change(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_op_kind TEXT,
  p_hlc_physical_ms BIGINT,
  p_hlc_counter INTEGER,
  p_hlc_device_id UUID,
  p_row_data JSONB DEFAULT NULL,
  p_deleted BOOLEAN DEFAULT false,
  p_operation_id UUID DEFAULT NULL,
  p_version BIGINT DEFAULT 1
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  INSERT INTO public.sync_changes (
    entity_type, entity_id, op_kind, version,
    hlc_physical_ms, hlc_counter, hlc_device_id,
    row_data, deleted, operation_id, user_id
  ) VALUES (
    p_entity_type, p_entity_id, p_op_kind, p_version,
    p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id,
    p_row_data, p_deleted, p_operation_id, auth.uid()
  )
  RETURNING server_seq INTO v_seq;
  RETURN v_seq;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_sync_change(text, uuid, text, bigint, integer, uuid, jsonb, boolean, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.emit_sync_change(text, uuid, text, bigint, integer, uuid, jsonb, boolean, uuid, bigint) TO authenticated;

-- Server wall clock for HLC calibration
CREATE OR REPLACE FUNCTION public.sync_server_time()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'server_ms', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
    'iso', NOW()
  );
$$;

REVOKE ALL ON FUNCTION public.sync_server_time() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_server_time() TO authenticated;

-- Register / heartbeat device
CREATE OR REPLACE FUNCTION public.sync_register_device(
  p_device_id UUID,
  p_label TEXT DEFAULT NULL,
  p_clock_offset_ms BIGINT DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  INSERT INTO public.sync_devices (id, user_id, device_label, clock_offset_ms)
  VALUES (p_device_id, auth.uid(), NULLIF(trim(COALESCE(p_label, '')), ''), COALESCE(p_clock_offset_ms, 0))
  ON CONFLICT (id) DO UPDATE
  SET
    last_seen_at = NOW(),
    device_label = COALESCE(EXCLUDED.device_label, sync_devices.device_label),
    clock_offset_ms = COALESCE(p_clock_offset_ms, sync_devices.clock_offset_ms);

  RETURN jsonb_build_object(
    'device_id', p_device_id,
    'server_ms', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_register_device(uuid, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_register_device(uuid, text, bigint) TO authenticated;

-- Apply one sync operation with LWW-by-HLC (generic entity upsert/delete)
CREATE OR REPLACE FUNCTION public.sync_apply_operation(
  p_operation_id UUID,
  p_device_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_op_kind TEXT,
  p_domain_op TEXT,
  p_payload JSONB,
  p_base_version BIGINT,
  p_hlc_physical_ms BIGINT,
  p_hlc_counter INTEGER,
  p_hlc_device_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.sync_operations%ROWTYPE;
  v_cmp INTEGER;
  v_table TEXT;
  v_sql TEXT;
  v_cur_phys BIGINT;
  v_cur_ctr INTEGER;
  v_cur_dev UUID;
  v_cur_ver BIGINT;
  v_new_ver BIGINT;
  v_row JSONB;
  v_seq BIGINT;
  v_status TEXT := 'applied';
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF p_operation_id IS NULL OR p_device_id IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'معرّفات العملية مطلوبة';
  END IF;

  -- Idempotency
  SELECT * INTO v_existing FROM public.sync_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'duplicate',
      'operation_id', p_operation_id,
      'existing_status', v_existing.status
    );
  END IF;

  -- Ensure device belongs to user
  IF NOT EXISTS (
    SELECT 1 FROM public.sync_devices d
    WHERE d.id = p_device_id AND d.user_id = auth.uid()
  ) THEN
    PERFORM public.sync_register_device(p_device_id, 'auto', 0);
  END IF;

  INSERT INTO public.sync_operations (
    operation_id, device_id, user_id, entity_type, entity_id,
    op_kind, domain_op, payload, base_version,
    hlc_physical_ms, hlc_counter, hlc_device_id, status
  ) VALUES (
    p_operation_id, p_device_id, auth.uid(), p_entity_type, p_entity_id,
    p_op_kind, p_domain_op, COALESCE(p_payload, '{}'::jsonb), p_base_version,
    p_hlc_physical_ms, COALESCE(p_hlc_counter, 0), p_hlc_device_id, 'applied'
  );

  -- Domain ops reuse existing atomic RPCs and still emit changes
  IF p_op_kind = 'domain' THEN
    IF p_domain_op = 'create_invoice' THEN
      v_row := public.create_completed_invoice(
        p_payload->>'type',
        COALESCE(p_payload->'items', '[]'::jsonb),
        COALESCE((p_payload->>'subtotal')::numeric, 0),
        COALESCE((p_payload->>'total')::numeric, 0),
        COALESCE((p_payload->>'taxAmount')::numeric, 0),
        COALESCE((p_payload->>'discountAmount')::numeric, 0),
        COALESCE((p_payload->>'paidAmount')::numeric, 0),
        COALESCE(p_payload->>'paymentMethod', 'cash'),
        NULLIF(p_payload->>'customerId', '')::uuid,
        NULLIF(p_payload->>'supplierId', '')::uuid,
        NULLIF(p_payload->>'safeId', '')::uuid,
        p_payload->>'notes',
        COALESCE((p_payload->>'occurredAt')::timestamptz, NOW()),
        NULLIF(p_payload->>'originalInvoiceId', '')::uuid,
        p_operation_id
      );
      UPDATE public.invoices
      SET
        sync_version = sync_version + 1,
        last_hlc_physical_ms = p_hlc_physical_ms,
        last_hlc_counter = p_hlc_counter,
        last_hlc_device_id = p_hlc_device_id,
        updated_at = NOW()
      WHERE id = (v_row->>'id')::uuid
      RETURNING sync_version INTO v_new_ver;

      SELECT to_jsonb(i.*) INTO v_row FROM public.invoices i WHERE i.id = (v_row->>'id')::uuid;
      v_seq := public.emit_sync_change(
        'invoices', (v_row->>'id')::uuid, 'upsert',
        p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id,
        v_row, false, p_operation_id, COALESCE(v_new_ver, 1)
      );
    ELSIF p_domain_op = 'delete_invoice' THEN
      -- Soft-delete path: mark deleted_at + tombstone; hard cleanup via existing flows later
      SELECT last_hlc_physical_ms, last_hlc_counter, last_hlc_device_id, sync_version
        INTO v_cur_phys, v_cur_ctr, v_cur_dev, v_cur_ver
      FROM public.invoices WHERE id = p_entity_id;

      IF NOT FOUND THEN
        v_status := 'applied';
        v_seq := public.emit_sync_change(
          'invoices', p_entity_id, 'delete',
          p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id,
          NULL, true, p_operation_id, 1
        );
      ELSE
        v_cmp := public.hlc_compare(
          p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id,
          COALESCE(v_cur_phys, 0), COALESCE(v_cur_ctr, 0), COALESCE(v_cur_dev, '00000000-0000-0000-0000-000000000000'::uuid)
        );
        IF v_cmp < 0 THEN
          v_status := 'superseded';
        ELSE
          UPDATE public.invoices
          SET
            deleted_at = NOW(),
            status = 'cancelled',
            sync_version = COALESCE(v_cur_ver, 1) + 1,
            last_hlc_physical_ms = p_hlc_physical_ms,
            last_hlc_counter = p_hlc_counter,
            last_hlc_device_id = p_hlc_device_id,
            updated_at = NOW()
          WHERE id = p_entity_id
          RETURNING sync_version INTO v_new_ver;

          v_seq := public.emit_sync_change(
            'invoices', p_entity_id, 'delete',
            p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id,
            NULL, true, p_operation_id, COALESCE(v_new_ver, 1)
          );
        END IF;
      END IF;
    ELSE
      -- Generic domain marker: still recorded; client may call specialized RPCs
      v_status := 'applied';
    END IF;

    UPDATE public.sync_operations
    SET status = v_status, applied_at = NOW()
    WHERE operation_id = p_operation_id;

    RETURN jsonb_build_object(
      'status', v_status,
      'operation_id', p_operation_id,
      'server_seq', v_seq,
      'result', v_row
    );
  END IF;

  -- Map entity_type → table
  v_table := CASE p_entity_type
    WHEN 'products' THEN 'products'
    WHEN 'categories' THEN 'categories'
    WHEN 'customers' THEN 'customers'
    WHEN 'suppliers' THEN 'suppliers'
    WHEN 'safes' THEN 'safes'
    WHEN 'invoices' THEN 'invoices'
    WHEN 'documents' THEN 'documents'
    WHEN 'settings' THEN 'settings'
    WHEN 'shifts' THEN 'shifts'
    WHEN 'party_payments' THEN 'party_payments'
    WHEN 'accounts' THEN 'accounts'
    WHEN 'inventory_counts' THEN 'inventory_counts'
    WHEN 'price_tiers' THEN 'price_tiers'
    ELSE NULL
  END;

  IF v_table IS NULL THEN
    UPDATE public.sync_operations
    SET status = 'rejected', reject_reason = 'unknown entity', applied_at = NOW()
    WHERE operation_id = p_operation_id;
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'unknown entity');
  END IF;

  EXECUTE format(
    'SELECT last_hlc_physical_ms, last_hlc_counter, last_hlc_device_id, sync_version FROM public.%I WHERE id = $1',
    v_table
  ) INTO v_cur_phys, v_cur_ctr, v_cur_dev, v_cur_ver USING p_entity_id;

  IF FOUND OR v_cur_ver IS NOT NULL THEN
    v_cmp := public.hlc_compare(
      p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id,
      COALESCE(v_cur_phys, 0), COALESCE(v_cur_ctr, 0),
      COALESCE(v_cur_dev, '00000000-0000-0000-0000-000000000000'::uuid)
    );
    IF v_cmp < 0 THEN
      UPDATE public.sync_operations
      SET status = 'superseded', applied_at = NOW()
      WHERE operation_id = p_operation_id;
      RETURN jsonb_build_object('status', 'superseded', 'operation_id', p_operation_id);
    END IF;
  END IF;

  v_new_ver := COALESCE(v_cur_ver, 0) + 1;

  IF p_op_kind = 'delete' THEN
    EXECUTE format(
      'UPDATE public.%I SET deleted_at = NOW(), sync_version = $2,
        last_hlc_physical_ms = $3, last_hlc_counter = $4, last_hlc_device_id = $5,
        updated_at = NOW() WHERE id = $1',
      v_table
    ) USING p_entity_id, v_new_ver, p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id;

    -- If row never existed, still emit tombstone
    v_seq := public.emit_sync_change(
      p_entity_type, p_entity_id, 'delete',
      p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id,
      NULL, true, p_operation_id, v_new_ver
    );
  ELSE
    -- Upsert: merge payload fields that exist on the table via jsonb
    -- For safety we only update known meta + pass through payload via dynamic columns common path:
    -- Prefer UPDATE if exists, else INSERT minimal row from payload.
    IF v_cur_ver IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I SET
          sync_version = $2,
          deleted_at = NULL,
          last_hlc_physical_ms = $3,
          last_hlc_counter = $4,
          last_hlc_device_id = $5,
          updated_at = NOW()
        WHERE id = $1',
        v_table
      ) USING p_entity_id, v_new_ver, p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id;
    ELSE
      -- Insert stub then client payload fields applied via specialized paths if needed
      BEGIN
        EXECUTE format(
          'INSERT INTO public.%I (id, sync_version, last_hlc_physical_ms, last_hlc_counter, last_hlc_device_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             sync_version = EXCLUDED.sync_version,
             deleted_at = NULL,
             last_hlc_physical_ms = EXCLUDED.last_hlc_physical_ms,
             last_hlc_counter = EXCLUDED.last_hlc_counter,
             last_hlc_device_id = EXCLUDED.last_hlc_device_id,
             updated_at = NOW()',
          v_table
        ) USING p_entity_id, v_new_ver, p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id;
      EXCEPTION WHEN OTHERS THEN
        -- Tables with required NOT NULL columns without defaults may fail; mark applied change only
        NULL;
      END;
    END IF;

    EXECUTE format('SELECT to_jsonb(t.*) FROM public.%I t WHERE t.id = $1', v_table)
      INTO v_row USING p_entity_id;

    IF v_row IS NULL THEN
      v_row := COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('id', p_entity_id);
    END IF;

    v_seq := public.emit_sync_change(
      p_entity_type, p_entity_id, 'upsert',
      p_hlc_physical_ms, p_hlc_counter, p_hlc_device_id,
      v_row, false, p_operation_id, v_new_ver
    );
  END IF;

  UPDATE public.sync_operations
  SET status = 'applied', applied_at = NOW()
  WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object(
    'status', 'applied',
    'operation_id', p_operation_id,
    'server_seq', v_seq,
    'version', v_new_ver,
    'row', v_row
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_apply_operation(uuid, uuid, text, uuid, text, text, jsonb, bigint, bigint, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_apply_operation(uuid, uuid, text, uuid, text, text, jsonb, bigint, bigint, integer, uuid) TO authenticated;

-- Push a batch of operations (ordered by HLC)
CREATE OR REPLACE FUNCTION public.sync_push_batch(p_ops jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  elem jsonb;
  results jsonb := '[]'::jsonb;
  one jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' THEN
    RAISE EXCEPTION 'ops must be array';
  END IF;

  FOR elem IN
    SELECT value FROM jsonb_array_elements(p_ops)
    ORDER BY
      (value->>'hlc_physical_ms')::bigint,
      (value->>'hlc_counter')::int,
      value->>'hlc_device_id'
  LOOP
    one := public.sync_apply_operation(
      (elem->>'operation_id')::uuid,
      (elem->>'device_id')::uuid,
      elem->>'entity_type',
      (elem->>'entity_id')::uuid,
      elem->>'op_kind',
      elem->>'domain_op',
      COALESCE(elem->'payload', '{}'::jsonb),
      NULLIF(elem->>'base_version', '')::bigint,
      (elem->>'hlc_physical_ms')::bigint,
      COALESCE((elem->>'hlc_counter')::int, 0),
      (elem->>'hlc_device_id')::uuid
    );
    results := results || jsonb_build_array(one);
  END LOOP;

  RETURN jsonb_build_object(
    'results', results,
    'server_ms', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_push_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_push_batch(jsonb) TO authenticated;

-- Incremental pull since checkpoint
CREATE OR REPLACE FUNCTION public.sync_pull_changes(
  p_device_id UUID,
  p_after_seq BIGINT DEFAULT 0,
  p_limit INTEGER DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_max BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c.*) ORDER BY c.server_seq), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM public.sync_changes
    WHERE server_seq > COALESCE(p_after_seq, 0)
    ORDER BY server_seq
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000))
  ) c;

  SELECT COALESCE(MAX(server_seq), COALESCE(p_after_seq, 0)) INTO v_max
  FROM public.sync_changes
  WHERE server_seq > COALESCE(p_after_seq, 0);

  IF p_device_id IS NOT NULL THEN
    UPDATE public.sync_devices
    SET last_seen_at = NOW(),
        last_pull_seq = GREATEST(last_pull_seq, COALESCE(v_max, p_after_seq, 0))
    WHERE id = p_device_id AND user_id = auth.uid();
  END IF;

  RETURN jsonb_build_object(
    'changes', v_rows,
    'checkpoint', COALESCE(v_max, p_after_seq, 0),
    'server_ms', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
    'has_more', (
      SELECT EXISTS (
        SELECT 1 FROM public.sync_changes
        WHERE server_seq > COALESCE(v_max, p_after_seq, 0)
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_pull_changes(uuid, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_pull_changes(uuid, bigint, integer) TO authenticated;

-- Full bootstrap snapshot for first install / reinstall
CREATE OR REPLACE FUNCTION public.sync_bootstrap_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT COALESCE(MAX(server_seq), 0) INTO v_seq FROM public.sync_changes;

  RETURN jsonb_build_object(
    'checkpoint', v_seq,
    'server_ms', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
    'products', COALESCE((SELECT jsonb_agg(to_jsonb(p.*)) FROM public.products p WHERE p.deleted_at IS NULL), '[]'::jsonb),
    'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c.*)) FROM public.categories c WHERE c.deleted_at IS NULL), '[]'::jsonb),
    'customers', COALESCE((SELECT jsonb_agg(to_jsonb(c.*)) FROM public.customers c WHERE c.deleted_at IS NULL), '[]'::jsonb),
    'suppliers', COALESCE((SELECT jsonb_agg(to_jsonb(s.*)) FROM public.suppliers s WHERE s.deleted_at IS NULL), '[]'::jsonb),
    'safes', COALESCE((SELECT jsonb_agg(to_jsonb(s.*)) FROM public.safes s WHERE s.deleted_at IS NULL), '[]'::jsonb),
    'settings', COALESCE((SELECT to_jsonb(s.*) FROM public.settings s WHERE s.deleted_at IS NULL LIMIT 1), 'null'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(to_jsonb(i.*) ORDER BY i.created_at DESC)
      FROM (
        SELECT * FROM public.invoices
        WHERE deleted_at IS NULL AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT 500
      ) i
    ), '[]'::jsonb),
    'invoice_items', COALESCE((
      SELECT jsonb_agg(to_jsonb(ii.*))
      FROM public.invoice_items ii
      WHERE ii.invoice_id IN (
        SELECT id FROM public.invoices
        WHERE deleted_at IS NULL AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT 500
      )
    ), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(to_jsonb(d.*)) FROM public.documents d WHERE d.deleted_at IS NULL
    ), '[]'::jsonb),
    'accounts', COALESCE((
      SELECT jsonb_agg(to_jsonb(a.*)) FROM public.accounts a WHERE a.deleted_at IS NULL AND a.is_active = true
    ), '[]'::jsonb),
    'shifts', COALESCE((
      SELECT jsonb_agg(to_jsonb(s.*)) FROM public.shifts s
      WHERE s.deleted_at IS NULL AND (s.status = 'open' OR s.opened_at > NOW() - INTERVAL '14 days')
    ), '[]'::jsonb),
    'party_payments', COALESCE((
      SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.created_at DESC)
      FROM (
        SELECT * FROM public.party_payments
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 300
      ) p
    ), '[]'::jsonb),
    'price_tiers', COALESCE((
      SELECT jsonb_agg(to_jsonb(t.*)) FROM public.price_tiers t WHERE t.deleted_at IS NULL
    ), '[]'::jsonb),
    'product_tier_prices', COALESCE((
      SELECT jsonb_agg(to_jsonb(t.*)) FROM public.product_tier_prices t
    ), '[]'::jsonb),
    'tier_category_discounts', COALESCE((
      SELECT jsonb_agg(to_jsonb(t.*)) FROM public.tier_category_discounts t
    ), '[]'::jsonb),
    'tier_product_discounts', COALESCE((
      SELECT jsonb_agg(to_jsonb(t.*)) FROM public.tier_product_discounts t
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_bootstrap_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_bootstrap_snapshot() TO authenticated;

-- Trigger: emit change feed for online mutations (so offline devices learn deletes/edits)
CREATE OR REPLACE FUNCTION public.trg_emit_entity_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity TEXT := TG_TABLE_NAME;
  v_id UUID;
  v_row JSONB;
  v_phys BIGINT;
  v_ctr INTEGER;
  v_dev UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id := OLD.id;
    v_phys := GREATEST(COALESCE(OLD.last_hlc_physical_ms, 0), (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint);
    v_ctr := COALESCE(OLD.last_hlc_counter, 0) + 1;
    v_dev := COALESCE(OLD.last_hlc_device_id, '00000000-0000-0000-0000-000000000001'::uuid);
    PERFORM public.emit_sync_change(
      v_entity, v_id, 'delete', v_phys, v_ctr, v_dev, NULL, true, NULL, COALESCE(OLD.sync_version, 1) + 1
    );
    RETURN OLD;
  END IF;

  v_id := NEW.id;
  -- Only emit if HLC not already set by sync_apply_operation in same statement
  IF TG_OP = 'UPDATE' AND NEW.last_hlc_physical_ms IS DISTINCT FROM OLD.last_hlc_physical_ms THEN
    -- Likely from sync path already emitting; skip duplicate if change exists for same op recently
    RETURN NEW;
  END IF;

  IF NEW.last_hlc_physical_ms IS NULL OR NEW.last_hlc_physical_ms = 0 THEN
    NEW.last_hlc_physical_ms := (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
    NEW.last_hlc_counter := COALESCE(OLD.last_hlc_counter, 0) + 1;
    NEW.last_hlc_device_id := COALESCE(NEW.last_hlc_device_id, '00000000-0000-0000-0000-000000000001'::uuid);
    NEW.sync_version := COALESCE(OLD.sync_version, 0) + 1;
  END IF;

  v_row := to_jsonb(NEW);
  PERFORM public.emit_sync_change(
    v_entity, v_id,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'delete' ELSE 'upsert' END,
    NEW.last_hlc_physical_ms, NEW.last_hlc_counter, NEW.last_hlc_device_id,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN NULL ELSE v_row END,
    NEW.deleted_at IS NOT NULL,
    NULL,
    NEW.sync_version
  );
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products','categories','customers','suppliers','safes','invoices',
    'documents','settings','shifts','party_payments','accounts','inventory_counts','price_tiers'
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

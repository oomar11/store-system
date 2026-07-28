-- =========================================================================
-- Audit log: immutable trail for sensitive actions
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  entity_label TEXT,
  before_data JSONB,
  after_data JSONB,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'app'
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_app_permission('audit'));

-- No insert/update/delete policies for authenticated — writes only via SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid DEFAULT NULL,
  p_entity_label text DEFAULT NULL,
  p_before jsonb DEFAULT NULL,
  p_after jsonb DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb,
  p_source text DEFAULT 'app',
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_name text;
  v_role text;
  v_id uuid;
BEGIN
  IF p_action IS NULL OR length(trim(p_action)) = 0 THEN
    RAISE EXCEPTION 'action مطلوب';
  END IF;
  IF p_entity_type IS NULL OR length(trim(p_entity_type)) = 0 THEN
    RAISE EXCEPTION 'entity_type مطلوب';
  END IF;

  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    v_actor_id := p_actor_id;
  ELSIF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF v_actor_id IS NOT NULL THEN
    SELECT pr.full_name, pr.role
    INTO v_name, v_role
    FROM public.profiles pr
    WHERE pr.id = v_actor_id;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role,
    action, entity_type, entity_id, entity_label,
    before_data, after_data, meta, source
  ) VALUES (
    v_actor_id, v_name, v_role,
    trim(p_action), trim(p_entity_type), p_entity_id, p_entity_label,
    p_before, p_after, COALESCE(p_meta, '{}'::jsonb), COALESCE(NULLIF(trim(p_source), ''), 'app')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(text, text, uuid, text, jsonb, jsonb, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, uuid, text, jsonb, jsonb, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, uuid, text, jsonb, jsonb, jsonb, text, uuid) TO service_role;

-- Permission: audit (owner + manager by default)
CREATE OR REPLACE FUNCTION public.effective_permissions(p_role text, p_permissions jsonb)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result text[];
BEGIN
  IF p_permissions IS NOT NULL AND jsonb_typeof(p_permissions) = 'array' THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[])
    INTO result
    FROM jsonb_array_elements_text(p_permissions) AS t(x);
    RETURN result;
  END IF;

  IF p_role = 'owner' THEN
    RETURN ARRAY[
      'dashboard','pos','sales','purchases','products','products.write','inventory',
      'customers','customers.write','suppliers','treasury','expenses','reports',
      'settings','settings.backup','users.manage','invoices.delete','prices.edit','shifts','audit'
    ];
  ELSIF p_role = 'manager' THEN
    RETURN ARRAY[
      'dashboard','pos','sales','purchases','products','products.write','inventory',
      'customers','customers.write','suppliers','treasury','expenses','reports',
      'prices.edit','shifts','settings','audit'
    ];
  ELSE
    RETURN ARRAY[
      'dashboard','pos','sales','products','inventory','customers','shifts'
    ];
  END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- Product price changes
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_products_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       COALESCE(OLD.buy_price, 0) IS DISTINCT FROM COALESCE(NEW.buy_price, 0)
       OR COALESCE(OLD.sell_price, 0) IS DISTINCT FROM COALESCE(NEW.sell_price, 0)
     )
  THEN
    PERFORM public.log_audit_event(
      'product.price_change',
      'product',
      NEW.id,
      COALESCE(NEW.name, NEW.sku),
      jsonb_build_object(
        'buy_price', OLD.buy_price,
        'sell_price', OLD.sell_price,
        'sku', OLD.sku
      ),
      jsonb_build_object(
        'buy_price', NEW.buy_price,
        'sell_price', NEW.sell_price,
        'sku', NEW.sku
      ),
      '{}'::jsonb,
      'trigger'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_products_price ON public.products;
CREATE TRIGGER trg_audit_products_price
  AFTER UPDATE OF buy_price, sell_price ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_products_price_change();

-- -------------------------------------------------------------------------
-- Settings updates
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM public.log_audit_event(
      'settings.update',
      'settings',
      NEW.id,
      COALESCE(NEW.store_name, 'إعدادات المتجر'),
      to_jsonb(OLD) - 'id',
      to_jsonb(NEW) - 'id',
      '{}'::jsonb,
      'trigger'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_settings ON public.settings;
CREATE TRIGGER trg_audit_settings
  AFTER UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_settings_change();

-- -------------------------------------------------------------------------
-- Manual safe movements (skip invoice-linked noise)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_safe_movement(
  p_safe_id uuid,
  p_type text,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance numeric;
  next_balance numeric;
  updated_rows integer;
  v_safe_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF COALESCE(p_reference_type, '') NOT IN ('invoice', 'invoice_reversal')
     AND NOT public.has_app_permission('treasury') THEN
    RAISE EXCEPTION 'عمليات الخزينة اليدوية غير مسموحة لصلاحياتك';
  END IF;

  IF p_safe_id IS NULL OR COALESCE(p_amount, 0) <= 0 THEN
    RETURN;
  END IF;

  IF p_type NOT IN ('deposit', 'withdrawal') THEN
    RAISE EXCEPTION 'نوع حركة الخزنة غير صالح';
  END IF;

  SELECT balance, name INTO current_balance, v_safe_name
  FROM public.safes
  WHERE id = p_safe_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر قراءة رصيد الخزنة';
  END IF;

  current_balance := COALESCE(current_balance, 0);
  next_balance := CASE
    WHEN p_type = 'deposit' THEN current_balance + p_amount
    ELSE current_balance - p_amount
  END;

  IF p_type = 'withdrawal' AND next_balance < 0 THEN
    RAISE EXCEPTION 'رصيد الخزنة غير كافٍ لإتمام العملية';
  END IF;

  UPDATE public.safes
  SET balance = next_balance
  WHERE id = p_safe_id;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows = 0 THEN
    RAISE EXCEPTION 'تعذر تحديث رصيد الخزنة';
  END IF;

  INSERT INTO public.safe_transactions (
    safe_id, type, amount, description, reference_type, reference_id
  ) VALUES (
    p_safe_id, p_type, p_amount, p_description, p_reference_type, p_reference_id
  );

  IF COALESCE(p_reference_type, '') NOT IN ('invoice', 'invoice_reversal') THEN
    PERFORM public.log_audit_event(
      'safe.movement',
      'safe',
      p_safe_id,
      v_safe_name,
      jsonb_build_object('balance', current_balance),
      jsonb_build_object('balance', next_balance),
      jsonb_build_object(
        'type', p_type,
        'amount', p_amount,
        'description', p_description,
        'reference_type', p_reference_type,
        'reference_id', p_reference_id
      ),
      'rpc'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_between_safes(
  p_from_safe_id uuid,
  p_to_safe_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_balance numeric;
  to_balance numeric;
  note text;
  group_id uuid := gen_random_uuid();
  from_name text;
  to_name text;
BEGIN
  IF NOT public.has_app_permission('treasury') THEN
    RAISE EXCEPTION 'تحويلات الخزينة غير مسموحة لصلاحياتك';
  END IF;

  IF p_from_safe_id IS NULL OR p_to_safe_id IS NULL OR p_from_safe_id = p_to_safe_id THEN
    RAISE EXCEPTION 'اختر خزنتين مختلفتين للتحويل';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'مبلغ التحويل غير صالح';
  END IF;

  SELECT balance, name INTO from_balance, from_name
  FROM public.safes
  WHERE id = p_from_safe_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخزنة المصدر غير موجودة';
  END IF;

  SELECT balance, name INTO to_balance, to_name
  FROM public.safes
  WHERE id = p_to_safe_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الخزنة الهدف غير موجودة';
  END IF;

  IF COALESCE(from_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'رصيد الخزنة المصدر غير كافٍ';
  END IF;

  note := NULLIF(trim(COALESCE(p_description, '')), '');
  IF note IS NULL THEN
    note := format('تحويل من %s إلى %s', from_name, to_name);
  END IF;

  UPDATE public.safes SET balance = from_balance - p_amount WHERE id = p_from_safe_id;
  UPDATE public.safes SET balance = COALESCE(to_balance, 0) + p_amount WHERE id = p_to_safe_id;

  INSERT INTO public.safe_transactions (
    safe_id, type, amount, description, related_safe_id, transfer_group_id, reference_type
  ) VALUES
    (p_from_safe_id, 'transfer', p_amount, note, p_to_safe_id, group_id, 'transfer_out'),
    (p_to_safe_id, 'transfer', p_amount, note, p_from_safe_id, group_id, 'transfer_in');

  PERFORM public.log_audit_event(
    'safe.transfer',
    'safe',
    p_from_safe_id,
    format('%s ← %s', from_name, to_name),
    jsonb_build_object('from_balance', from_balance, 'to_balance', to_balance),
    jsonb_build_object(
      'from_balance', from_balance - p_amount,
      'to_balance', COALESCE(to_balance, 0) + p_amount
    ),
    jsonb_build_object(
      'amount', p_amount,
      'from_safe_id', p_from_safe_id,
      'to_safe_id', p_to_safe_id,
      'from_name', from_name,
      'to_name', to_name,
      'description', note
    ),
    'rpc'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_safe_movement(uuid, text, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_between_safes(uuid, uuid, numeric, text) TO authenticated;

-- Custom per-user permissions (null = use role template)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT NULL;

COMMENT ON COLUMN public.profiles.permissions IS
  'Custom permission keys JSON array. NULL means use role template defaults.';

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
      'settings','settings.backup','users.manage','invoices.delete','prices.edit'
    ];
  ELSIF p_role = 'manager' THEN
    RETURN ARRAY[
      'dashboard','pos','sales','purchases','products','products.write','inventory',
      'customers','customers.write','suppliers','treasury','expenses','reports','prices.edit'
    ];
  ELSE
    RETURN ARRAY[
      'dashboard','pos','sales','products','inventory','customers'
    ];
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_app_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.id = auth.uid()
      AND COALESCE(pr.is_active, true)
      AND p_permission = ANY (public.effective_permissions(pr.role, pr.permissions))
  );
$$;

REVOKE ALL ON FUNCTION public.effective_permissions(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_app_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effective_permissions(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_app_permission(text) TO authenticated;

-- Keep is_manager_or_above / is_owner for backward compat, but align with permissions
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_app_permission('users.manage')
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'owner' AND COALESCE(is_active, true)
      );
$$;

CREATE OR REPLACE FUNCTION public.is_manager_or_above()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_app_permission('treasury')
      OR public.has_app_permission('reports')
      OR public.has_app_permission('purchases')
      OR public.has_app_permission('products.write')
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('owner', 'manager')
          AND COALESCE(is_active, true)
      );
$$;

-- Products write
DROP POLICY IF EXISTS products_insert ON public.products;
DROP POLICY IF EXISTS products_update ON public.products;
DROP POLICY IF EXISTS products_delete ON public.products;
CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('products.write'));
CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_app_permission('products.write'))
  WITH CHECK (public.has_app_permission('products.write'));
CREATE POLICY products_delete ON public.products
  FOR DELETE TO authenticated
  USING (public.has_app_permission('products.write'));

DROP POLICY IF EXISTS categories_write ON public.categories;
CREATE POLICY categories_write ON public.categories
  FOR ALL TO authenticated
  USING (public.has_app_permission('products.write'))
  WITH CHECK (public.has_app_permission('products.write'));

-- Customers write
DROP POLICY IF EXISTS customers_update ON public.customers;
DROP POLICY IF EXISTS customers_delete ON public.customers;
CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated
  USING (public.has_app_permission('customers.write'))
  WITH CHECK (public.has_app_permission('customers.write'));
CREATE POLICY customers_delete ON public.customers
  FOR DELETE TO authenticated
  USING (public.has_app_permission('customers.write'));

-- Suppliers
DROP POLICY IF EXISTS suppliers_all ON public.suppliers;
CREATE POLICY suppliers_all ON public.suppliers
  FOR ALL TO authenticated
  USING (public.has_app_permission('suppliers'))
  WITH CHECK (public.has_app_permission('suppliers'));

-- Invoice delete
DROP POLICY IF EXISTS invoices_delete ON public.invoices;
CREATE POLICY invoices_delete ON public.invoices
  FOR DELETE TO authenticated
  USING (public.has_app_permission('invoices.delete'));

DROP POLICY IF EXISTS invoices_update ON public.invoices;
CREATE POLICY invoices_update ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    public.has_app_permission('sales')
    OR public.has_app_permission('purchases')
    OR public.has_app_permission('products.write')
  )
  WITH CHECK (
    public.has_app_permission('sales')
    OR public.has_app_permission('purchases')
    OR public.has_app_permission('products.write')
  );

-- Accounting / expenses
DROP POLICY IF EXISTS accounts_all ON public.accounts;
DROP POLICY IF EXISTS journal_entries_all ON public.journal_entries;
DROP POLICY IF EXISTS journal_lines_all ON public.journal_lines;
CREATE POLICY accounts_all ON public.accounts
  FOR ALL TO authenticated
  USING (public.has_app_permission('expenses'))
  WITH CHECK (public.has_app_permission('expenses'));
CREATE POLICY journal_entries_all ON public.journal_entries
  FOR ALL TO authenticated
  USING (public.has_app_permission('expenses'))
  WITH CHECK (public.has_app_permission('expenses'));
CREATE POLICY journal_lines_all ON public.journal_lines
  FOR ALL TO authenticated
  USING (public.has_app_permission('expenses'))
  WITH CHECK (public.has_app_permission('expenses'));

-- Safes / treasury
DROP POLICY IF EXISTS safes_insert ON public.safes;
DROP POLICY IF EXISTS safes_update ON public.safes;
DROP POLICY IF EXISTS safes_delete ON public.safes;
CREATE POLICY safes_insert ON public.safes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('treasury'));
CREATE POLICY safes_update ON public.safes
  FOR UPDATE TO authenticated
  USING (public.has_app_permission('treasury'))
  WITH CHECK (public.has_app_permission('treasury'));
CREATE POLICY safes_delete ON public.safes
  FOR DELETE TO authenticated
  USING (public.has_app_permission('settings.backup'));

DROP POLICY IF EXISTS safe_transactions_insert ON public.safe_transactions;
DROP POLICY IF EXISTS safe_transactions_delete ON public.safe_transactions;
CREATE POLICY safe_transactions_insert ON public.safe_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_app_permission('treasury'));
CREATE POLICY safe_transactions_delete ON public.safe_transactions
  FOR DELETE TO authenticated
  USING (public.has_app_permission('settings.backup'));

-- Settings
DROP POLICY IF EXISTS settings_write ON public.settings;
CREATE POLICY settings_write ON public.settings
  FOR ALL TO authenticated
  USING (public.has_app_permission('settings'))
  WITH CHECK (public.has_app_permission('settings'));

-- Backup runs
DROP POLICY IF EXISTS backup_runs_owner ON public.backup_runs;
CREATE POLICY backup_runs_owner ON public.backup_runs
  FOR ALL TO authenticated
  USING (public.has_app_permission('settings.backup'))
  WITH CHECK (public.has_app_permission('settings.backup'));

-- set_product_stock: allow inventory permission holders (managers typically)
CREATE OR REPLACE FUNCTION public.set_product_stock(p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  line jsonb;
  pid uuid;
  qty numeric;
  updated_rows integer;
BEGIN
  IF NOT public.has_app_permission('inventory') THEN
    RAISE EXCEPTION 'تعديل الجرد غير مسموح لصلاحياتك';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'بنود المخزون غير صالحة';
  END IF;

  FOR line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    pid := (line->>'product_id')::uuid;
    qty := COALESCE((line->>'quantity')::numeric, 0);
    IF pid IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.products
    SET quantity = qty,
        updated_at = NOW()
    WHERE id = pid;
    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    IF updated_rows = 0 THEN
      RAISE EXCEPTION 'الصنف غير موجود: %', pid;
    END IF;
  END LOOP;
END;
$$;

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

  SELECT balance INTO current_balance
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
END;
$$;

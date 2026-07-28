-- =========================================================================
-- Phase 1: Role helpers, hardened RLS, profile protection, atomic RPCs
-- =========================================================================

-- -------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so RLS policies can call them safely)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
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
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('owner', 'manager')
      AND COALESCE(is_active, true)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND COALESCE(is_active, true)
  );
$$;

REVOKE ALL ON FUNCTION public.app_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager_or_above() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_or_above() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

-- -------------------------------------------------------------------------
-- Signup: never trust client metadata for role
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'مستخدم جديد'),
    'employee'
  );
  RETURN NEW;
END;
$$;

-- -------------------------------------------------------------------------
-- Profiles: only owners can change role / is_active
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner() THEN
      RAISE EXCEPTION 'فقط المالك يمكنه تعديل الدور أو حالة التفعيل';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_sensitive ON public.profiles;
CREATE TRIGGER profiles_protect_sensitive
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_fields();

-- -------------------------------------------------------------------------
-- Atomic stock RPCs
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_lines jsonb,
  p_direction integer,
  p_allow_negative boolean DEFAULT false
)
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
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF p_direction NOT IN (1, -1) THEN
    RAISE EXCEPTION 'اتجاه التعديل غير صالح';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'بنود المخزون غير صالحة';
  END IF;

  FOR line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    pid := (line->>'product_id')::uuid;
    qty := COALESCE((line->>'quantity')::numeric, 0);

    IF pid IS NULL OR qty <= 0 THEN
      CONTINUE;
    END IF;

    IF p_direction = -1 AND NOT p_allow_negative THEN
      UPDATE public.products
      SET quantity = quantity - qty,
          updated_at = NOW()
      WHERE id = pid
        AND quantity >= qty;
      GET DIAGNOSTICS updated_rows = ROW_COUNT;
      IF updated_rows = 0 THEN
        RAISE EXCEPTION 'الكمية غير كافية للصنف %', pid;
      END IF;
    ELSE
      UPDATE public.products
      SET quantity = quantity + (p_direction * qty),
          updated_at = NOW()
      WHERE id = pid;
      GET DIAGNOSTICS updated_rows = ROW_COUNT;
      IF updated_rows = 0 THEN
        RAISE EXCEPTION 'الصنف غير موجود: %', pid;
      END IF;
    END IF;
  END LOOP;
END;
$$;

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
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'تعديل الجرد متاح للمدير والمالك فقط';
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

-- -------------------------------------------------------------------------
-- Atomic party balance RPCs
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
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
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
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
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

-- -------------------------------------------------------------------------
-- Atomic safe RPCs
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
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  -- Manual treasury ops require manager+; invoice-linked payments allowed for all staff
  IF COALESCE(p_reference_type, '') NOT IN ('invoice', 'invoice_reversal')
     AND NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'عمليات الخزينة اليدوية للمدير والمالك فقط';
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
  IF NOT public.is_manager_or_above() THEN
    RAISE EXCEPTION 'تحويلات الخزينة للمدير والمالك فقط';
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

REVOKE ALL ON FUNCTION public.adjust_product_stock(jsonb, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_product_stock(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_customer_balance(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_supplier_balance(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_safe_movement(uuid, text, numeric, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_between_safes(uuid, uuid, numeric, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(jsonb, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_stock(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_customer_balance(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_supplier_balance(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_safe_movement(uuid, text, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_between_safes(uuid, uuid, numeric, text) TO authenticated;

-- -------------------------------------------------------------------------
-- Drop open policies and replace with role-aware policies
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view all" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated access" ON public.categories;
DROP POLICY IF EXISTS "Authenticated access" ON public.products;
DROP POLICY IF EXISTS "Authenticated access" ON public.customers;
DROP POLICY IF EXISTS "Authenticated access" ON public.suppliers;
DROP POLICY IF EXISTS "Authenticated access" ON public.invoices;
DROP POLICY IF EXISTS "Authenticated access" ON public.invoice_items;
DROP POLICY IF EXISTS "Authenticated access" ON public.documents;
DROP POLICY IF EXISTS "Authenticated access" ON public.document_items;
DROP POLICY IF EXISTS "Authenticated access" ON public.accounts;
DROP POLICY IF EXISTS "Authenticated access" ON public.journal_entries;
DROP POLICY IF EXISTS "Authenticated access" ON public.journal_lines;
DROP POLICY IF EXISTS "Authenticated access" ON public.safes;
DROP POLICY IF EXISTS "Authenticated access" ON public.safe_transactions;
DROP POLICY IF EXISTS "Authenticated access" ON public.settings;
DROP POLICY IF EXISTS "Authenticated access" ON public.inventory_counts;
DROP POLICY IF EXISTS "Authenticated access" ON public.inventory_count_items;
DROP POLICY IF EXISTS "Authenticated access" ON public.backup_runs;

-- Profiles
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_active_user());

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_owner())
  WITH CHECK (auth.uid() = id OR public.is_owner());

-- Categories / products: employee read-only; manager+ write
CREATE POLICY categories_select ON public.categories
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY categories_write ON public.categories
  FOR ALL TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());

CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY products_delete ON public.products
  FOR DELETE TO authenticated
  USING (public.is_manager_or_above());

-- Customers: all can read/insert; manager+ update/delete (balances via RPC)
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY customers_insert ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());
CREATE POLICY customers_update ON public.customers
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY customers_delete ON public.customers
  FOR DELETE TO authenticated
  USING (public.is_manager_or_above());

-- Suppliers: manager+ only
CREATE POLICY suppliers_all ON public.suppliers
  FOR ALL TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());

-- Invoices: staff can create/read; manager+ edit; owner delete
CREATE POLICY invoices_select ON public.invoices
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY invoices_insert ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());
CREATE POLICY invoices_update ON public.invoices
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY invoices_delete ON public.invoices
  FOR DELETE TO authenticated
  USING (public.is_owner());

CREATE POLICY invoice_items_select ON public.invoice_items
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY invoice_items_insert ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());
CREATE POLICY invoice_items_update ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY invoice_items_delete ON public.invoice_items
  FOR DELETE TO authenticated
  USING (public.is_manager_or_above() OR public.is_owner());

-- Documents (quotes / POs)
CREATE POLICY documents_select ON public.documents
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY documents_insert ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());
CREATE POLICY documents_update ON public.documents
  FOR UPDATE TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());
CREATE POLICY documents_delete ON public.documents
  FOR DELETE TO authenticated
  USING (public.is_manager_or_above());

CREATE POLICY document_items_select ON public.document_items
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY document_items_insert ON public.document_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user());
CREATE POLICY document_items_update ON public.document_items
  FOR UPDATE TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());
CREATE POLICY document_items_delete ON public.document_items
  FOR DELETE TO authenticated
  USING (public.is_manager_or_above() OR public.is_active_user());

-- Accounting / expenses: manager+
CREATE POLICY accounts_all ON public.accounts
  FOR ALL TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY journal_entries_all ON public.journal_entries
  FOR ALL TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY journal_lines_all ON public.journal_lines
  FOR ALL TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());

-- Safes: all can read (POS payment picker); writes via RPC or manager+
CREATE POLICY safes_select ON public.safes
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY safes_insert ON public.safes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY safes_update ON public.safes
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_above())
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY safes_delete ON public.safes
  FOR DELETE TO authenticated
  USING (public.is_owner());

CREATE POLICY safe_transactions_select ON public.safe_transactions
  FOR SELECT TO authenticated
  USING (public.is_active_user());
CREATE POLICY safe_transactions_insert ON public.safe_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_above());
CREATE POLICY safe_transactions_delete ON public.safe_transactions
  FOR DELETE TO authenticated
  USING (public.is_owner());

-- Settings: everyone reads; owner writes
CREATE POLICY settings_select ON public.settings
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY settings_write ON public.settings
  FOR ALL TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- Inventory counts: all staff can operate counts
CREATE POLICY inventory_counts_all ON public.inventory_counts
  FOR ALL TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());
CREATE POLICY inventory_count_items_all ON public.inventory_count_items
  FOR ALL TO authenticated
  USING (public.is_active_user())
  WITH CHECK (public.is_active_user());

-- Backup audit: owner only
CREATE POLICY backup_runs_owner ON public.backup_runs
  FOR ALL TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

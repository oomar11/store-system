-- Dual-role party link (customer ↔ supplier 1:1) + netting settlement (مقاصة)
-- Keeps separate AR/AP balances; UI shows net = customer.balance - supplier.balance

-- -------------------------------------------------------------------------
-- Columns
-- -------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS linked_supplier_id UUID;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS linked_customer_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_linked_supplier_id_key'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_linked_supplier_id_key UNIQUE (linked_supplier_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_linked_supplier_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_linked_supplier_id_fkey
      FOREIGN KEY (linked_supplier_id)
      REFERENCES public.suppliers(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_linked_customer_id_key'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_linked_customer_id_key UNIQUE (linked_customer_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_linked_customer_id_fkey'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_linked_customer_id_fkey
      FOREIGN KEY (linked_customer_id)
      REFERENCES public.customers(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_linked_supplier
  ON public.customers (linked_supplier_id)
  WHERE linked_supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_linked_customer
  ON public.suppliers (linked_customer_id)
  WHERE linked_customer_id IS NOT NULL;

-- Settlement payments: no safe movement
ALTER TABLE public.party_payments
  ALTER COLUMN safe_id DROP NOT NULL;

ALTER TABLE public.party_payments
  ADD COLUMN IF NOT EXISTS is_settlement BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.party_payments
  ADD COLUMN IF NOT EXISTS settlement_group_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'party_payments_safe_or_settlement'
  ) THEN
    ALTER TABLE public.party_payments
      ADD CONSTRAINT party_payments_safe_or_settlement
      CHECK (
        (is_settlement = false AND safe_id IS NOT NULL)
        OR (is_settlement = true AND safe_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_party_payments_settlement_group
  ON public.party_payments (settlement_group_id)
  WHERE settlement_group_id IS NOT NULL;

COMMENT ON COLUMN public.customers.linked_supplier_id IS
  'Optional 1:1 link to suppliers row for dual-role party (net balance UI).';
COMMENT ON COLUMN public.suppliers.linked_customer_id IS
  'Optional 1:1 link to customers row for dual-role party (net balance UI).';
COMMENT ON COLUMN public.party_payments.is_settlement IS
  'True for مقاصة rows that offset AR/AP without safe cash movement.';

-- -------------------------------------------------------------------------
-- Consistency trigger: both sides of the link must agree
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_party_link_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other uuid;
BEGIN
  -- Parent trigger already wrote the other side; avoid recursive cascades
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'customers' THEN
    IF NEW.linked_supplier_id IS NULL THEN
      IF TG_OP = 'UPDATE'
         AND OLD.linked_supplier_id IS NOT NULL THEN
        UPDATE public.suppliers
        SET linked_customer_id = NULL
        WHERE id = OLD.linked_supplier_id
          AND linked_customer_id = OLD.id;
      END IF;
      RETURN NEW;
    END IF;

    SELECT linked_customer_id INTO v_other
    FROM public.suppliers
    WHERE id = NEW.linked_supplier_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'المورد المربوط غير موجود';
    END IF;

    IF v_other IS NOT NULL AND v_other IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'هذا المورد مربوط بعميل آخر';
    END IF;

    UPDATE public.suppliers
    SET linked_customer_id = NEW.id
    WHERE id = NEW.linked_supplier_id
      AND linked_customer_id IS DISTINCT FROM NEW.id;

    IF TG_OP = 'UPDATE'
       AND OLD.linked_supplier_id IS NOT NULL
       AND OLD.linked_supplier_id IS DISTINCT FROM NEW.linked_supplier_id THEN
      UPDATE public.suppliers
      SET linked_customer_id = NULL
      WHERE id = OLD.linked_supplier_id
        AND linked_customer_id = OLD.id;
    END IF;

  ELSIF TG_TABLE_NAME = 'suppliers' THEN
    IF NEW.linked_customer_id IS NULL THEN
      IF TG_OP = 'UPDATE'
         AND OLD.linked_customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET linked_supplier_id = NULL
        WHERE id = OLD.linked_customer_id
          AND linked_supplier_id = OLD.id;
      END IF;
      RETURN NEW;
    END IF;

    SELECT linked_supplier_id INTO v_other
    FROM public.customers
    WHERE id = NEW.linked_customer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'العميل المربوط غير موجود';
    END IF;

    IF v_other IS NOT NULL AND v_other IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'هذا العميل مربوط بمورد آخر';
    END IF;

    UPDATE public.customers
    SET linked_supplier_id = NEW.id
    WHERE id = NEW.linked_customer_id
      AND linked_supplier_id IS DISTINCT FROM NEW.id;

    IF TG_OP = 'UPDATE'
       AND OLD.linked_customer_id IS NOT NULL
       AND OLD.linked_customer_id IS DISTINCT FROM NEW.linked_customer_id THEN
      UPDATE public.customers
      SET linked_supplier_id = NULL
      WHERE id = OLD.linked_customer_id
        AND linked_supplier_id = OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_party_link ON public.customers;
CREATE TRIGGER trg_customers_party_link
  AFTER INSERT OR UPDATE OF linked_supplier_id ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_party_link_consistency();

DROP TRIGGER IF EXISTS trg_suppliers_party_link ON public.suppliers;
CREATE TRIGGER trg_suppliers_party_link
  AFTER INSERT OR UPDATE OF linked_customer_id ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_party_link_consistency();

-- -------------------------------------------------------------------------
-- link / unlink
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_party_accounts(
  p_customer_id uuid,
  p_supplier_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF NOT (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بربط الحسابات';
  END IF;
  IF p_customer_id IS NULL OR p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد العميل والمورد';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = p_customer_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'العميل غير موجود';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
    WHERE id = p_supplier_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'المورد غير موجود';
  END IF;

  -- Clear prior links for either side (triggers keep the other side in sync)
  UPDATE public.customers
  SET linked_supplier_id = NULL
  WHERE linked_supplier_id = p_supplier_id
    AND id IS DISTINCT FROM p_customer_id;

  UPDATE public.suppliers
  SET linked_customer_id = NULL
  WHERE linked_customer_id = p_customer_id
    AND id IS DISTINCT FROM p_supplier_id;

  UPDATE public.customers
  SET linked_supplier_id = NULL
  WHERE id = p_customer_id
    AND linked_supplier_id IS DISTINCT FROM p_supplier_id
    AND linked_supplier_id IS NOT NULL;

  UPDATE public.customers
  SET linked_supplier_id = p_supplier_id
  WHERE id = p_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_party_accounts(
  p_customer_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid := p_customer_id;
  v_supplier_id uuid := p_supplier_id;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF NOT (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بفك ربط الحسابات';
  END IF;

  IF v_customer_id IS NULL AND v_supplier_id IS NOT NULL THEN
    SELECT linked_customer_id INTO v_customer_id
    FROM public.suppliers WHERE id = v_supplier_id;
  END IF;
  IF v_supplier_id IS NULL AND v_customer_id IS NOT NULL THEN
    SELECT linked_supplier_id INTO v_supplier_id
    FROM public.customers WHERE id = v_customer_id;
  END IF;

  IF v_customer_id IS NULL AND v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد العميل أو المورد';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET linked_supplier_id = NULL
    WHERE id = v_customer_id;
  END IF;
  IF v_supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
    SET linked_customer_id = NULL
    WHERE id = v_supplier_id;
  END IF;
END;
$$;

-- -------------------------------------------------------------------------
-- Ensure dual role (create missing side + link)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_customer_for_supplier(
  p_supplier_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier public.suppliers%ROWTYPE;
  v_customer_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF NOT (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بإنشاء عميل للمورد';
  END IF;

  SELECT * INTO v_supplier
  FROM public.suppliers
  WHERE id = p_supplier_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود';
  END IF;

  IF v_supplier.linked_customer_id IS NOT NULL THEN
    RETURN v_supplier.linked_customer_id;
  END IF;

  INSERT INTO public.customers (
    name, phone, email, address, notes, is_active, balance, opening_balance
  ) VALUES (
    v_supplier.name,
    v_supplier.phone,
    v_supplier.email,
    v_supplier.address,
    COALESCE(v_supplier.notes, '') ||
      CASE WHEN COALESCE(v_supplier.notes, '') = '' THEN '' ELSE E'\n' END ||
      'تم إنشاؤه تلقائياً من المورد للبيع',
    COALESCE(v_supplier.is_active, true),
    0,
    0
  )
  RETURNING id INTO v_customer_id;

  PERFORM public.link_party_accounts(v_customer_id, p_supplier_id);
  RETURN v_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_supplier_for_customer(
  p_customer_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_supplier_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF NOT (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بإنشاء مورد للعميل';
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = p_customer_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'العميل غير موجود';
  END IF;

  IF v_customer.linked_supplier_id IS NOT NULL THEN
    RETURN v_customer.linked_supplier_id;
  END IF;

  INSERT INTO public.suppliers (
    name, phone, email, address, notes, is_active, balance, opening_balance
  ) VALUES (
    v_customer.name,
    v_customer.phone,
    v_customer.email,
    v_customer.address,
    COALESCE(v_customer.notes, '') ||
      CASE WHEN COALESCE(v_customer.notes, '') = '' THEN '' ELSE E'\n' END ||
      'تم إنشاؤه تلقائياً من العميل للشراء',
    COALESCE(v_customer.is_active, true),
    0,
    0
  )
  RETURNING id INTO v_supplier_id;

  PERFORM public.link_party_accounts(p_customer_id, v_supplier_id);
  RETURN v_supplier_id;
END;
$$;

-- -------------------------------------------------------------------------
-- Netting settlement (مقاصة) — no safe movement
-- Accepts either side of the linked pair.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_party_netting(
  p_customer_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid := p_customer_id;
  v_supplier_id uuid := p_supplier_id;
  v_c_bal numeric;
  v_s_bal numeric;
  v_offset numeric;
  v_group_id uuid := gen_random_uuid();
  v_pay_c uuid;
  v_pay_s uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF NOT (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بإجراء المقاصة';
  END IF;

  IF v_customer_id IS NULL AND v_supplier_id IS NOT NULL THEN
    SELECT linked_customer_id INTO v_customer_id
    FROM public.suppliers WHERE id = v_supplier_id AND deleted_at IS NULL;
  END IF;
  IF v_supplier_id IS NULL AND v_customer_id IS NOT NULL THEN
    SELECT linked_supplier_id INTO v_supplier_id
    FROM public.customers WHERE id = v_customer_id AND deleted_at IS NULL;
  END IF;

  IF v_customer_id IS NULL OR v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'الحساب غير مربوط بعميل ومورد معاً';
  END IF;

  -- Verify mutual link
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    JOIN public.suppliers s ON s.id = c.linked_supplier_id
    WHERE c.id = v_customer_id
      AND s.id = v_supplier_id
      AND s.linked_customer_id = c.id
      AND c.deleted_at IS NULL
      AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'الربط بين العميل والمورد غير متسق';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_c_bal
  FROM public.customers WHERE id = v_customer_id;
  SELECT COALESCE(balance, 0) INTO v_s_bal
  FROM public.suppliers WHERE id = v_supplier_id;

  v_offset := LEAST(GREATEST(v_c_bal, 0), GREATEST(v_s_bal, 0));
  v_offset := ROUND(v_offset, 2);

  IF v_offset <= 0 THEN
    RAISE EXCEPTION 'لا يوجد مبلغ قابل للمقاصة (يلزم رصيد عليه ورصيد علينا معاً)';
  END IF;

  INSERT INTO public.party_payments (
    party_type, party_id, amount, safe_id, notes, created_by,
    is_settlement, settlement_group_id
  ) VALUES (
    'customer', v_customer_id, v_offset, NULL,
    'مقاصة مع حساب المورد',
    auth.uid(), true, v_group_id
  )
  RETURNING id INTO v_pay_c;

  INSERT INTO public.party_payments (
    party_type, party_id, amount, safe_id, notes, created_by,
    is_settlement, settlement_group_id
  ) VALUES (
    'supplier', v_supplier_id, v_offset, NULL,
    'مقاصة مع حساب العميل',
    auth.uid(), true, v_group_id
  )
  RETURNING id INTO v_pay_s;

  PERFORM public.adjust_customer_balance(v_customer_id, -v_offset);
  PERFORM public.adjust_supplier_balance(v_supplier_id, -v_offset);

  RETURN jsonb_build_object(
    'offset', v_offset,
    'customer_id', v_customer_id,
    'supplier_id', v_supplier_id,
    'settlement_group_id', v_group_id,
    'customer_payment_id', v_pay_c,
    'supplier_payment_id', v_pay_s,
    'customer_balance_after', v_c_bal - v_offset,
    'supplier_balance_after', v_s_bal - v_offset
  );
END;
$$;

-- Reverse a settlement group (both rows) without touching safes
CREATE OR REPLACE FUNCTION public.delete_party_settlement(
  p_payment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  r record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF NOT (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بحذف المقاصة';
  END IF;

  SELECT settlement_group_id INTO v_group
  FROM public.party_payments
  WHERE id = p_payment_id AND is_settlement = true;

  IF v_group IS NULL THEN
    RAISE EXCEPTION 'دفعة المقاصة غير موجودة';
  END IF;

  FOR r IN
    SELECT id, party_type, party_id, amount
    FROM public.party_payments
    WHERE settlement_group_id = v_group
      AND is_settlement = true
  LOOP
    IF r.party_type = 'customer' THEN
      PERFORM public.adjust_customer_balance(r.party_id, r.amount);
    ELSE
      PERFORM public.adjust_supplier_balance(r.party_id, r.amount);
    END IF;
  END LOOP;

  DELETE FROM public.party_payments
  WHERE settlement_group_id = v_group
    AND is_settlement = true;
END;
$$;

REVOKE ALL ON FUNCTION public.link_party_accounts(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlink_party_accounts(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_customer_for_supplier(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_supplier_for_customer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_party_netting(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_party_settlement(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.link_party_accounts(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_party_accounts(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_customer_for_supplier(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_supplier_for_customer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_party_netting(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_party_settlement(uuid) TO authenticated;

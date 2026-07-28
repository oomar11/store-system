-- Party payments with FIFO invoice allocation (collect from customer / pay supplier)

CREATE TABLE IF NOT EXISTS public.party_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_type TEXT NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  party_id UUID NOT NULL,
  amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  safe_id UUID NOT NULL REFERENCES public.safes(id),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_party_payments_party
  ON public.party_payments (party_type, party_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.party_payment_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id UUID NOT NULL REFERENCES public.party_payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_party_payment_allocations_payment
  ON public.party_payment_allocations (payment_id);

CREATE INDEX IF NOT EXISTS idx_party_payment_allocations_invoice
  ON public.party_payment_allocations (invoice_id);

ALTER TABLE public.party_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_payments_select ON public.party_payments;
DROP POLICY IF EXISTS party_payments_insert ON public.party_payments;
DROP POLICY IF EXISTS party_payments_delete ON public.party_payments;
DROP POLICY IF EXISTS party_payment_allocations_select ON public.party_payment_allocations;
DROP POLICY IF EXISTS party_payment_allocations_insert ON public.party_payment_allocations;
DROP POLICY IF EXISTS party_payment_allocations_delete ON public.party_payment_allocations;

CREATE POLICY party_payments_select ON public.party_payments
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.has_app_permission('customers')
      OR public.has_app_permission('suppliers')
      OR public.has_app_permission('treasury')
      OR public.has_app_permission('reports')
    )
  );

CREATE POLICY party_payments_insert ON public.party_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

CREATE POLICY party_payments_delete ON public.party_payments
  FOR DELETE TO authenticated
  USING (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

CREATE POLICY party_payment_allocations_select ON public.party_payment_allocations
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.has_app_permission('customers')
      OR public.has_app_permission('suppliers')
      OR public.has_app_permission('treasury')
      OR public.has_app_permission('reports')
    )
  );

CREATE POLICY party_payment_allocations_insert ON public.party_payment_allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

CREATE POLICY party_payment_allocations_delete ON public.party_payment_allocations
  FOR DELETE TO authenticated
  USING (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

COMMENT ON TABLE public.party_payments IS
  'Bulk collect/pay against a customer or supplier; allocated FIFO to open invoices.';
COMMENT ON TABLE public.party_payment_allocations IS
  'Links a party_payment amount slice to a specific invoice paid_amount increase.';

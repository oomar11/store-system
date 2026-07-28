-- Allow updating party_payments (edit amount / safe / notes)

DROP POLICY IF EXISTS party_payments_update ON public.party_payments;
CREATE POLICY party_payments_update ON public.party_payments
  FOR UPDATE TO authenticated
  USING (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  )
  WITH CHECK (
    public.has_app_permission('customers.write')
    OR public.has_app_permission('suppliers')
    OR public.has_app_permission('treasury')
  );

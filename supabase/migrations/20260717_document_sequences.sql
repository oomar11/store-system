-- =========================================================================
-- Atomic sequential document numbers (invoices, documents, counts, returns)
-- Format: PREFIX-YYMM-####  (e.g. INV-2607-0001)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.document_sequences (
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  last_value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, period),
  CONSTRAINT document_sequences_period_format CHECK (period ~ '^[0-9]{4}$'),
  CONSTRAINT document_sequences_last_value_nonneg CHECK (last_value >= 0)
);

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

-- No policies: clients cannot read/write sequences directly; only via RPC.

CREATE OR REPLACE FUNCTION public.next_document_number(p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := lower(trim(p_kind));
  v_prefix text;
  v_period text;
  v_next bigint;
  v_pad int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  v_prefix := CASE v_kind
    WHEN 'sale' THEN 'INV'
    WHEN 'purchase' THEN 'PUR'
    WHEN 'quote' THEN 'QT'
    WHEN 'purchase_order' THEN 'PO'
    WHEN 'sale_return' THEN 'RET'
    WHEN 'purchase_return' THEN 'PRR'
    WHEN 'inventory_count' THEN 'CNT'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'نوع المستند غير صالح: %', p_kind;
  END IF;

  -- Business day in Egypt
  v_period := to_char((now() AT TIME ZONE 'Africa/Cairo'), 'YYMM');

  INSERT INTO public.document_sequences AS ds (kind, period, last_value)
  VALUES (v_kind, v_period, 1)
  ON CONFLICT (kind, period)
  DO UPDATE SET last_value = ds.last_value + 1
  RETURNING ds.last_value INTO v_next;

  v_pad := GREATEST(4, length(v_next::text));
  RETURN v_prefix || '-' || v_period || '-' || lpad(v_next::text, v_pad, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_document_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_document_number(text) TO authenticated;

-- Seed counters from existing numbers so new seqs never collide with UNIQUE
WITH extracted AS (
  SELECT
    'sale'::text AS kind,
    substring(invoice_number FROM '^INV-([0-9]{4})-') AS period,
    NULLIF(substring(invoice_number FROM '^INV-[0-9]{4}-([0-9]+)$'), '')::bigint AS n
  FROM public.invoices
  WHERE type = 'sale' AND invoice_number ~ '^INV-[0-9]{4}-[0-9]+$'

  UNION ALL
  SELECT
    'purchase',
    substring(invoice_number FROM '^PUR-([0-9]{4})-'),
    NULLIF(substring(invoice_number FROM '^PUR-[0-9]{4}-([0-9]+)$'), '')::bigint
  FROM public.invoices
  WHERE type = 'purchase' AND invoice_number ~ '^PUR-[0-9]{4}-[0-9]+$'

  UNION ALL
  SELECT
    'sale_return',
    substring(invoice_number FROM '^RET-([0-9]{4})-'),
    NULLIF(substring(invoice_number FROM '^RET-[0-9]{4}-([0-9]+)$'), '')::bigint
  FROM public.invoices
  WHERE type = 'sale_return' AND invoice_number ~ '^RET-[0-9]{4}-[0-9]+$'

  UNION ALL
  SELECT
    'purchase_return',
    substring(invoice_number FROM '^PRR-([0-9]{4})-'),
    NULLIF(substring(invoice_number FROM '^PRR-[0-9]{4}-([0-9]+)$'), '')::bigint
  FROM public.invoices
  WHERE type = 'purchase_return' AND invoice_number ~ '^PRR-[0-9]{4}-[0-9]+$'

  UNION ALL
  SELECT
    'quote',
    substring(document_number FROM '^QT-([0-9]{4})-'),
    NULLIF(substring(document_number FROM '^QT-[0-9]{4}-([0-9]+)$'), '')::bigint
  FROM public.documents
  WHERE type = 'quote' AND document_number ~ '^QT-[0-9]{4}-[0-9]+$'

  UNION ALL
  SELECT
    'purchase_order',
    substring(document_number FROM '^PO-([0-9]{4})-'),
    NULLIF(substring(document_number FROM '^PO-[0-9]{4}-([0-9]+)$'), '')::bigint
  FROM public.documents
  WHERE type = 'purchase_order' AND document_number ~ '^PO-[0-9]{4}-[0-9]+$'

  UNION ALL
  SELECT
    'inventory_count',
    substring(count_number FROM '^CNT-([0-9]{4})-'),
    NULLIF(substring(count_number FROM '^CNT-[0-9]{4}-([0-9]+)$'), '')::bigint
  FROM public.inventory_counts
  WHERE count_number ~ '^CNT-[0-9]{4}-[0-9]+$'
)
INSERT INTO public.document_sequences (kind, period, last_value)
SELECT kind, period, MAX(n)
FROM extracted
WHERE period IS NOT NULL AND n IS NOT NULL
GROUP BY kind, period
ON CONFLICT (kind, period)
DO UPDATE SET last_value = GREATEST(
  public.document_sequences.last_value,
  EXCLUDED.last_value
);

-- Include sequences in wipe when the function exists
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'wipe_business_data'
  LIMIT 1;

  IF v_def IS NULL THEN
    RETURN;
  END IF;

  -- Recreate wipe with document_sequences + known business tables
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION wipe_business_data()
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    BEGIN
      TRUNCATE TABLE
        inventory_count_items,
        inventory_counts,
        invoice_items,
        invoices,
        document_items,
        documents,
        journal_lines,
        journal_entries,
        safe_transactions,
        products,
        categories,
        customers,
        suppliers,
        safes,
        accounts,
        settings,
        document_sequences
      CASCADE;
    END;
    $body$;
  $fn$;

  REVOKE ALL ON FUNCTION wipe_business_data() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION wipe_business_data() TO service_role;
END;
$$;
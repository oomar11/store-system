-- Fix PostgREST HTTP 300 on rpc/next_document_number when both overloads
-- match a single-argument call (2-arg had DEFAULT NULL).
-- Keep a clear 1-arg wrapper + 2-arg implementation (no DEFAULT on 2-arg).

DROP FUNCTION IF EXISTS public.next_document_number(text);
DROP FUNCTION IF EXISTS public.next_document_number(text, timestamptz);

CREATE OR REPLACE FUNCTION public.next_document_number(
  p_kind text,
  p_at timestamptz
)
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
  v_at timestamptz := COALESCE(p_at, NOW());
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

  v_period := to_char((v_at AT TIME ZONE 'Africa/Cairo'), 'YYMM');

  INSERT INTO public.document_sequences AS ds (kind, period, last_value)
  VALUES (v_kind, v_period, 1)
  ON CONFLICT (kind, period)
  DO UPDATE SET last_value = ds.last_value + 1
  RETURNING ds.last_value INTO v_next;

  v_pad := GREATEST(4, length(v_next::text));
  RETURN v_prefix || '-' || v_period || '-' || lpad(v_next::text, v_pad, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_document_number(p_kind text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.next_document_number(p_kind, NULL::timestamptz);
$$;

REVOKE ALL ON FUNCTION public.next_document_number(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_document_number(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_document_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_document_number(text, timestamptz) TO authenticated;

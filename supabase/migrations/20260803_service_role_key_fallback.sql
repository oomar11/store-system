-- Persist service role key for hosts missing Vercel SUPABASE_SERVICE_ROLE_KEY.
-- Readable only via SECURITY DEFINER RPC with a server-side proof (not exposed to clients).

ALTER TABLE telegram_config
  ADD COLUMN IF NOT EXISTS service_role_key TEXT;

CREATE OR REPLACE FUNCTION public.fetch_service_role_key(proof text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected constant text := 'store-jarvis-service-proof-v1';
  result text;
BEGIN
  IF proof IS DISTINCT FROM expected THEN
    RETURN NULL;
  END IF;

  SELECT service_role_key
    INTO result
  FROM telegram_config
  WHERE id = 'b0000000-0000-0000-0000-000000000001';

  RETURN NULLIF(trim(result), '');
END;
$$;

REVOKE ALL ON FUNCTION public.fetch_service_role_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_service_role_key(text) TO anon, authenticated, service_role;

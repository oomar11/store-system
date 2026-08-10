-- Allow workshop bridge auth without SUPABASE_SERVICE_ROLE_KEY on the app server.
-- Secrets are never returned to clients; only configured/check booleans.

CREATE OR REPLACE FUNCTION public.workshop_bridge_is_configured()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT trim(COALESCE(bridge_secret, ''))
  INTO v_secret
  FROM public.workshop_bridge_config
  WHERE id = 'c0000000-0000-0000-0000-000000000001';

  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN false;
  END IF;
  -- Revoked leaked default
  IF v_secret = 'windoor-workshop-bridge-2026-rho' THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.workshop_bridge_check_secret(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_provided text := trim(COALESCE(p_secret, ''));
BEGIN
  IF v_provided = '' THEN
    RETURN false;
  END IF;
  IF v_provided = 'windoor-workshop-bridge-2026-rho' THEN
    RETURN false;
  END IF;

  SELECT trim(COALESCE(bridge_secret, ''))
  INTO v_secret
  FROM public.workshop_bridge_config
  WHERE id = 'c0000000-0000-0000-0000-000000000001';

  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN false;
  END IF;
  IF v_secret = 'windoor-workshop-bridge-2026-rho' THEN
    RETURN false;
  END IF;

  -- Constant-time-ish compare for equal lengths
  IF length(v_secret) <> length(v_provided) THEN
    RETURN false;
  END IF;
  RETURN v_secret = v_provided;
END;
$$;

REVOKE ALL ON FUNCTION public.workshop_bridge_is_configured() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workshop_bridge_check_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workshop_bridge_is_configured() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workshop_bridge_check_secret(text) TO anon, authenticated, service_role;

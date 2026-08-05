-- Workshop bridge secret (survives factory reset; service_role / API only)

CREATE TABLE IF NOT EXISTS workshop_bridge_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bridge_secret TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workshop_bridge_config (id, bridge_secret)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'windoor-workshop-bridge-2026-rho'
)
ON CONFLICT (id) DO UPDATE
SET
  bridge_secret = COALESCE(workshop_bridge_config.bridge_secret, EXCLUDED.bridge_secret),
  updated_at = NOW();

ALTER TABLE workshop_bridge_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access" ON workshop_bridge_config;
-- Intentionally no authenticated policies — only service_role bypasses RLS

COMMENT ON TABLE workshop_bridge_config IS
  'Shared secret for UPVC workshop → store treasury bridge';

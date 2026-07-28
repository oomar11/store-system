-- Telegram bot config (survives factory reset; not part of business data wipe)

CREATE TABLE IF NOT EXISTS telegram_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_token TEXT,
  chat_id TEXT,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single-row sentinel
INSERT INTO telegram_config (id, bot_token, chat_id)
VALUES ('b0000000-0000-0000-0000-000000000001', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE telegram_config ENABLE ROW LEVEL SECURITY;

-- No direct client access to tokens; service_role / API only
DROP POLICY IF EXISTS "No public access" ON telegram_config;
-- Intentionally no authenticated policies — only service_role bypasses RLS

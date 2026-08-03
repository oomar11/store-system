-- Store Gemini API key with telegram config (service_role only; survives factory reset)

ALTER TABLE telegram_config
  ADD COLUMN IF NOT EXISTS gemini_api_key TEXT;

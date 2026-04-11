-- RecallMEM 006_usage -- track API usage and estimated costs
-- Idempotent. Safe to run on existing databases.

CREATE TABLE IF NOT EXISTS s2m_usage (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     TEXT NOT NULL DEFAULT 'local-user',
  provider    TEXT NOT NULL,          -- 'openai', 'anthropic', 'xai', 'deepgram', 'ollama'
  service     TEXT NOT NULL,          -- 'chat', 'tts', 'stt'
  model       TEXT,                   -- model name used
  units       INTEGER NOT NULL,       -- tokens, characters, or milliseconds
  unit_type   TEXT NOT NULL,          -- 'tokens_in', 'tokens_out', 'characters', 'ms'
  cost_cents  NUMERIC(10,4) DEFAULT 0, -- estimated cost in cents
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_s2m_usage_user_date ON s2m_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_s2m_usage_user_service ON s2m_usage (user_id, service, created_at DESC);

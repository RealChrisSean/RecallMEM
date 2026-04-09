-- Generic per-user key/value settings store. Used for things like the
-- Brave Search API key, which we don't want to force normal users to
-- paste into .env.local. Future settings (default model, retention
-- policy, etc.) can use the same table.

CREATE TABLE IF NOT EXISTS s2m_settings (
  user_id     TEXT NOT NULL DEFAULT 'local-user',
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

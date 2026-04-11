-- RecallMEM 005_brains -- persist brain namespaces in the database
-- Idempotent. Safe to run on existing databases.

CREATE TABLE IF NOT EXISTS s2m_brains (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     TEXT NOT NULL DEFAULT 'local-user',
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '🧠',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_s2m_brains_user_name ON s2m_brains (user_id, name);

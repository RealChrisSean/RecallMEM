-- RecallMEM 009_luma_generations -- persist Luma image jobs and outputs.
-- Luma output URLs expire after one hour, so completed images are stored
-- locally in Postgres as bytea and served through a local route.

CREATE TABLE IF NOT EXISTS s2m_luma_generations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               TEXT NOT NULL DEFAULT 'local-user',
  chat_id               UUID REFERENCES s2m_chats(id) ON DELETE CASCADE,
  luma_generation_id    TEXT NOT NULL,
  prompt                TEXT NOT NULL,
  aspect_ratio          TEXT,
  style                 TEXT NOT NULL DEFAULT 'auto',
  output_format         TEXT,
  web_search            BOOLEAN NOT NULL DEFAULT FALSE,
  state                 TEXT NOT NULL DEFAULT 'queued',
  failure_reason        TEXT,
  failure_code          TEXT,
  request_id            TEXT,
  api_version           TEXT,
  rate_limit_limit      INTEGER,
  rate_limit_remaining  INTEGER,
  rate_limit_reset      INTEGER,
  output_url            TEXT,
  local_image           BYTEA,
  local_mime_type       TEXT,
  local_size            INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_s2m_luma_generations_remote
  ON s2m_luma_generations (luma_generation_id);

CREATE INDEX IF NOT EXISTS idx_s2m_luma_generations_user_created
  ON s2m_luma_generations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_s2m_luma_generations_chat
  ON s2m_luma_generations (chat_id, created_at ASC);

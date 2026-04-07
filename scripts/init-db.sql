-- Speak2Me Personal -- Postgres schema
-- Single user, local install. Run once: psql speak2me_personal -f scripts/init-db.sql

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Chat sessions (one row per saved conversation)
CREATE TABLE IF NOT EXISTS s2m_chats (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       TEXT NOT NULL DEFAULT 'local-user',
  title         TEXT,
  transcript    TEXT,                     -- full conversation text, role-prefixed
  message_count INTEGER NOT NULL DEFAULT 0,
  model_mode    TEXT NOT NULL DEFAULT 'standard', -- 'standard' or 'unrestricted'
  is_pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_s2m_chats_user_created ON s2m_chats (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_s2m_chats_pinned ON s2m_chats (user_id, is_pinned, updated_at DESC);

-- Extracted facts (long-term memory)
CREATE TABLE IF NOT EXISTS s2m_user_facts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         TEXT NOT NULL DEFAULT 'local-user',
  fact_text       TEXT NOT NULL,
  category        TEXT NOT NULL,           -- identity, family, work, preferences, etc.
  source_chat_id  UUID REFERENCES s2m_chats(id) ON DELETE CASCADE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_by   UUID REFERENCES s2m_user_facts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_s2m_facts_user_active ON s2m_user_facts (user_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_s2m_facts_category ON s2m_user_facts (user_id, category) WHERE is_active = TRUE;

-- Synthesized profile (compact summary the LLM sees every conversation)
CREATE TABLE IF NOT EXISTS s2m_user_profiles (
  user_id              TEXT PRIMARY KEY DEFAULT 'local-user',
  profile_summary      TEXT,
  cached_context       TEXT,
  custom_instructions  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transcript chunks for vector search (semantic retrieval over past conversations)
CREATE TABLE IF NOT EXISTS s2m_transcript_chunks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     TEXT NOT NULL DEFAULT 'local-user',
  chat_id     UUID NOT NULL REFERENCES s2m_chats(id) ON DELETE CASCADE,
  chunk_text  TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding   vector(768),                -- EmbeddingGemma-300M dimension
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_s2m_chunks_user ON s2m_transcript_chunks (user_id);

-- HNSW index for fast cosine similarity vector search
CREATE INDEX IF NOT EXISTS idx_s2m_chunks_embedding
  ON s2m_transcript_chunks
  USING hnsw (embedding vector_cosine_ops);

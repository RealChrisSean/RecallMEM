-- RecallMEM 013_wiki_sources -- source-grounded wiki chunks per brain
-- Idempotent. Safe to run on existing databases.

CREATE TABLE IF NOT EXISTS s2m_wiki_sources (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          TEXT NOT NULL DEFAULT 'local-user',
  brain_name       TEXT NOT NULL DEFAULT 'default',
  title            TEXT NOT NULL,
  source_kind      TEXT NOT NULL DEFAULT 'manual',
  uri              TEXT,
  source_ref       TEXT,
  content_hash     TEXT,
  last_ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_s2m_wiki_sources_user_brain
  ON s2m_wiki_sources (user_id, brain_name, updated_at DESC);

CREATE TABLE IF NOT EXISTS s2m_wiki_documents (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      TEXT NOT NULL DEFAULT 'local-user',
  source_id    UUID NOT NULL REFERENCES s2m_wiki_sources(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  path         TEXT NOT NULL,
  uri          TEXT,
  source_ref   TEXT,
  content_hash TEXT NOT NULL,
  line_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_s2m_wiki_documents_source_path
  ON s2m_wiki_documents (source_id, path);

CREATE INDEX IF NOT EXISTS idx_s2m_wiki_documents_user_source
  ON s2m_wiki_documents (user_id, source_id);

CREATE TABLE IF NOT EXISTS s2m_wiki_chunks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       TEXT NOT NULL DEFAULT 'local-user',
  source_id     UUID NOT NULL REFERENCES s2m_wiki_sources(id) ON DELETE CASCADE,
  document_id   UUID NOT NULL REFERENCES s2m_wiki_documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  chunk_text    TEXT NOT NULL,
  line_start    INTEGER NOT NULL,
  line_end      INTEGER NOT NULL,
  section_title TEXT,
  citation      TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  embedding     vector(768),
  embedding_oai vector(256),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_s2m_wiki_chunks_document_index
  ON s2m_wiki_chunks (document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_s2m_wiki_chunks_user
  ON s2m_wiki_chunks (user_id);

CREATE INDEX IF NOT EXISTS idx_s2m_wiki_chunks_text
  ON s2m_wiki_chunks
  USING GIN (to_tsvector('simple', chunk_text));

CREATE INDEX IF NOT EXISTS idx_s2m_wiki_chunks_embedding
  ON s2m_wiki_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_s2m_wiki_chunks_embedding_oai
  ON s2m_wiki_chunks
  USING hnsw (embedding_oai vector_cosine_ops);

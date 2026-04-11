-- RecallMEM 007_fact_embeddings -- vector search on facts
-- Idempotent. Safe to run on existing databases.

ALTER TABLE s2m_user_facts ADD COLUMN IF NOT EXISTS embedding vector(768);

CREATE INDEX IF NOT EXISTS idx_s2m_facts_embedding
  ON s2m_user_facts
  USING hnsw (embedding vector_cosine_ops);

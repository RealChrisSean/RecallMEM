-- RecallMEM 008_openai_embeddings -- second embedding column for OpenAI 256-dim vectors
-- Idempotent. Safe to run on existing databases.

ALTER TABLE s2m_user_facts ADD COLUMN IF NOT EXISTS embedding_oai vector(256);
ALTER TABLE s2m_transcript_chunks ADD COLUMN IF NOT EXISTS embedding_oai vector(256);

CREATE INDEX IF NOT EXISTS idx_s2m_facts_embedding_oai
  ON s2m_user_facts
  USING hnsw (embedding_oai vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_s2m_chunks_embedding_oai
  ON s2m_transcript_chunks
  USING hnsw (embedding_oai vector_cosine_ops);

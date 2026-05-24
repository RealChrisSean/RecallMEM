-- Hybrid memory retrieval needs both semantic vectors and deterministic text
-- search. Full text handles normal words; trigram indexes keep exact substring
-- lookups fast for model IDs, branch names, error fragments, and receipts.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_s2m_facts_fts
  ON s2m_user_facts
  USING GIN (
    to_tsvector('simple', coalesce(fact_text, '') || ' ' || coalesce(supporting_quote, ''))
  );

CREATE INDEX IF NOT EXISTS idx_s2m_facts_text_trgm
  ON s2m_user_facts
  USING GIN (
    (coalesce(fact_text, '') || ' ' || coalesce(supporting_quote, '')) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_s2m_chunks_fts
  ON s2m_transcript_chunks
  USING GIN (to_tsvector('simple', chunk_text));

CREATE INDEX IF NOT EXISTS idx_s2m_chunks_text_trgm
  ON s2m_transcript_chunks
  USING GIN (chunk_text gin_trgm_ops);

-- Store the transcript evidence that justified an extracted memory.
-- The extractor now requires a direct quote before it will persist a fact.

ALTER TABLE s2m_user_facts
  ADD COLUMN IF NOT EXISTS supporting_quote TEXT,
  ADD COLUMN IF NOT EXISTS source_message_index INTEGER;

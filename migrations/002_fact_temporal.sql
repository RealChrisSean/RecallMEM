-- Add temporal columns to facts so we can track when a fact was true and
-- when (if ever) it was superseded by a contradicting fact. The
-- superseded_by column already exists from 001 but was never wired up.
--
-- valid_from defaults to the row's created_at so existing facts are
-- treated as valid since their original insert.
-- valid_to is NULL while a fact is current; set when superseded.

ALTER TABLE s2m_user_facts ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
ALTER TABLE s2m_user_facts ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ;

-- Backfill valid_from for existing rows
UPDATE s2m_user_facts SET valid_from = created_at WHERE valid_from IS NULL;

-- Make valid_from NOT NULL going forward
ALTER TABLE s2m_user_facts ALTER COLUMN valid_from SET DEFAULT NOW();
ALTER TABLE s2m_user_facts ALTER COLUMN valid_from SET NOT NULL;

-- Index for "what was true at time X" queries (future use)
CREATE INDEX IF NOT EXISTS idx_s2m_facts_temporal
  ON s2m_user_facts (user_id, valid_from DESC)
  WHERE is_active = TRUE;

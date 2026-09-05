-- Add an explicit trust lifecycle to extracted memory claims.
-- Existing rows retain their current active/retired behavior. New model
-- proposals can now wait for review before becoming eligible for recall.

ALTER TABLE s2m_user_facts
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS recall_eligible BOOLEAN,
  ADD COLUMN IF NOT EXISTS origin TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE s2m_user_facts
SET status = CASE WHEN is_active THEN 'active' ELSE 'retired' END
WHERE status IS NULL;

UPDATE s2m_user_facts
SET recall_eligible = is_active
WHERE recall_eligible IS NULL;

UPDATE s2m_user_facts SET origin = 'legacy' WHERE origin IS NULL;
UPDATE s2m_user_facts SET confirmed_by = 'legacy' WHERE confirmed_by IS NULL;
UPDATE s2m_user_facts SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE s2m_user_facts
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN recall_eligible SET DEFAULT TRUE,
  ALTER COLUMN recall_eligible SET NOT NULL,
  ALTER COLUMN origin SET DEFAULT 'model',
  ALTER COLUMN origin SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 's2m_user_facts_status_check'
      AND conrelid = 's2m_user_facts'::regclass
  ) THEN
    ALTER TABLE s2m_user_facts
      ADD CONSTRAINT s2m_user_facts_status_check
      CHECK (status IN ('active', 'pending', 'disputed', 'retired'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS s2m_fact_supersession_proposals (
  old_fact_id         UUID NOT NULL REFERENCES s2m_user_facts(id) ON DELETE CASCADE,
  replacement_fact_id UUID NOT NULL REFERENCES s2m_user_facts(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (old_fact_id, replacement_fact_id),
  CHECK (old_fact_id <> replacement_fact_id)
);

CREATE INDEX IF NOT EXISTS idx_s2m_facts_user_status
  ON s2m_user_facts (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_s2m_fact_proposals_replacement
  ON s2m_fact_supersession_proposals (replacement_fact_id);

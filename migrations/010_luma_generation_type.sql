-- RecallMEM 010_luma_generation_type -- record whether Luma jobs are
-- text-to-image generations or source-image edits.

ALTER TABLE s2m_luma_generations
  ADD COLUMN IF NOT EXISTS generation_type TEXT NOT NULL DEFAULT 'image';

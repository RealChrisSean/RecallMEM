-- Track which model + provider was used for each chat. Used by the
-- post-chat finalize pipeline to extract facts using the same LLM the
-- user was actually chatting with, instead of a hardcoded FAST_MODEL.
--
-- Both columns are nullable. NULL means "use the default" (built-in
-- local Ollama with the env-configured model).

ALTER TABLE s2m_chats ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE s2m_chats ADD COLUMN IF NOT EXISTS provider_id UUID
  REFERENCES s2m_llm_providers(id) ON DELETE SET NULL;

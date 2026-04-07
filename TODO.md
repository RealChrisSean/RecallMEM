# Speak2Me Personal -- TODO

## Phase 2: Memory System (next up)
- [ ] Save chats to `s2m_chats` table when conversation ends or after each message
- [ ] Auto-generate chat title using Gemma 4 (small prompt, fast)
- [ ] Extract facts from conversations and store in `s2m_user_facts`
- [ ] Synthesize/update profile from facts after each chat
- [ ] Generate transcript chunk embeddings via EmbeddingGemma, store in `s2m_transcript_chunks`
- [ ] Wire memory loading into chat endpoint (profile + facts + vector search)
- [ ] Build a system prompt that uses the memory context (port from `_reference/lib-source-prompts.ts`)

## Phase 3: Chat History UI
- [ ] Sidebar with list of past chats grouped by date
- [ ] Click to view a past chat transcript
- [ ] Delete chat (cascading: removes facts, chunks, profile re-synthesizes)
- [ ] Memory inspector page showing profile + all facts

## Phase 4: Unrestricted Mode (vMLX setup)
- [ ] Install vMLX 1.3.26+ on Mac
- [ ] Download `dealignai/Gemma-4-31B-JANG_4M-CRACK` from Hugging Face (~18GB)
- [ ] Run vMLX server on port 8080
- [ ] Test API compatibility with our `lib/llm.ts` Ollama-compatible client
- [ ] Re-enable the Standard/Unrestricted toggle in `app/page.tsx` (currently hidden)
- [ ] Test mode switching mid-conversation works
- [ ] Verify shared memory across both modes

## Phase 5: Polish
- [ ] First-run setup wizard (check Postgres + Ollama installed)
- [ ] Settings page (model picker, default mode, memory retention)
- [ ] Export all data as JSON
- [ ] Wipe everything button (with confirmation)
- [ ] README with install/run instructions

## Phase 6: Voice (much later)
- [ ] Whisper integration for STT
- [ ] Piper integration for TTS
- [ ] Local WebSocket voice server
- [ ] Voice mode toggle in chat UI
- [ ] Reuse same memory system (voice + chat share memory)

## Done
- [x] Fresh Next.js 16 app set up
- [x] Postgres 17 + pgvector running locally
- [x] Schema created (s2m_chats, s2m_user_facts, s2m_user_profiles, s2m_transcript_chunks)
- [x] EmbeddingGemma 300M working via Ollama (768 dim)
- [x] Gemma 4 31B downloaded and tested
- [x] `lib/db.ts`, `lib/embeddings.ts`, `lib/llm.ts`, `lib/types.ts`
- [x] Streaming chat API endpoint
- [x] Chat UI with auto-scroll, streaming responses, model toggle component
- [x] Disabled Gemma 4 thinking mode for ~3x faster responses
- [x] Hide Unrestricted toggle until vMLX is set up

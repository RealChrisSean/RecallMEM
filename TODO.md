# RecallMEM TODO

What's done, what's planned. Updated as of v0.1 prep.

---

## Deepgram voice agent roadmap

Process rule for these changes:

- [ ] Work through this list one item at a time.
- [ ] Before moving to the next item, test the current item end-to-end.
- [ ] Do not start the next item until Chris approves it.

Planned voice-agent upgrades:

- [x] **Switch voice STT from Nova-3 to Flux.** Use `flux-general-en` as the default voice-agent listener model because Flux is designed for lower-latency conversational turn detection. Consider `flux-general-multi` when multilingual mode is enabled.
- [x] **Evaluate Deepgram Browser Agent SDK pieces.** Adopt `@deepgram/agents` for microphone capture and PCM playback while keeping RecallMEM's custom WebSocket/session bridge for auth fallback, memory tool calls, and chat persistence.
- [x] **Add LLM and TTS fallback chains.** Configure voice-agent `think` and `speak` providers as ordered fallback arrays so transient model/provider failures do not kill the live voice session.
- [x] **Add Deepgram voice settings.** Let users choose voice, speaking speed, and speaking style in Settings, with pronunciation guidance for app-specific terms like `RecallMEM`, `pgvector`, `Fly.io`, model names, and user names.
- [ ] **Add model-mode support for text chat.** Let users choose richer chat model modes without making voice slow:
  - OpenAI chat modes: `GPT-5.5 Instant` (`gpt-5.5` with lowest/none reasoning), `GPT-5.5 Thinking` (`gpt-5.5` with medium/high reasoning), `GPT-5.5 Deep` (`gpt-5.5` with `xhigh` reasoning), and `GPT-5.5 Pro` (`gpt-5.5-pro`, text chat only because it can take minutes).
  - Anthropic chat modes: `Claude Opus 4.8 Instant` (omit `thinking`), `Claude Opus 4.8 Adaptive` (`thinking: { type: "adaptive" }`), and adaptive low/medium/high/xhigh via `output_config.effort`.
  - Add model metadata for `supportsChat`, `supportsVoice`, `supportsReasoning`, provider mode, and whether a mode needs the OpenAI Responses API.
  - Add an OpenAI Responses API path for GPT reasoning/pro modes.
  - Add Anthropic adaptive thinking support in the native Messages API path.
  - Force Voice Agent to use the fastest compatible voice model even when text chat is set to Pro or deep/adaptive reasoning.
- [x] **Add dead-air filler during memory/tool calls.** Use Deepgram agent message injection to say short status lines like "Let me check your memory for that" while memory search or tools are running.
- [x] **Feed memory keyterms into STT.** Pull names, projects, model IDs, companies, and weird exact phrases from RecallMEM memory into Deepgram keyterms so voice transcription catches important terms more reliably.
- [x] **Audit audio output quality.** Verify output encoding, sample rate, playback buffer handling, and raw PCM/container settings so voice playback avoids static, clicks, overlap, and phone-call quality.
- [ ] **Add multilingual/code-switching mode.** Support Deepgram multilingual Flux where appropriate, while documenting that first-party Filipino/Tagalog Aura voice support may require prompt tuning or another TTS provider.
- [ ] **Skip diarization for the live agent for now.** Diarization v2 is useful for recorded multi-speaker audio, but it is not a priority for our current one-person live voice-agent flow.

---

## Repo safety roadmap

- [ ] **Add secret/data leak prevention.** Add a `gitleaks` config, local pre-commit/pre-push checks, and a GitHub Action so API keys, database URLs, dumps, private notes, and other sensitive files are blocked before they can reach GitHub. Keep Sprite deploys based on `git ls-files` so ignored files like `.env.local`, `DEVLOG.md`, local DB data, `.next`, and `node_modules` never upload.

---

## Memory reliability roadmap

Top priority items before we make bigger memory changes:

- [x] **Evidence-backed extraction.** Require each candidate fact to include a `supporting_quote` or `source_message_index`, then only store it if TypeScript verifies the evidence exists in the transcript.
- [x] **Hybrid retrieval.** Combine pgvector semantic search with Postgres full-text search so exact names, project titles, numbers, and weird phrases are not missed.
- [x] **Temporal grounding.** Convert "today", "next week", "last month", and similar relative dates into concrete dates based on the conversation timestamp.
- [ ] **Stronger supersession links.** When a new fact replaces an old one, link the old fact to the replacement fact instead of only marking the old one inactive.
- [ ] **Memory eval suite.** Create test transcripts with expected facts and retrieval results so prompt/retrieval changes do not silently regress memory quality.

Additional memory improvements:

- [ ] **Entity memory.** Extract and link people, companies, projects, locations, products, and recurring topics so related memories can be found even when wording changes.
- [ ] **Confidence and provenance.** Store where each fact came from, when it was observed, what quote supported it, and optionally a confidence score.
- [ ] **Memory review UI.** Show "new memories learned from this chat" and let the user approve, edit, pin, or reject them.
- [ ] **Assistant-action memories.** Selectively remember useful plans, recommendations, and decisions the assistant helped create, not just facts directly stated by the user.
- [ ] **Retrieval scoring transparency.** Show why a memory was used, such as exact keyword match, semantic similarity, or matched entity.

---

## v0.1 (current, not shipped yet)

Things to do before the public launch.

- [ ] Test the `npx recallmem` first-run flow on a clean machine (no `~/.recallmem`, no DB)
- [ ] Add Windows path candidates to `bin/lib/detect.js` (psql.exe locations)
- [ ] Fix browser open command for Windows (`cmd /c start` instead of `start`)
- [ ] Update README to be honest about Windows status (works in WSL2, native untested)
- [ ] Record a demo GIF and add to the README hero
- [ ] Push to npm with `npm run publish:npm` (the publish/ folder is ready)
- [ ] Make the GitHub repo public
- [ ] Post somewhere (Hacker News? r/LocalLLaMA? X?)

## v0.2 (next)

The features that I want next but didn't make v0.1.

### Voice (the easy version, browser-based)
- [ ] **Mic button** in the chat input. Click to dictate via browser's `SpeechRecognition` API. Recognized text appears in the input field, you review and hit send like normal. Add a clear note that browser speech recognition isn't local (it goes to Google/Apple servers for transcription).
- [ ] **Speaker icon** on every assistant message. Click to read it aloud via browser's `SpeechSynthesis` API. Uses macOS system voices (fully local on Mac). Click again to stop.
- [ ] Settings option to pick which voice to use (filter by quality, language, etc.)

### Search across past chats
- [ ] Search box in the sidebar that does keyword + vector search over all past transcripts
- [ ] Highlight matching chats in the sidebar list
- [ ] "Jump to message" when clicking a search result

### Quality of life
- [ ] **Copy message button** on hover for any chat message
- [ ] **Stop streaming button** to cancel a long response mid-stream
- [ ] **Rename chat title** by clicking it in the chat header
- [ ] **Code syntax highlighting** in markdown messages (drop in `react-syntax-highlighter`)

### Easier install
- [ ] **Docker Compose for Postgres + Next.js** (Option A from the design discussion). One `docker compose up` removes the Postgres + pgvector install pain. Ollama still runs on host so Mac users keep Metal acceleration. Skip the all-in-one container approach because containerized Ollama on Mac loses GPU and drops generation from ~30 tok/s to ~5-8 tok/s, which defeats the entire local-LLM use case.

### External databases
- [ ] **Connect to external Postgres-compatible databases** (Lakebase, Neon, Supabase, CockroachDB, Yugabyte, etc). Settings page field where the user pastes a connection string. Test connection button. Migrations run against the remote DB. The `configureDb({ pool })` architecture already supports swapping the pool. The missing piece is a UI for it and hot-reloading the pool at runtime without restarting the server.

## v0.3 (later)

### Export / backup / migration
- [ ] **Export/Import via Settings UI.** One-click export button that dumps all data (chats, facts, profile, brains, providers, settings, embeddings) as a single file. Import button that restores from that file on another machine. Transfer your entire RecallMEM from one computer to another without touching the terminal. Currently possible via `pg_dump`/`pg_restore` but normal users shouldn't need to know that.
- [ ] Export everything as JSON for backups (`npx recallmem export > backup.json`)
- [ ] Import from JSON (`npx recallmem import backup.json`)
- [ ] Settings page with retention policies (auto-delete chats older than X days)

### Better cloud provider support
- [ ] **OpenAI vision** support (currently only Ollama and Anthropic vision work)
- [ ] **Reasoning model support** (OpenAI o1/o3, Claude extended thinking) with their different API parameters
- [ ] More OpenAI-compatible presets (Groq, Together, OpenRouter quick-pick)

## v1.0 (much later)

### Real voice mode (the local version)
- [ ] Replace browser `SpeechRecognition` with a local Whisper backend (whisper.cpp or transformers.js in-browser)
- [ ] Real-time streaming voice mode (not just dictation) with VAD
- [ ] Local TTS via Piper instead of browser SpeechSynthesis (cross-platform parity)
- [ ] Voice mode toggle in chat UI
- [ ] Shared memory across voice and text (already true since they hit the same backend)

### Knowledge graph
- [ ] Neo4j or in-memory graph layer that turns flat facts into typed relationships (Person, Place, Topic, etc.)
- [ ] 3D graph visualization page showing your memory as a network
- [ ] Click a node to see all chats connected to it

### Multi-user / self-hosted SaaS
- [ ] Auth system (probably not for v1.0, this is a different product)
- [ ] Per-user data isolation
- [ ] Admin panel
- [ ] (Honestly, maybe this is a separate fork rather than something RecallMEM does)

## Won't do

Things people might ask for that I don't plan to build:

- **Telemetry / analytics** -- ever. RecallMEM is local-first.
- **Mandatory cloud dependencies** -- the local-only path must always work.
- **Frontend framework rewrites** (svelte, htmx, whatever) -- the stack is fine.
- **Hosted/managed RecallMEM** -- different project. Fork it if you want.
- **Mobile native apps** -- different project, different dev loop. Maybe a future fork.

---

## Done (the highlights)

Building blocks that are already working in v0.1:

- [x] Fresh Next.js 16 app, Postgres + pgvector locally
- [x] Three-layer memory: profile + facts + vector search via EmbeddingGemma 300M
- [x] Chat UI with streaming, markdown rendering, file uploads (PDF, image, text, code)
- [x] Chat history sidebar with date grouping, pinned chats, delete
- [x] Memory inspector with edit/delete on every fact
- [x] Custom rules (`RULES.md` page) injected into every system prompt
- [x] Wipe memory + nuke everything with `VACUUM FULL + CHECKPOINT`
- [x] Multi-provider LLM support (Ollama, Anthropic, OpenAI, OpenAI-compatible)
- [x] Test connection button for cloud providers
- [x] Curated model dropdowns for Anthropic and OpenAI (no typing model IDs)
- [x] Versioned migrations system with backfill for existing installs
- [x] CLI bootstrap (`npx recallmem`) with auto-detect install mode (use case 1 + use case 3)
- [x] Cross-platform CLI helpers (Mac done, Windows + Linux mostly done but untested)
- [x] npm publish setup (22KB tarball, zero dependencies)
- [x] Logo + branding (connected nodes), favicon, README hero
- [x] Footer with copyright + GitHub/X links
- [x] Apache 2.0 license + NOTICE for third-party attributions
- [x] Comprehensive README with comparison table, mermaid diagrams, hardware tiers
- [x] CONTRIBUTING.md for developers

---

## Hosted always-on roadmap

- [ ] **Move daily-use RecallMEM to an always-on Fly Machine.** Avoid automatic two-way database sync between local and Sprite for now because that becomes conflict resolution, tombstones, embedding-provider drift, and settings/secrets replication. Instead, make one hosted Postgres/pgvector-backed app the daily source of truth, keep localhost for development/testing, run migrations on deploy, store secrets with `fly secrets`, add backups/export, and add app auth before any public exposure.

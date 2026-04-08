# RecallMEM TODO

What's done, what's planned. Updated as of v0.1 prep.

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

## v0.3 (later)

### Export / backup / migration
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

# Developer guide

If you want to fork RecallMEM and use the memory layer in your own AI app, this is the doc. The whole `lib/` folder is intentionally framework-shaped. It's not a polished SDK with a public API contract, but it IS a working, opinionated memory architecture you can copy into your own project.

## What's in `lib/`

```
lib/
├── memory.ts        Memory orchestrator. Loads profile + facts + vector recall in parallel.
├── prompts.ts       Assembles the system prompt with all the memory context.
├── facts.ts         Fact extraction (LLM proposes) + validation (TypeScript decides).
├── profile.ts       Synthesizes a structured profile from the active facts.
├── chunks.ts        Splits transcripts into chunks, embeds them, runs vector search.
├── chats.ts         Chat CRUD + transcript serialization with the smart parser.
├── post-chat.ts     The post-chat pipeline (title gen, fact extract, profile rebuild, embed).
├── rules.ts         Custom user rules / instructions.
├── embeddings.ts    EmbeddingGemma calls via Ollama.
├── llm.ts           LLM router (Ollama, Anthropic, OpenAI, OpenAI-compatible).
├── settings.ts      Per-user key/value store (Brave key, etc).
├── web-search.ts    Brave Search backend for local-model web access.
├── langfuse.ts      Optional observability client (peer dep, opt-in).
└── db.ts            Postgres pool + the configurable user ID resolver.
```

## Embedding the memory framework in your app

The lib functions default to a single-user setup (`user_id = "local-user"`) but you can wire in your own auth system with two function calls at startup:

```typescript
import { Pool } from "pg";
import { configureDb, setUserIdResolver } from "./lib/db";

// Use your existing Postgres pool (or skip this and let lib/ create its own)
const myPool = new Pool({ connectionString: process.env.DATABASE_URL });
configureDb({ pool: myPool });

// Wire in your auth system. Called whenever a lib function needs the current user.
// Can be sync or async. Return whatever string identifies the user in your app.
setUserIdResolver(() => getCurrentUserFromMyAuthSystem());
```

That's it. No other changes needed. Every lib function (`getProfile`, `getActiveFacts`, `searchChunks`, `storeFacts`, `rebuildProfile`, etc.) reads from the configured resolver. Your auth system stays in your code, the memory framework stays in `lib/`.

## Using the memory layer in a chat request

```typescript
import { buildMemoryAwareSystemPrompt } from "./lib/memory";
import { runPostChatPipeline } from "./lib/post-chat";
import { createChat, updateChat } from "./lib/chats";

// 1. Build the system prompt from the user's memory
const systemPrompt = await buildMemoryAwareSystemPrompt(
  userMessage,
  currentChatId
);

// 2. Send to your LLM however you want (Ollama, Claude, GPT, whatever)
const response = await yourLLM.chat([
  { role: "system", content: systemPrompt },
  ...conversationHistory,
  { role: "user", content: userMessage },
]);

// 3. Save the chat
await updateChat(chatId, [...conversationHistory, { role: "assistant", content: response }]);

// 4. (Async) Run the post-chat pipeline to extract facts, rebuild profile, embed chunks
runPostChatPipeline(chatId);
```

The memory framework doesn't care which LLM you use. It just assembles context. Bring your own model.

## Database schema

The schema lives in `migrations/001_init.sql` plus subsequent migrations in the same folder. Run them in order against any Postgres 17+ database with the pgvector extension installed. Tables are prefixed `s2m_` (for "speak2me," the project this came from). Rename them in the migrations if you want a different prefix.

Tables:

- `s2m_chats` — chats and their full transcripts
- `s2m_user_facts` — extracted facts with `valid_from` / `valid_to` for temporal supersession
- `s2m_user_profiles` — synthesized profile per user
- `s2m_transcript_chunks` — chunked transcripts with embeddings (HNSW vector index)
- `s2m_llm_providers` — saved cloud provider configs
- `s2m_settings` — per-user key/value (Brave API key, etc)
- `s2m_rules` — custom user instructions

## Testing

```bash
npm test          # run the suite once
npm test:watch    # re-run on file change
```

The test suite uses Vitest and currently covers the deterministic memory primitives (keyword inflection, the categorization router, and the regression cases that have bitten us in the past — `son` matching `Sonnet`, `work` matching `framework`, etc). It's intentionally narrow and fast (~150ms). New tests go in `test/unit/` and follow the same shape as `test/unit/facts.test.ts`. No DB or LLM required, pure functions only.

## Optional observability (Langfuse)

If you're hacking on RecallMEM and want full trace timelines for every chat turn (memory build, LLM generation, fact extraction, supersession decisions, etc), there's a built-in Langfuse integration. It's a peer dependency, so it's NOT installed by default and zero cost when unused.

```bash
npm install langfuse
```

Then set these in `.env.local`:

```
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASEURL=http://localhost:3001  # optional, defaults to cloud.langfuse.com
```

Self-host Langfuse via Docker so traces stay on your machine. This is a developer-only debugging tool. Trace payloads include the actual user message content, so don't enable it on machines where conversation contents shouldn't leave the local environment.

## Two ways to develop on RecallMEM

The `npx recallmem` command auto-detects which workflow you're in.

### Workflow 1: Use it as your daily AI tool

```bash
npx recallmem
```

The CLI clones the repo to `~/.recallmem`, installs deps, runs setup, and starts the server. Subsequent runs are instant.

### Workflow 2: Fork and hack

```bash
git clone https://github.com/RealChrisSean/RecallMEM.git
cd RecallMEM
npm install
npx recallmem
```

The CLI detects you're already inside a recallmem checkout and uses your current directory instead of cloning to `~/.recallmem`. Hot reload works. Edits to the code are reflected immediately on the next dev server reload.

Same `npx recallmem` command. Different behavior because the CLI is smart about where it's running.

To upgrade later when a new version ships:

```bash
npx recallmem upgrade
```

That does a `git pull`, runs `npm install` if deps changed, and applies any pending migrations.

## License for derivative work

Apache 2.0. Fork it, modify it, ship it commercially. The only ask is that you preserve the copyright notice and the NOTICE file. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the dev setup.

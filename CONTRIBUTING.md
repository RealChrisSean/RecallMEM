# Contributing to RecallMEM

Thanks for being interested. This project is small enough that there's no formal contribution process. Just open an issue or send a PR. Here's what you need to know.

## Dev setup

```bash
git clone https://github.com/RealChrisSean/RecallMEM.git
cd RecallMEM
npm install
npx recallmem
```

The CLI auto-detects you're inside a recallmem checkout and uses your current directory instead of cloning to `~/.recallmem`. Hot reload works. Edits to `app/`, `lib/`, `components/` are reflected immediately on the next dev server reload.

## How the codebase is organized

```
recallmem/
├── app/                    # Next.js App Router pages and API routes
│   ├── api/                # All the API endpoints
│   │   ├── chat/           # Chat streaming + finalize
│   │   ├── chats/          # CRUD for chat history
│   │   ├── memory/         # Memory inspector + wipe/nuke
│   │   ├── providers/      # Custom LLM provider CRUD + test connection
│   │   ├── rules/          # Custom user rules
│   │   └── upload/         # File uploads (PDFs, text, code)
│   ├── memory/             # Memory inspector page
│   ├── providers/          # Provider management page
│   ├── rules/              # Custom rules editor page
│   ├── page.tsx            # The main chat page
│   └── layout.tsx          # Root layout
├── lib/                    # Server-side logic
│   ├── llm.ts              # LLM router (Ollama / Anthropic / OpenAI)
│   ├── llm-config.ts       # Client-safe LLM constants
│   ├── memory.ts           # Memory loading orchestration
│   ├── prompts.ts          # System prompt builders
│   ├── facts.ts            # Fact extraction + storage
│   ├── profile.ts          # Profile synthesis from facts
│   ├── chunks.ts           # Transcript chunking + embedding
│   ├── chats.ts            # Chat CRUD + transcript serialization
│   ├── post-chat.ts        # Post-chat pipeline (title gen, facts, embeddings)
│   ├── rules.ts            # User custom rules
│   ├── providers.ts        # Custom LLM provider storage
│   ├── embeddings.ts       # EmbeddingGemma calls
│   ├── migrate.ts          # Migration runner
│   ├── db.ts               # Postgres connection pool
│   └── types.ts            # Shared TypeScript types
├── bin/                    # The CLI (npx recallmem)
│   ├── recallmem.js        # Entry point
│   ├── commands/           # init, start, doctor, upgrade
│   └── lib/                # CLI helpers (detect, prompt, output, install-mode)
├── migrations/             # Versioned SQL migrations
│   └── 001_init.sql        # Baseline schema
├── scripts/                # Utility scripts
│   ├── migrate.ts          # Run migrations from CLI
│   └── sync-publish.js     # Sync bin/ into publish/ for npm publish
├── publish/                # The npm-publishable CLI package
│   └── package.json        # Stripped-down package.json (zero deps)
└── package.json            # Full deps for the dev/cloned repo
```

The big idea: `bin/` is the CLI that gets published to npm as a tiny ~22KB package with zero dependencies. The rest of the repo is the actual Next.js app, which the CLI clones to `~/.recallmem` on first run. Two different worlds in the same repo.

## The architectural decisions you should know

**1. Memory has three layers, not one.** Profile (fast, always loaded), facts (atomic, queryable, editable), and vector chunks (semantic recall). Each layer is in `lib/profile.ts`, `lib/facts.ts`, and `lib/chunks.ts` respectively. They get assembled into the system prompt by `lib/memory.ts` and `lib/prompts.ts`.

**2. The LLM router supports multiple providers.** `lib/llm.ts` is server-only (uses `pg`). Client components import constants from `lib/llm-config.ts` instead, which has zero server imports. Don't accidentally import `lib/llm.ts` from a React component or you'll pull `pg` into the browser bundle.

**3. Migrations are versioned.** Drop new SQL files into `migrations/` with the `nnn_name.sql` format. They run in alphabetical order. `lib/migrate.ts` handles the tracking via the `s2m_migrations` table.

**4. The post-chat pipeline runs synchronously when you click "New chat".** Async fact extraction was tempting, but it created a race condition where the next chat starts before facts are saved. Now we do it sync via `/api/chat/finalize` and show a "Saving memory..." indicator.

**5. Transcripts are stored as plain text with `role:` prefixes.** The parser handles assistant responses that contain their own `\n\n` (markdown headings, paragraphs) by treating unprefixed blocks as continuations. This was originally a serialization bug. The old parser dropped continuation paragraphs silently. Don't break this.

**6. The CLI is pure Node.js with zero npm dependencies.** It uses `psql` shell calls instead of the `pg` library to keep the npm package tiny. If you add a CLI feature, keep it dependency-free.

**7. The memory framework in `lib/` is designed to be embeddable.** All `lib/*.ts` files read the current user ID from `getUserId()` in `lib/db.ts`, which is configurable. The default returns `"local-user"` for single-user mode. External users can swap it out via `setUserIdResolver()` to wire in their own auth. Keep this pattern. If you add a new lib function that needs the user ID, call `await getUserId()` at the top. Don't hardcode `"local-user"` anywhere in `lib/`.

## Using the memory framework in your own app

If you're forking RecallMEM to use the memory framework in a different app (multi-user, different UI, different stack), here's how. You don't need to fork the whole repo. You can copy just the `lib/` folder into your project.

### What to copy

The minimum you need from the RecallMEM repo:

```
lib/                    # The memory framework itself
migrations/001_init.sql # The database schema
package.json            # For the dependencies (pg, @langchain/openai, etc.)
```

That's it. No app/, no components/, no bin/. Just the lib code and the schema.

### Wiring it into your app

Two function calls at startup configure the framework for your environment:

```typescript
import { Pool } from "pg";
import { configureDb, setUserIdResolver } from "./lib/db";

// 1. Wire in your existing Postgres pool. If you skip this, lib/ creates its
//    own pool from process.env.DATABASE_URL.
const myPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});
configureDb({ pool: myPool });

// 2. Wire in your auth system so each request reads the current user from
//    your session/JWT/whatever. Can be sync or async.
setUserIdResolver(async () => {
  const session = await getSession();
  return session.user.id;
});
```

After that, every lib function is multi-user aware. `getActiveFacts()`, `getProfile()`, `searchChunks()`, `storeFacts()`, `rebuildProfile()`, all of them. They each call `getUserId()` internally and scope their queries to that user.

### Running migrations in your app

The schema in `migrations/001_init.sql` has tables prefixed `s2m_` (for "speak2me," the project this code originally came from). If you want a different prefix, edit the migration file before running it.

To apply the schema:

```bash
psql $DATABASE_URL -f migrations/001_init.sql
```

Or use the migration runner from `lib/migrate.ts` if you want versioned migrations and a tracker table.

### Using the memory layer in your chat endpoint

Here's the minimum code to add memory-aware chat to a Next.js API route:

```typescript
import { NextRequest } from "next/server";
import { buildMemoryAwareSystemPrompt } from "@/lib/memory";
import { runPostChatPipeline } from "@/lib/post-chat";
import { createChat, updateChat, getChat } from "@/lib/chats";

export async function POST(req: NextRequest) {
  const { messages, chatId: incomingChatId } = await req.json();

  // Get or create a chat
  let chatId = incomingChatId;
  if (!chatId) {
    chatId = await createChat();
  }

  // Build the memory-aware system prompt
  const userMessage = messages[messages.length - 1].content;
  const systemPrompt = await buildMemoryAwareSystemPrompt(userMessage, chatId);

  // Send to your LLM (whatever you use)
  const response = await yourLLM.chat([
    { role: "system", content: systemPrompt },
    ...messages,
  ]);

  // Save the updated transcript
  const fullMessages = [...messages, { role: "assistant", content: response }];
  await updateChat(chatId, fullMessages);

  // Run the post-chat pipeline async (extracts facts, rebuilds profile, embeds)
  runPostChatPipeline(chatId);

  return Response.json({ chatId, response });
}
```

That's the whole integration. The memory framework handles loading context, fact extraction, profile synthesis, and vector embedding. You handle the LLM call and the API surface.

### What the memory framework does NOT do

Be honest about the limits:

- **It doesn't handle auth.** That's your job. The framework just calls `getUserId()` and trusts whatever you return.
- **It doesn't handle streaming the LLM response.** It generates the system prompt, you send it however you want.
- **It doesn't have a JS API contract or SemVer guarantees yet.** This is v0.1. The function signatures might change in v0.2. If you fork, expect to merge changes manually.
- **It doesn't ship as an npm package.** You copy the `lib/` folder. There's no `npm install @recallmem/memory-framework` (yet).
- **It assumes Postgres + pgvector.** If you want to use a different database, you'd need to rewrite the SQL in `lib/chats.ts`, `lib/facts.ts`, `lib/profile.ts`, `lib/chunks.ts`, `lib/providers.ts`, `lib/rules.ts`. The cosine similarity search specifically depends on pgvector.

## Common dev tasks

### Add a new database column

```bash
# 1. Create a new migration file
echo "ALTER TABLE s2m_chats ADD COLUMN my_new_field TEXT;" > migrations/002_add_my_field.sql

# 2. Run it
npm run migrate

# 3. Update lib/types.ts and any affected lib files
```

### Add a new API route

```bash
# Create app/api/your-route/route.ts
# Export GET, POST, PATCH, DELETE handlers
# Use NextRequest / Response from "next/server"
```

### Add a new page

```bash
# Create app/your-page/page.tsx
# Use "use client" if it needs hooks/state
# Add a Link in app/page.tsx header for navigation
```

### Test the CLI changes

```bash
# Run the CLI directly without npm install
node bin/recallmem.js doctor
node bin/recallmem.js init
node bin/recallmem.js --help
```

### Test the npm publish

```bash
npm run publish:sync       # Copy bin/ into publish/
cd publish
npm pack                   # Create tarball, inspect contents
# Test the tarball:
cd /tmp && npm install /path/to/recallmem-0.1.0.tgz
```

## Testing

There's no test suite right now. I haven't written one because this is a personal tool I use every day, so I'd notice immediately if it broke. If you want to add tests, please do, but it's not a blocker for PRs.

If you're contributing a fix, the bar is "I tested this manually and it works." Tell me what you tested in the PR description.

## Code style

- TypeScript everywhere except `bin/` (which is pure Node.js)
- No Prettier config. The codebase uses 2-space indentation, double quotes, trailing commas, no semicolons in JSX
- Functional React components, no classes
- Server-only code goes in `lib/`. Client-safe code goes in `lib/*-config.ts` files.
- Prefer `async/await` over `.then()`
- Comments explain "why", not "what". The code says what it does.

## What I'd love help with

Real things on the roadmap that I haven't built yet:

- **Voice mode.** Whisper STT + Piper TTS through a local WebSocket server. Big project but high value.
- **Search across past chats.** A search box in the sidebar that does keyword + vector search over all transcripts. Probably 2-3 hours of work.
- **Code syntax highlighting in markdown messages.** Drop in `react-syntax-highlighter`. Trivial.
- **Copy message button** on hover.
- **Rename chat title** by clicking it in the header.
- **Stop button while streaming** to cancel a long response.
- **Export everything as JSON** for backups.
- **OpenAI vision support.** Currently only Ollama and Anthropic vision work. OpenAI uses a different content format.
- **Reasoning model support** (OpenAI o1/o3, Claude extended thinking) with their different API parameters.

If you want to tackle one of these, open an issue first so we can talk about the approach before you sink time into it.

## What I won't merge (probably)

- **Mandatory cloud dependencies.** RecallMEM is local-first. Anything that requires a cloud service to function is a no.
- **Telemetry / analytics.** No phoning home. Ever.
- **Auth systems for multi-user.** That's a separate fork.
- **Hosted/managed versions of RecallMEM.** Different project.
- **Anything that breaks the privacy model.** Sending data to servers without explicit user opt-in is a no.
- **Trendy framework migrations.** The stack is Next.js 16 + Postgres + Ollama. I'm not switching to bun/svelte/sqlite/whatever-is-cool-this-month. The stack works.

## Reporting bugs

Open an issue on GitHub. Include:

1. What you tried to do
2. What happened instead
3. Output of `npx recallmem doctor`
4. Your OS and Node version
5. Steps to reproduce if you can

If it's a privacy-sensitive issue (like "RecallMEM is leaking data somewhere it shouldn't"), email me directly instead of opening a public issue.

## Code of conduct

Be a normal human. Don't be a jerk. If you're abusive in issues or PRs, I'll block you.

That's it. Thanks for being interested.

Chris

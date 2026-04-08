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

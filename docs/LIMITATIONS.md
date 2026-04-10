# Honest limitations (v0.1)

This is v0.1. It works, used daily, but it's not "production ready" in the corporate sense. Here's the honest list of what doesn't work yet, what's intentionally limited, and what's just rough.

## What doesn't exist yet

**No voice yet.** It's text only. Whisper for speech-to-text and Piper for text-to-speech (both local) are on the roadmap.

**No mobile app.** It's a web app you run locally. You access it from your browser at `localhost:3000`. A native iOS/Android app is theoretically possible but it's a separate project.

**No multi-user.** This is a personal app for one person on one machine. If you want a multi-user version, that's a separate fork.

**No CI, no error monitoring, no SLA.** There's a small Vitest test suite that covers the deterministic memory primitives (keyword routing, inflection, regression cases), but it's intentionally narrow.

## What's partially done

**Web search works on Anthropic and Ollama. OpenAI not yet.**
- Anthropic uses the native `web_search_20250305` tool, no setup.
- Ollama (Gemma) uses **Brave Search** as a backend, which needs an API key (~5 minute setup): sign up at [brave.com/search/api](https://brave.com/search/api), pick the Search plan ($5/1,000 requests, includes $5 free credits every month so ~1,000 searches/month are free), and paste the key into Settings → Web search.
- OpenAI's native web search requires the Responses API path which isn't plumbed through yet.

**OpenAI vision isn't fully wired up.** Gemma 4 (4B and up) handles images natively via Ollama. OpenAI uses a different format that hasn't been plumbed through. Use Ollama or Anthropic for images.

**Reasoning models (OpenAI o1/o3, Claude extended thinking) might have edge cases.** They use different API parameters that aren't fully handled yet. Standard chat models work fine.

**Auto-install is Mac-only.** The `npx recallmem` installer auto-installs Postgres, pgvector, Ollama, and pulls models on Mac via Homebrew. On Linux, it prints clear manual steps and exits.

## Intentional design choices that some users won't like

**Fact supersession is LLM-judged and conservative.** The local Gemma extractor decides whether a new fact contradicts an old one. It's intentionally cautious (only retires a fact when the replacement is unambiguous), so it might occasionally miss a real contradiction or, more rarely, retire something it shouldn't have. You can always inspect and edit/restore in the Memory page. For higher-stakes use cases, you'd want a stricter rule-based supersession layer on top, or a periodic profile-rebuild from full history.

**The memory framework isn't a polished SDK.** The `lib/` folder is intentionally framework-shaped, but it's not a public API contract. Function names, internal types, and database columns can change between versions. If you fork it for your own app, expect to read the code.

**CLI auto-install requires Homebrew on Mac.** We can't bootstrap Homebrew from inside an npm package, so users without Homebrew get a clear install message and have to run one command to install Homebrew first. That's the floor of friction without shipping a `.dmg` installer.

## Tech stack (so you know what you're getting into)

- **Frontend / Backend:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Database:** Postgres 17 + pgvector (HNSW vector indexes)
- **Local LLM:** Ollama with Gemma 4 (E2B / E4B / 26B MoE / 31B Dense)
- **Embeddings:** EmbeddingGemma 300M (768 dimensions, runs in Ollama)
- **PDF parsing:** pdf-parse v2
- **Markdown rendering:** react-markdown + remark-gfm + @tailwindcss/typography
- **Cloud LLM transports (optional):** Anthropic Messages API, OpenAI Chat Completions, OpenAI-compatible

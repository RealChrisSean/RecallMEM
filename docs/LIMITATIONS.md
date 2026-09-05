# Honest limitations (v0.2)

This is v0.2. It works, gets used daily, and now includes memory-backed voice. It is still not "production ready" in the corporate sense. Here's the honest list of what doesn't work yet, what's intentionally limited, and what's just rough.

## What doesn't exist yet

**No multi-user auth layer.** RecallMEM is still designed as a personal app. Sprite can protect the whole app behind Sprite login, but the app itself does not yet have per-user accounts, sessions, or row-level authorization.

**No native mobile app.** The web UI is mobile-friendly enough for daily use, but there is no iOS or Android app. A native app is a separate project.

**No local real-time voice stack.** The live voice agent uses Deepgram Voice Agent. Normal local chat can use Ollama/Gemma, but local Gemma/Ollama is intentionally disabled for the live voice agent because it is too slow for a phone-call-style loop.

**No CI, no error monitoring, no SLA.** There's a small Vitest test suite that covers the deterministic memory primitives (keyword routing, inflection, regression cases), but it's intentionally narrow.

## What's partially done

**Web search uses two provider paths.**
- Anthropic uses the native `web_search_20250305` tool, no setup.
- Ollama, OpenAI, and OpenAI-compatible providers use **Brave Search** as a backend, which needs an API key (~5 minute setup): sign up at [brave.com/search/api](https://brave.com/search/api), pick the Search plan ($5/1,000 requests, includes $5 free credits every month so ~1,000 searches/month are free), and paste the key into Settings → Web search.
- Direct OpenAI calls use the Responses API, but RecallMEM does not enable OpenAI's native web-search tool; it keeps one consistent Brave result-injection path for non-Anthropic providers.

**Voice Agent provider support depends on Deepgram.** The live agent can use compatible cloud providers through Deepgram's `think` provider path. RecallMEM checks Deepgram's current model list and disables voice when the selected chat model or mode is unsupported. Once a compatible session starts, it includes fast Deepgram-supported fallback providers for transient failures.

**Reasoning modes are text-chat first.** GPT-5.6 instant/thinking/deep/max and Claude adaptive effort modes are selectable in chat. Voice Agent intentionally accepts only instant selections, so it will not run deep, max, or adaptive thinking loops during live speech.

**Vision support is provider-dependent.** Gemma 4, current OpenAI models through Responses, and current Claude models accept image input. OpenAI-compatible providers still depend on the capabilities and request format of the configured endpoint.

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
- **Voice Agent:** Deepgram Voice Agent with Flux listening and Aura-2 speech
- **PDF parsing:** pdf-parse v2
- **Markdown rendering:** react-markdown + remark-gfm + @tailwindcss/typography
- **Cloud LLM transports (optional):** Anthropic Messages API, OpenAI Responses API, OpenAI-compatible Chat Completions

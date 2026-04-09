<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/logo-hero-dark.svg">
    <img src="./public/logo-hero.svg" alt="RecallMEM" width="320">
  </picture>
</p>

<p align="center">
  <strong>Persistent Private AI.</strong> Powered by Gemma 4 running locally on your own machine.
</p>

<p align="center">
  <img src="./public/screenshots/demo.png" alt="RecallMEM chat UI showing the AI remembering the user's name across conversations" width="900">
</p>

<p align="center">
  <em>Two chats. Different sessions. The AI remembers.</em>
</p>

---

## What is this

A personal AI chat app with real memory that runs 100% on your machine. Your conversations stay local. The AI builds a profile of who you are over time, extracts facts after every chat, and vector-searches across your entire history to find relevant context. By the time you've used it for a week, it knows you better than any cloud AI because it never forgets.

The default model is **Gemma 4** (Apache 2.0) running locally via Ollama. Pick any size from E2B (runs on a phone) up to 31B Dense (best quality, needs a workstation). Or skip Ollama entirely and bring your own API key for Claude, GPT, Groq, Together, OpenRouter, or anything OpenAI-compatible.

The memory is the actual differentiator. Not the model. Not the UI. Memory reads are deterministic SQL + cosine similarity, not LLM tool calls. The chat model never touches your database. Facts are proposed by a local LLM but validated by TypeScript before storage. [Deep dive on the architecture →](./docs/ARCHITECTURE.md)

## Features

- **Three-layer memory** across every chat: synthesized profile, extracted facts table, and vector search over all past conversations
- **Temporal awareness** so the model knows what's current vs. historical. Auto-retires stale facts when the truth changes.
- **Live fact extraction** after every assistant reply, not just when the chat ends
- **Memory inspector** where you can view, edit, or delete every fact
- **Vector search** across past conversations with dated recall
- **Custom rules** for how you want the AI to talk to you
- **File uploads** (images, PDFs, code). Gemma 4 handles vision natively.
- **Web search** when using Anthropic or Ollama (via Brave Search)
- **Wipe memory unrecoverably** with `DELETE` + `VACUUM FULL` + `CHECKPOINT`
- **Bring any LLM.** Ollama, Anthropic, OpenAI, or any OpenAI-compatible API.

## Quick start (Mac)

RecallMEM is built and tested on macOS. Mac is the supported platform.

**Prerequisites:** Node.js 20+ and [Homebrew](https://brew.sh).

```bash
npx recallmem
```

That's the whole install. The CLI checks what you have, shows what's missing, asks one yes/no question, then installs Postgres, pgvector, Ollama, and your choice of Gemma 4 model. First run takes 5-45 minutes depending on model size and internet speed. Subsequent runs are instant.

<details>
<summary><strong>Just want cloud models? (Claude / GPT)</strong></summary>

You still need Postgres for local memory storage, but you can skip Ollama entirely:

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
npx recallmem
```

After the app starts, go to **Settings → Providers → Add a new provider**, paste your API key, and pick that model from the chat dropdown.

</details>

<details>
<summary><strong>Linux (not officially supported, manual install)</strong></summary>

Auto-install isn't wired up for Linux. You'll need to install everything by hand:

```bash
# Postgres + pgvector (apt example)
sudo apt install postgresql-17 postgresql-17-pgvector
sudo systemctl start postgresql

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl start ollama
ollama pull embeddinggemma
ollama pull gemma4:26b

# Run
npx recallmem
```

</details>

<details>
<summary><strong>Windows (not supported, use WSL2)</strong></summary>

Native Windows is not supported. Use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) with Ubuntu and follow the Linux steps above inside WSL.

</details>

## CLI commands

```bash
npx recallmem            # Setup if needed, then start the app
npx recallmem init       # Setup only (deps, DB, models, env)
npx recallmem start      # Start the server (assumes setup done)
npx recallmem doctor     # Check what's missing or broken
npx recallmem upgrade    # Pull latest code, run pending migrations
npx recallmem version    # Print version
```

## Privacy

If you only use Ollama, **nothing leaves your machine, ever.** You can air-gap the computer and it keeps working. If you add a cloud provider, only the chat messages and your assembled system prompt go to that provider's servers. Your database, embeddings, and saved API keys stay local.

## For developers

Underneath the chat UI, RecallMEM is a **deterministic memory framework** you can fork and use in your own AI app. The whole `lib/` folder is intentionally framework-shaped.

```
lib/
├── memory.ts        Memory orchestrator (profile + facts + vector recall in parallel)
├── prompts.ts       System prompt assembly with all memory context
├── facts.ts         Fact extraction (LLM proposes) + validation (TypeScript decides)
├── profile.ts       Synthesizes a structured profile from active facts
├── chunks.ts        Transcript splitting, embedding, vector search
├── chats.ts         Chat CRUD + transcript serialization
├── post-chat.ts     Post-chat pipeline (title, facts, profile rebuild, embed)
├── rules.ts         Custom user rules / instructions
├── embeddings.ts    EmbeddingGemma calls via Ollama
├── llm.ts           LLM router (Ollama, Anthropic, OpenAI, OpenAI-compatible)
└── db.ts            Postgres pool + configurable user ID resolver
```

Wire in your own auth with two calls at startup and every lib function respects it. See the [developer docs](./docs/DEVELOPERS.md) for embedding the memory layer into your own app, the database schema, testing, and optional Langfuse observability.

## Docs

| Doc | What's in it |
|---|---|
| [Architecture deep dive](./docs/ARCHITECTURE.md) | How deterministic memory works, read/write paths, validation pipeline, why the LLM is not in charge |
| [Developer guide](./docs/DEVELOPERS.md) | Embedding the memory framework, auth wiring, schema, testing, Langfuse setup |
| [Hardware guide](./docs/HARDWARE.md) | Which model fits which machine, RAM requirements, cloud vs. local tradeoffs |
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Every gotcha I've hit and how to fix it |
| [Manual install](./docs/MANUAL_INSTALL.md) | Step-by-step if you don't want to use the CLI |

## Limitations (v0.1)

Text only (no voice yet). No multi-user. No mobile app. OpenAI vision not fully wired. Reasoning models (o1/o3, extended thinking) may have edge cases. Fact supersession is LLM-judged and intentionally conservative. See the [full limitations list](./docs/LIMITATIONS.md).

## Contributing

Forks, PRs, bug reports, ideas, all welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev setup.

## License

Apache 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Use it, modify it, fork it, ship it commercially.

## Status

v0.1. It works. I use it every day. There's no CI, no error monitoring, no SLA. If you want to use it as your daily AI tool, fork it, make it yours, and expect to read the code if something breaks. That's the deal.

[github.com/RealChrisSean/RecallMEM](https://github.com/RealChrisSean/RecallMEM)

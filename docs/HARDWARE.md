# Hardware guide

Which Gemma 4 model fits which machine, and the tradeoffs between local and cloud.

## Fully open source (Ollama + Gemma 4 locally)

| Setup | Model | RAM | Speed | Quality |
|---|---|---|---|---|
| Phone / iPad | Gemma 4 E2B | 8 GB | Fast | Basic |
| MacBook Air / Mac Mini M4 | Gemma 4 E4B | 16 GB | Fast | Good |
| Mac Studio M2+ | Gemma 4 26B MoE | 32 GB+ | Very fast | Great |
| Workstation / server | Gemma 4 31B Dense | 32 GB+ | Slower | Best |

The 26B MoE is what RecallMEM uses as the default. It's a Mixture of Experts model, so it only activates 3.8B parameters per token even though it has 26B total. Much faster than the 31B Dense, almost the same quality. Ranked #6 globally on the Arena leaderboard.

## Picking a model when you install

When you run `npx recallmem` for the first time, the installer asks which Gemma 4 model to download. The three options:

1. **Gemma 4 26B** (~18 GB) — Fast and smart enough for most users. Recommended.
2. **Gemma 4 31B** (~20 GB) — Best quality. Slower. Can be overkill.
3. **Gemma 4 E4B** (~10 GB) — Good for most laptops.
4. **Gemma 4 E2B** (~7 GB) — Smallest, fastest download. Good for a quick test or older laptops.

You can always pull a different model later:

```bash
ollama pull gemma4:26b
ollama pull gemma4:31b
ollama pull gemma4:e2b
```

Then pick it from the dropdown at the top of the chat.

## Using cloud providers (Claude, GPT, Groq, etc.)

If you don't want to run a local LLM at all, you can plug in any cloud API:

| Setup | RAM | Notes |
|---|---|---|
| Any laptop | ~4 GB free | Just runs Postgres + the Node.js app + browser. The LLM runs on the provider's servers. |

You bring your own API key. The database, memory, profile, and rules still stay on your machine. Only the chat messages get sent to the provider.

**One thing to know:** when you use a cloud provider, your conversation goes to their servers. Your facts and profile get sent as part of the system prompt so the cloud LLM has context. This breaks the local-only guarantee for those specific conversations. Use Ollama for anything you want fully private.

## Mixing local and cloud

You can have both. Use Gemma 4 locally for anything sensitive, and switch to Claude or GPT for one-off questions where you want maximum quality and privacy isn't a concern. The model dropdown at the top of the chat lets you pick per-conversation.

## Disk space

A typical install uses:

- **App + dependencies:** ~500 MB
- **Postgres data:** grows with conversation history, ~10 MB per 1,000 messages
- **EmbeddingGemma:** ~600 MB (always installed, required for memory vector search)
- **Gemma 4 chat model:** 7 GB (E2B), 10 GB (E4B), 18 GB (26B), or 20 GB (31B) — your choice

If you install all three Gemma 4 models, you're looking at ~40 GB total for the chat models alone.

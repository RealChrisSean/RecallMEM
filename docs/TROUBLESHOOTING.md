# Troubleshooting

Real gotchas hit during install and daily use, plus the actual fix for each.

If something breaks and it's not in this list, run `npx recallmem doctor` first. It tells you exactly what's broken and how to fix it.

## Install errors

**"Homebrew is required to auto-install dependencies"**

Install Homebrew from [brew.sh](https://brew.sh), then re-run `npx recallmem`.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**"fetch failed" when sending a message**

Ollama isn't running. Run `brew services start ollama` and refresh the page. The new installer should prevent this from happening on first install, but if you reboot your Mac and forget that brew services restarts on login, this is the fix.

```bash
brew services start ollama
```

**"Postgres is not running"**

```bash
brew services start postgresql@17
```

**The setup script asked which model and I picked the wrong one**

Just run `ollama pull gemma4:NEW_SIZE` in your terminal and pick the new one from the chat dropdown. Nothing to redo.

```bash
ollama pull gemma4:26b
ollama pull gemma4:31b
ollama pull gemma4:e2b
```

**`createdb: command not found`**

Add Postgres to your PATH:

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
```

To make it permanent, add that line to `~/.zshrc` and run `source ~/.zshrc`.

**`extension "vector" is not available`**

You're running Postgres 16 or older. The `pgvector` Homebrew bottle only ships extensions for Postgres 17 and 18. Switch to `postgresql@17`. The install error message is cryptic and the fix took me 30 minutes the first time.

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
```

## Runtime issues

**Ollama silently fails to pull a new model**

You've got a version mismatch between the Ollama CLI and the Ollama server. This bites you if you have both Homebrew Ollama AND the desktop Ollama app installed. Check `ollama --version`. Both client and server should match.

```bash
brew upgrade ollama
pkill -f "Ollama"            # kill the old desktop app server
brew services start ollama   # start the new server from Homebrew
```

**Gemma 4 31B is slow**

Two reasons:

1. **Thinking mode is on.** The app already disables it via `think: false`, but if you bypass the app and call Ollama directly, you'll see slow responses. Gemma 4 spends a ton of tokens "thinking" before answering when it's enabled.
2. **Dense vs MoE.** 31B Dense activates all 31B parameters per token. Switch to `gemma4:26b` (Mixture of Experts, only 3.8B active per token) for ~3-5x the speed with minimal quality loss. This is what RecallMEM uses as the default.

**"My memory isn't being used in new chats"**

Make sure you click "New chat" (or switch to another chat in the sidebar) to trigger the synchronous "Saving memory..." finalize step. If you just refresh the browser without ending the chat, the post-chat pipeline runs as a best-effort `sendBeacon()` and may not finish before the next chat starts.

The fix: always click "New chat" or switch chats in the sidebar before closing the browser if you said something you want remembered.

## Web search

**Web search toggle is on but the AI says "no Brave Search API key is configured"**

Get a free API key from [brave.com/search/api](https://brave.com/search/api) (pick the Free tier, 2,000 searches/month), then paste it into **Settings → Web search** in the app. Save. The AI will pick it up on the next message.

**Web search worked yesterday but suddenly doesn't**

Brave free tier resets monthly at 2,000 searches. You may have hit the cap. Either upgrade to the $3/month paid tier (20,000 searches) or wait until the month rolls over. The AI tells you which one happened when you try.

## Where things live on disk

The default install location is `~/.recallmem`. Override with `RECALLMEM_HOME=/custom/path npx recallmem` if you want it somewhere else.

What's in `~/.recallmem`:

- The full RecallMEM source code (cloned from GitHub)
- `node_modules/` with all dependencies
- `.env.local` with your config
- The Next.js build output (when you run it)

What's NOT in `~/.recallmem`:

- Your conversations, facts, profile, embeddings, rules, and API keys. Those all live in your Postgres database at `/opt/homebrew/var/postgresql@17/` (Mac) or `/var/lib/postgresql/` (Linux). The Postgres data directory is the actual source of truth.

## How to fully uninstall

```bash
rm -rf ~/.recallmem        # Remove the app
dropdb recallmem           # Remove the database (or use the in-app "Nuke everything" button first)
```

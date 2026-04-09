# Manual install

Step-by-step install if you don't want to use the `npx recallmem` CLI, or you want to know what it's doing under the hood.

## macOS

```bash
# 1. Install Node.js
brew install node

# 2. Install Postgres 17 + pgvector
brew install postgresql@17 pgvector
brew services start postgresql@17

# 3. Install Ollama (skip if using cloud only)
brew install ollama
brew services start ollama

# 4. Pull the models
ollama pull embeddinggemma      # ~600 MB, REQUIRED
ollama pull gemma4:26b          # ~18 GB, recommended chat model
ollama pull gemma4:e4b          # ~4 GB, fast model for background tasks
```

## Linux (Ubuntu/Debian)

```bash
# 1. Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Postgres + pgvector
sudo apt install postgresql-17 postgresql-17-pgvector
sudo systemctl start postgresql

# 3. Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 4. Pull models
ollama pull embeddinggemma
ollama pull gemma4:26b
ollama pull gemma4:e4b
```

## Windows

Use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) with Ubuntu and follow the Linux steps. Native Windows is not currently supported.

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/RealChrisSean/RecallMEM.git
cd RecallMEM

# 2. Install dependencies
npm install

# 3. Create the database
createdb recallmem

# 4. Run migrations
npm run migrate

# 5. Configure .env.local
cat > .env.local <<EOF
DATABASE_URL=postgres://$USER@localhost:5432/recallmem
OLLAMA_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=gemma4:26b
OLLAMA_FAST_MODEL=gemma4:e4b
OLLAMA_EMBED_MODEL=embeddinggemma
EOF

# 6. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## CLI commands (if you do use the npx tool)

```bash
npx recallmem            # Setup if needed, then start the app
npx recallmem init       # Setup only (deps check, DB, models, env)
npx recallmem start      # Start the server (assumes setup was done)
npx recallmem doctor     # Check what's missing or broken
npx recallmem upgrade    # Pull latest code, run pending migrations
npx recallmem version    # Print version
npx recallmem --help     # Show help
```

The default `npx recallmem` is what you'll use 99% of the time. It's smart about its state. On the first run it sets everything up, on subsequent runs it just starts the server.

If something breaks, run `npx recallmem doctor` first. It tells you exactly what's wrong and how to fix it.

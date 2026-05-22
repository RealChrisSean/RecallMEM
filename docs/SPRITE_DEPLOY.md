# Deploying RecallMEM on Sprite

Sprite is a good fit for RecallMEM because it gives us stateful disk for Postgres/pgvector while still exposing the Next.js app over HTTP.

## Create The Sprite

Sprite names must be lowercase:

```bash
sprite create recallmem --skip-console
```

## Bootstrap

From this repo:

```bash
sprite exec -s recallmem \
  --file scripts/sprite/bootstrap-recallmem.sh:/tmp/bootstrap-recallmem.sh \
  -- bash /tmp/bootstrap-recallmem.sh
```

The bootstrap script:

- Installs Postgres 17, pgvector, `ffmpeg`, and `poppler-utils`
- Creates a local `recallmem` database
- Enables the `vector` extension
- Clones `main` from GitHub into `/home/sprite/recallmem`
- Writes `/home/sprite/recallmem/.env.local`
- Runs `npm ci`, migrations, and `npm run build`
- Registers Sprite services for Postgres and the Next.js app

## Open The App

```bash
sprite url -s recallmem
```

Do not make this public until app-level auth is added. RecallMEM stores private memory and BYOK provider settings.

## Update Deployment

After pushing changes to GitHub:

```bash
sprite checkpoint create -s recallmem
sprite exec -s recallmem \
  --file scripts/sprite/bootstrap-recallmem.sh:/tmp/bootstrap-recallmem.sh \
  -- bash /tmp/bootstrap-recallmem.sh
```

The script is idempotent: it updates the repo, reuses the existing database password, reruns migrations, rebuilds, and recreates the services.

## Notes

- The hosted app uses cloud provider keys cleanly.
- Ollama is not installed by this script. The `.env.local` keeps the local Ollama URL for compatibility, but hosted usage should prefer OpenAI embeddings unless we intentionally add Ollama as a separate Sprite service.
- Sprite services must listen on `0.0.0.0`; the bootstrap script starts Next with `-H 0.0.0.0 -p 8080`.

# Security Notes

RecallMEM is private-memory software. Treat anything local as sensitive by
default: API keys, database URLs, Postgres dumps, exported memories, profile
notes, and local agent notes should not reach GitHub.

## Secret Scanning

The repo uses `gitleaks` through `scripts/security/check-secrets.sh`.

Run a full scan:

```bash
npm run security:secrets
```

Run the staged-files scan used by the pre-commit hook:

```bash
npm run security:staged
```

The script uses an installed `gitleaks` binary if one exists. Otherwise it
downloads a pinned release into `.git/tools/`, which is local to your checkout
and never committed.

## Local Hooks

Install the repo hooks once per clone:

```bash
npm run security:install-hooks
```

This sets `core.hooksPath=.githooks` for your local checkout.

- `pre-commit` scans staged files and staged secrets.
- `pre-push` scans tracked history before pushing.

## What Is Blocked

The path guard refuses to commit common private/local files:

- `.env` files
- database files like `.db`, `.sqlite`, and `.sqlite3`
- dump-style SQL files like `dump.sql` and `backup.sql`
- private notes like `DEVLOG.md`, `CLAUDE.md`, `AGENTS.md`, and `chrisprofile.md`
- export/personal-data folders
- key material like `.pem`, `.key`, `.p12`, and `.pfx`

Schema migrations and `scripts/init-db.sql` remain allowed because they are
source code, not data dumps.

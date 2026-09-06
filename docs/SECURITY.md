# Security Notes

RecallMEM is private-memory software. Treat anything local as sensitive by
default: API keys, database URLs, Postgres dumps, exported memories, profile
notes, and local agent notes should not reach GitHub.

## Public Repository, Private Data

Keep user memories, profiles, facts, conversations, transcripts, embeddings,
uploaded files, and runtime Wiki sources out of commits. Documentation, tests,
fixtures, and Wiki examples must use synthetic content, never copied or
anonymized personal data. New installations start with their own empty Wiki.
Intentionally public author attribution and project links are allowed.

Repository cleanup must preserve existing local and Sprite data. Do not delete,
modify, export, or migrate private databases or Wiki content to clean up Git.
If a private file is already tracked, adding it to `.gitignore` is insufficient;
remove it from Git tracking with `git rm --cached -- <path>` while keeping the
local file. Review the effect on other checkouts before deploying that removal.

Before every commit or approved push, review `git diff --cached --name-status`
and every line of `git diff --cached`, including newly tracked files, then run
`npm run security:paths`, `npm run security:staged`, and
`npm run security:secrets`. Check that no ignored private file was force-added.
Secret scanners do not reliably identify personal-life details, so manual
review is required. Pushes and Sprite deployments require explicit approval.

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

GitHub repository secret scanning and push protection provide an additional
check before supported credentials reach the remote repository. Ordinary
pushes use the same workflow; a detected credential blocks the push for review.
These settings do not add branch or pull-request restrictions and do not
replace the personal-data review above. Fork owners configure these settings
for their own repositories.

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
- database dumps and backups such as `.dump`, `.pgdump`, `.backup`, and `dump.sql`
- private notes like `DEVLOG.md`, `CLAUDE.md`, `AGENTS.md`, and `chrisprofile.md`
- database storage, uploads, runtime Wiki data, transcripts, backups, and exports
- Postgres credential files such as `.pgpass` and `.pg_service.conf`
- key material like `.pem`, `.key`, `.p12`, and `.pfx`

Schema migrations and `scripts/init-db.sql` remain allowed because they are
source code, not data dumps.

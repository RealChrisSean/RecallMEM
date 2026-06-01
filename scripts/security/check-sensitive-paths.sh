#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---tracked}"
ROOT="$(git rev-parse --show-toplevel)"
TMP_FILE="$(mktemp)"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

case "$MODE" in
  --staged)
    git -C "$ROOT" diff --cached --name-only --diff-filter=ACMR > "$TMP_FILE"
    ;;
  --tracked|--all)
    git -C "$ROOT" ls-files > "$TMP_FILE"
    ;;
  *)
    echo "Usage: $0 [--tracked|--staged|--all]" >&2
    exit 2
    ;;
esac

violations=()

while IFS= read -r path; do
  [ -n "$path" ] || continue

  case "$path" in
    .env|.env.*|*/.env|*/.env.*)
      violations+=("$path")
      ;;
    DEVLOG.md|NOTES.md|PERSONAL.md|CLAUDE.md|AGENTS.md|chrisprofile.md|*/DEVLOG.md|*/NOTES.md|*/PERSONAL.md|*/CLAUDE.md|*/AGENTS.md|*/chrisprofile.md)
      violations+=("$path")
      ;;
    *.pem|*.key|*.p12|*.pfx)
      violations+=("$path")
      ;;
    *.db|*.sqlite|*.sqlite3)
      violations+=("$path")
      ;;
    dump.sql|backup.sql|*dump*.sql|*backup*.sql)
      violations+=("$path")
      ;;
    data/*|*/data/*|exports/*|*/exports/*|personal-data/*|*/personal-data/*)
      violations+=("$path")
      ;;
  esac
done < "$TMP_FILE"

if [ "${#violations[@]}" -gt 0 ]; then
  echo "Refusing to continue because sensitive/local-only paths are tracked or staged:" >&2
  printf '  - %s\n' "${violations[@]}" >&2
  echo "" >&2
  echo "Move the data elsewhere, add it to .gitignore, or untrack it with:" >&2
  echo "  git rm --cached <path>" >&2
  exit 1
fi

echo "Sensitive path check passed."

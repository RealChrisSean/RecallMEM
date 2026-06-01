#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---all}"
ROOT="$(git rev-parse --show-toplevel)"
GITLEAKS="$("$ROOT/scripts/security/ensure-gitleaks.sh")"
CONFIG="$ROOT/.gitleaks.toml"

COMMON_ARGS=(
  "--config=$CONFIG"
  "--redact"
  "--no-banner"
  "--no-color"
  "--log-level=warn"
)

case "$MODE" in
  --staged)
    "$ROOT/scripts/security/check-sensitive-paths.sh" --staged
    "$GITLEAKS" git "$ROOT" --staged --pre-commit "${COMMON_ARGS[@]}"
    ;;
  --all)
    "$ROOT/scripts/security/check-sensitive-paths.sh" --all
    "$GITLEAKS" git "$ROOT" --log-opts="--all" "${COMMON_ARGS[@]}"
    ;;
  --tracked)
    "$ROOT/scripts/security/check-sensitive-paths.sh" --tracked
    "$GITLEAKS" git "$ROOT" "${COMMON_ARGS[@]}"
    ;;
  *)
    echo "Usage: $0 [--all|--tracked|--staged]" >&2
    exit 2
    ;;
esac

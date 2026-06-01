#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

git -C "$ROOT" config core.hooksPath .githooks

echo "Installed RecallMEM git hooks via core.hooksPath=.githooks"
echo "Pre-commit: scans staged paths and staged secrets."
echo "Pre-push: scans tracked history for secrets before pushing."

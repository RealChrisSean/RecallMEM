#!/usr/bin/env bash
set -euo pipefail

VERSION="${GITLEAKS_VERSION:-8.30.1}"

if [ -n "${GITLEAKS_BIN:-}" ]; then
  if [ -x "$GITLEAKS_BIN" ]; then
    printf '%s\n' "$GITLEAKS_BIN"
    exit 0
  fi
  echo "GITLEAKS_BIN is set but is not executable: $GITLEAKS_BIN" >&2
  exit 1
fi

if command -v gitleaks >/dev/null 2>&1; then
  command -v gitleaks
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TOOLS_DIR="$ROOT/.git/tools/gitleaks/$VERSION"
BIN="$TOOLS_DIR/gitleaks"

if [ -x "$BIN" ]; then
  printf '%s\n' "$BIN"
  exit 0
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin|linux) ;;
  *)
    echo "Unsupported OS for automatic gitleaks install: $OS" >&2
    echo "Install gitleaks manually and rerun, or set GITLEAKS_BIN=/path/to/gitleaks." >&2
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *)
    echo "Unsupported architecture for automatic gitleaks install: $ARCH" >&2
    echo "Install gitleaks manually and rerun, or set GITLEAKS_BIN=/path/to/gitleaks." >&2
    exit 1
    ;;
esac

ARCHIVE="gitleaks_${VERSION}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${ARCHIVE}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TOOLS_DIR"
echo "gitleaks not found; downloading v${VERSION} to .git/tools..." >&2
curl -fsSL "$URL" -o "$TMP_DIR/$ARCHIVE"
tar -xzf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR"
install -m 0755 "$TMP_DIR/gitleaks" "$BIN"

printf '%s\n' "$BIN"

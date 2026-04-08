/**
 * OS-specific install hints. Printed when a dependency is missing.
 * The user has to run these themselves -- we don't auto-install with sudo.
 */

const { color } = require("./output");
const { getOS } = require("./detect");

function postgresInstallHint() {
  const os = getOS();
  const lines = [
    color.bold("Postgres is required (version 17+ with pgvector extension)."),
    "",
  ];
  if (os === "mac") {
    lines.push("Install via Homebrew:");
    lines.push("  brew install postgresql@17 pgvector");
    lines.push("  brew services start postgresql@17");
  } else if (os === "linux") {
    lines.push("Install via apt (Ubuntu/Debian):");
    lines.push("  sudo apt update");
    lines.push("  sudo apt install -y postgresql-17 postgresql-17-pgvector");
    lines.push("  sudo systemctl start postgresql");
    lines.push("");
    lines.push("Or via dnf (Fedora):");
    lines.push("  sudo dnf install postgresql17-server pgvector_17");
  } else if (os === "windows") {
    lines.push("Recommended: use WSL2 with Ubuntu and follow the Linux instructions.");
    lines.push("Native Windows: download from https://www.postgresql.org/download/windows/");
    lines.push("Then install pgvector separately.");
  } else {
    lines.push("See https://www.postgresql.org/download/ for your platform.");
  }
  return lines.join("\n");
}

function pgvectorInstallHint() {
  const os = getOS();
  const lines = [
    color.bold("pgvector extension is required."),
    "",
  ];
  if (os === "mac") {
    lines.push("  brew install pgvector");
  } else if (os === "linux") {
    lines.push("  sudo apt install postgresql-17-pgvector");
    lines.push("  # or: https://github.com/pgvector/pgvector#installation");
  } else {
    lines.push("See https://github.com/pgvector/pgvector#installation");
  }
  return lines.join("\n");
}

function ollamaInstallHint() {
  const os = getOS();
  const lines = [
    color.bold("Ollama is required for local LLMs."),
    color.dim("(Skip this if you only want to use cloud providers like Claude or GPT.)"),
    "",
  ];
  if (os === "mac") {
    lines.push("Install:");
    lines.push("  brew install ollama");
    lines.push("  brew services start ollama");
  } else if (os === "linux") {
    lines.push("Install:");
    lines.push("  curl -fsSL https://ollama.com/install.sh | sh");
  } else if (os === "windows") {
    lines.push("Download from https://ollama.com/download/windows");
  } else {
    lines.push("See https://ollama.com/download");
  }
  return lines.join("\n");
}

function nodeInstallHint() {
  return [
    color.bold("Node.js 20 or newer is required."),
    "",
    "Install via nvm (recommended):",
    "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash",
    "  nvm install 20",
    "",
    "Or via Homebrew (Mac): brew install node",
    "Or download from https://nodejs.org",
  ].join("\n");
}

module.exports = {
  postgresInstallHint,
  pgvectorInstallHint,
  ollamaInstallHint,
  nodeInstallHint,
};

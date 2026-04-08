/**
 * Dependency detection utilities. Each function checks for a runtime dep
 * and returns a result describing what's there or what's missing.
 *
 * Pure Node, no external deps. Uses child_process to shell out to system tools.
 */

const { execSync, spawnSync } = require("node:child_process");
const os = require("node:os");

function getOS() {
  const p = os.platform();
  if (p === "darwin") return "mac";
  if (p === "linux") return "linux";
  if (p === "win32") return "windows";
  return p;
}

function commandExists(cmd) {
  const which = spawnSync(getOS() === "windows" ? "where" : "which", [cmd], {
    stdio: "pipe",
  });
  return which.status === 0;
}

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Node.js version
// ─────────────────────────────────────────────────────────────────────────────

function detectNode() {
  const version = process.version.replace(/^v/, "");
  const major = parseInt(version.split(".")[0], 10);
  return {
    ok: major >= 20,
    version,
    major,
    needed: 20,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Postgres
// ─────────────────────────────────────────────────────────────────────────────

function detectPostgres() {
  // Try common locations for psql binary
  const candidates = [
    "/opt/homebrew/opt/postgresql@17/bin/psql",
    "/opt/homebrew/opt/postgresql@18/bin/psql",
    "/usr/local/opt/postgresql@17/bin/psql",
    "/usr/lib/postgresql/17/bin/psql",
    "/usr/bin/psql",
    "psql",
  ];

  let psqlPath = null;
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "pipe" });
    if (result.status === 0) {
      psqlPath = candidate;
      break;
    }
  }

  if (!psqlPath) {
    return { ok: false, installed: false };
  }

  const versionStr = tryExec(`${psqlPath} --version`);
  const versionMatch = versionStr?.match(/(\d+)\.(\d+)/);
  const major = versionMatch ? parseInt(versionMatch[1], 10) : 0;

  return {
    ok: major >= 17,
    installed: true,
    psqlPath,
    version: versionStr,
    major,
  };
}

function detectPostgresService() {
  // Try connecting to the default port
  const result = spawnSync(
    "pg_isready",
    ["-h", "localhost", "-p", "5432"],
    { stdio: "pipe" }
  );
  return { running: result.status === 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// pgvector extension (uses psql via shell to avoid pg dependency in the CLI)
// ─────────────────────────────────────────────────────────────────────────────

function detectPgvector(connectionString) {
  try {
    const result = spawnSync(
      "psql",
      [
        connectionString,
        "-tAc",
        "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'",
      ],
      { stdio: "pipe", encoding: "utf-8" }
    );
    if (result.status !== 0) {
      return { ok: false, available: false, error: result.stderr?.trim() };
    }
    const available = result.stdout.trim() === "1";
    return { ok: available, available };
  } catch (err) {
    return { ok: false, available: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama
// ─────────────────────────────────────────────────────────────────────────────

function detectOllama() {
  const installed = commandExists("ollama");
  if (!installed) return { ok: false, installed: false, running: false };

  const version = tryExec("ollama --version");

  // Check if the server is running
  let running = false;
  try {
    execSync("curl -s -o /dev/null -w '%{http_code}' http://localhost:11434/api/version", {
      stdio: "pipe",
    });
    running = true;
  } catch {
    running = false;
  }

  return { ok: running, installed, running, version };
}

async function detectOllamaModel(modelName) {
  return new Promise((resolve) => {
    const http = require("node:http");
    const req = http.request(
      {
        host: "localhost",
        port: 11434,
        path: "/api/tags",
        method: "GET",
        timeout: 3000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const models = data.models || [];
            const found = models.some(
              (m) => m.name === modelName || m.name === `${modelName}:latest`
            );
            resolve({ ok: found, installed: found });
          } catch {
            resolve({ ok: false, installed: false });
          }
        });
      }
    );
    req.on("error", () => resolve({ ok: false, installed: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, installed: false });
    });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Database existence (uses psql via shell to avoid pg dependency in the CLI)
// ─────────────────────────────────────────────────────────────────────────────

function detectDatabase(connectionString) {
  try {
    const result = spawnSync("psql", [connectionString, "-tAc", "SELECT 1"], {
      stdio: "pipe",
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      return { ok: false, exists: false, error: result.stderr?.trim() };
    }
    return { ok: true, exists: true };
  } catch (err) {
    return { ok: false, exists: false, error: err.message };
  }
}

module.exports = {
  getOS,
  commandExists,
  detectNode,
  detectPostgres,
  detectPostgresService,
  detectPgvector,
  detectOllama,
  detectOllamaModel,
  detectDatabase,
};

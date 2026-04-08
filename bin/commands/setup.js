/**
 * recallmem init / setup
 *
 * Idempotent setup pipeline:
 *   1. Check Node.js version
 *   2. Check Postgres is installed and running
 *   3. Check pgvector is available
 *   4. Create the database if missing
 *   5. Run migrations
 *   6. Check Ollama (optional - skip if user wants cloud-only)
 *   7. Pull embeddinggemma (required, ~600MB)
 *   8. Offer to pull gemma4:26b (recommended chat model, ~18GB)
 *   9. Generate .env.local with sensible defaults
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync, execSync } = require("node:child_process");

const {
  getOS,
  detectNode,
  detectPostgres,
  detectPostgresService,
  detectPgvector,
  detectOllama,
  detectOllamaModel,
  detectDatabase,
} = require("../lib/detect");

const {
  postgresInstallHint,
  pgvectorInstallHint,
  ollamaInstallHint,
  nodeInstallHint,
} = require("../lib/install-hints");

const {
  color,
  step,
  success,
  warn,
  fail,
  info,
  section,
  blank,
} = require("../lib/output");

const { confirm } = require("../lib/prompt");

const DEFAULT_DB_NAME = "recallmem";

function defaultConnectionString() {
  const user = process.env.USER || process.env.USERNAME || "postgres";
  return `postgres://${user}@localhost:5432/${DEFAULT_DB_NAME}`;
}

function readEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const text = fs.readFileSync(envPath, "utf-8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnv(envPath, env) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join("\n") + "\n");
}

async function setupCommand(opts = {}) {
  const {
    silent = false,
    skipIfDone = false,
    installPath = process.cwd(),
  } = opts;
  const ENV_PATH = path.join(installPath, ".env.local");

  // ─── Step 1: Node.js ───────────────────────────────────────────────────
  if (!silent) section("Checking dependencies");
  const node = detectNode();
  if (!node.ok) {
    fail(`Node.js ${node.version} is too old (need ${node.needed}+)`);
    blank();
    console.log(nodeInstallHint());
    return { ok: false };
  }
  success(`Node.js ${node.version}`);

  // ─── Step 2: Postgres ──────────────────────────────────────────────────
  const pg = detectPostgres();
  if (!pg.installed) {
    fail("Postgres not found");
    blank();
    console.log(postgresInstallHint());
    blank();
    info("Once installed, re-run: npx recallmem");
    return { ok: false };
  }
  if (!pg.ok) {
    fail(`Postgres ${pg.major} found, but version 17+ is required`);
    blank();
    console.log(postgresInstallHint());
    return { ok: false };
  }
  success(`Postgres ${pg.major}`);

  // ─── Step 3: Postgres service running ──────────────────────────────────
  const pgService = detectPostgresService();
  if (!pgService.running) {
    warn("Postgres is installed but not running");
    if (getOS() === "mac") {
      info("Try: brew services start postgresql@17");
    } else if (getOS() === "linux") {
      info("Try: sudo systemctl start postgresql");
    }
    return { ok: false };
  }
  success("Postgres service running on localhost:5432");

  // ─── Step 4: env file (we need DATABASE_URL before checking pgvector) ──
  const env = readEnv(ENV_PATH);
  let connectionString = env.DATABASE_URL;

  if (!connectionString) {
    connectionString = defaultConnectionString();
    step(`No .env.local found, will create one with default DATABASE_URL`);
  }

  // ─── Step 5: Database exists ───────────────────────────────────────────
  // Extract the database name from the connection string for accurate messages
  const dbNameMatch = connectionString.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbNameMatch ? dbNameMatch[1] : DEFAULT_DB_NAME;

  const dbCheck = await detectDatabase(connectionString);
  if (!dbCheck.exists) {
    step(`Database '${dbName}' not found, creating...`);
    try {
      execSync(`${pg.psqlPath.replace(/psql$/, "createdb")} ${dbName}`, {
        stdio: "pipe",
      });
      success(`Created database '${dbName}'`);
    } catch (err) {
      fail(`Failed to create database: ${err.message}`);
      info(`Try manually: createdb ${dbName}`);
      return { ok: false };
    }
  } else {
    success(`Database '${dbName}' exists`);
  }

  // ─── Step 6: pgvector extension available ──────────────────────────────
  const pgvec = await detectPgvector(connectionString);
  if (!pgvec.available) {
    fail("pgvector extension is not installed in Postgres");
    blank();
    console.log(pgvectorInstallHint());
    return { ok: false };
  }
  success("pgvector extension available");

  // ─── Step 7: Run migrations ────────────────────────────────────────────
  step("Running migrations...");
  try {
    process.env.DATABASE_URL = connectionString;
    const migrateResult = spawnSync("npx", ["tsx", "scripts/migrate.ts"], {
      cwd: installPath,
      stdio: silent ? "pipe" : "inherit",
      env: { ...process.env, DATABASE_URL: connectionString },
    });
    if (migrateResult.status !== 0) {
      fail("Migration failed");
      return { ok: false };
    }
  } catch (err) {
    fail(`Migration failed: ${err.message}`);
    return { ok: false };
  }

  // ─── Step 8: Ollama (optional) ─────────────────────────────────────────
  section("Checking LLM runtime");
  const ollama = detectOllama();
  let ollamaUrl = env.OLLAMA_URL || "http://localhost:11434";

  if (!ollama.installed) {
    warn("Ollama not installed (optional - you can use cloud providers instead)");
    blank();
    console.log(ollamaInstallHint());
    blank();
    info("Continuing without Ollama. You can add Claude/OpenAI as a provider in the app.");
    blank();
  } else if (!ollama.running) {
    warn("Ollama is installed but not running");
    if (getOS() === "mac") {
      info("Try: brew services start ollama");
    } else {
      info("Try: ollama serve");
    }
    blank();
  } else {
    success(`Ollama running (${ollama.version || "unknown version"})`);

    // ─── Step 9: Required model: embeddinggemma ──────────────────────────
    const embedModel = await detectOllamaModel("embeddinggemma");
    if (!embedModel.installed) {
      step("Pulling embeddinggemma (~600MB, required for vector search)...");
      try {
        execSync("ollama pull embeddinggemma", { stdio: "inherit" });
        success("Pulled embeddinggemma");
      } catch (err) {
        fail(`Failed to pull embeddinggemma: ${err.message}`);
        return { ok: false };
      }
    } else {
      success("embeddinggemma installed");
    }

    // ─── Step 10: Recommended model: gemma4:26b ──────────────────────────
    const chatModel = await detectOllamaModel("gemma4:26b");
    if (!chatModel.installed && !skipIfDone) {
      blank();
      info("Recommended chat model: gemma4:26b (~18GB)");
      info("Optional - you can use cloud providers (Claude, GPT) instead.");
      const wantsPull = await confirm("Pull gemma4:26b now?", false);
      if (wantsPull) {
        try {
          execSync("ollama pull gemma4:26b", { stdio: "inherit" });
          success("Pulled gemma4:26b");
        } catch (err) {
          fail(`Failed to pull gemma4:26b: ${err.message}`);
          info("You can pull it later with: ollama pull gemma4:26b");
        }
      } else {
        info("Skipped. You can pull it later with: ollama pull gemma4:26b");
      }
    } else if (chatModel.installed) {
      success("gemma4:26b installed");
    }
  }

  // ─── Step 11: Write .env.local ─────────────────────────────────────────
  section("Writing config");
  const finalEnv = {
    DATABASE_URL: env.DATABASE_URL || connectionString,
    OLLAMA_URL: env.OLLAMA_URL || ollamaUrl,
    OLLAMA_CHAT_MODEL: env.OLLAMA_CHAT_MODEL || "gemma4:26b",
    OLLAMA_FAST_MODEL: env.OLLAMA_FAST_MODEL || "gemma4:e4b",
    OLLAMA_EMBED_MODEL: env.OLLAMA_EMBED_MODEL || "embeddinggemma",
  };
  const existedBefore = fs.existsSync(ENV_PATH);
  writeEnv(ENV_PATH, finalEnv);
  success(`.env.local ${existedBefore ? "updated" : "created"}`);

  blank();
  success(color.bold("Setup complete!"));
  blank();

  return { ok: true };
}

module.exports = { setupCommand };

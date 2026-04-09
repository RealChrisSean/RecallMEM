/**
 * recallmem init / setup
 *
 * Real installer (not a hint-giver). Detects what's missing, asks the user
 * ONE yes/no question, then installs everything for them. Then asks which
 * Gemma 4 model to download. Then runs the app.
 *
 * Pipeline:
 *   1. Check Node 20+ (hard fail if missing - we can't bootstrap node from npx)
 *   2. Detect missing pieces (Postgres, pgvector, Ollama)
 *   3. Show one summary + one prompt: "install everything? Y/n"
 *   4. Run brew install / brew services start for everything missing
 *   5. Verify each piece is actually up before moving on
 *   6. Pull EmbeddingGemma (always, required for memory)
 *   7. Ask which Gemma 4 chat model to install (1, 2, or 3)
 *   8. Run migrations
 *   9. Production build (skipped in dev mode)
 *   10. Done
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, execSync } = require("node:child_process");

const {
  getOS,
  detectNode,
  detectPostgres,
  detectPostgresService,
  detectPgvector,
  detectOllama,
  detectOllamaModel,
  detectDatabase,
  commandExists,
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

const { confirm, ask } = require("../lib/prompt");

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

// Run a shell command and stream output to the user. Returns true on success.
function run(command, args, label) {
  if (label) step(label);
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status === 0;
}

// Wait up to N seconds for a service to become ready. Used after starting
// brew services so we don't race ahead before postgres/ollama is actually up.
async function waitFor(checkFn, timeoutMs = 15000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkFn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// Model selection moved to the web UI. Setup only installs the embedder
// (small, required for memory) and lets the user pick a chat model from
// the Settings page in the running app. This dramatically shortens the
// install time and gives users a real visual progress bar instead of
// terminal output for the multi-GB chat model download.

async function setupCommand(opts = {}) {
  const {
    silent = false,
    skipIfDone = false,
    installPath = process.cwd(),
    devMode = false,
  } = opts;
  const ENV_PATH = path.join(installPath, ".env.local");
  const os = getOS();

  // ─── Step 1: Node.js (hard requirement, we're already running on it) ───
  if (!silent) section("Checking what you have");
  const node = detectNode();
  if (!node.ok) {
    fail(`Node.js ${node.version} is too old (need ${node.needed}+)`);
    blank();
    console.log(nodeInstallHint());
    return { ok: false };
  }
  success(`Node.js ${node.version}`);

  // ─── Step 2: Detect everything else ───────────────────────────────────
  let pg = detectPostgres();
  let pgService = pg.installed ? detectPostgresService() : { running: false };
  let ollama = detectOllama();

  // ─── Step 3: Print a summary of what's there and what's missing ───────
  blank();
  console.log(pg.installed && pg.ok
    ? `  ✓ Postgres ${pg.major}`
    : "  ✗ Postgres 17 with pgvector — missing");
  console.log(pgService.running
    ? "  ✓ Postgres is running"
    : pg.installed
      ? "  ✗ Postgres is not running"
      : "  ✗ Postgres is not running");
  console.log(ollama.installed && ollama.running
    ? "  ✓ Ollama is running"
    : ollama.installed
      ? "  ✗ Ollama is installed but not running"
      : "  ✗ Ollama — missing");
  blank();

  const needPostgres = !pg.installed || !pg.ok;
  const needPostgresStart = pg.installed && pg.ok && !pgService.running;
  const needOllama = !ollama.installed;
  const needOllamaStart = ollama.installed && !ollama.running;
  const anythingMissing = needPostgres || needPostgresStart || needOllama || needOllamaStart;

  if (anythingMissing) {
    // Check Homebrew is available before offering auto-install on Mac
    const hasBrew = os === "mac" && commandExists("brew");

    if (os === "mac" && !hasBrew) {
      fail("Homebrew is required to auto-install dependencies.");
      blank();
      console.log("Install Homebrew first by pasting this in your terminal:");
      console.log("");
      console.log("  /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"");
      console.log("");
      console.log("Then re-run: npx recallmem");
      return { ok: false };
    }

    if (os !== "mac" && os !== "linux") {
      fail(`Auto-install is only supported on Mac and Linux. You're on: ${os}`);
      info("On Windows, use WSL2 with Ubuntu and re-run npx recallmem inside WSL.");
      return { ok: false };
    }

    if (os === "linux") {
      // Linux is doable but we can't run apt without sudo, and the package
      // names vary by distro. Print clear instructions and exit.
      fail("Auto-install is currently only set up for Mac (Homebrew).");
      blank();
      console.log("On Linux, install these manually then re-run npx recallmem:");
      console.log("");
      console.log("  Postgres 17 with pgvector (your distro's package manager)");
      console.log("  Ollama: curl -fsSL https://ollama.com/install.sh | sh");
      console.log("  Then: systemctl start postgresql && systemctl start ollama");
      return { ok: false };
    }

    // Mac path: ask once, install everything
    blank();
    console.log("I can install and start the missing pieces for you using Homebrew.");
    console.log("This takes about 2-5 minutes (not counting the model download).");
    blank();
    const wantsInstall = await confirm("Install everything now?", true);
    if (!wantsInstall) {
      blank();
      info("Skipped. You can install manually with:");
      if (needPostgres) console.log("  brew install postgresql@17 pgvector");
      if (needPostgresStart || needPostgres) console.log("  brew services start postgresql@17");
      if (needOllama) console.log("  brew install ollama");
      if (needOllamaStart || needOllama) console.log("  brew services start ollama");
      return { ok: false };
    }

    // Install Postgres if missing
    if (needPostgres) {
      if (!run("brew", ["install", "postgresql@17", "pgvector"], "Installing Postgres 17 + pgvector...")) {
        fail("Failed to install Postgres. Try running it manually and re-run npx recallmem.");
        return { ok: false };
      }
      success("Installed Postgres 17 + pgvector");
      // Re-detect after install
      pg = detectPostgres();
    }

    // Start Postgres if not running
    if (!pgService.running || needPostgres) {
      step("Starting Postgres in the background...");
      run("brew", ["services", "start", "postgresql@17"]);
      // Wait for it to actually accept connections
      const isUp = await waitFor(() => {
        const r = detectPostgresService();
        return r.running;
      });
      if (!isUp) {
        fail("Postgres started but isn't accepting connections after 15s.");
        info("Try: brew services restart postgresql@17");
        return { ok: false };
      }
      success("Postgres is running on localhost:5432");
      pgService = { running: true };
    }

    // Install Ollama if missing
    if (needOllama) {
      if (!run("brew", ["install", "ollama"], "Installing Ollama...")) {
        fail("Failed to install Ollama. Try running it manually and re-run npx recallmem.");
        return { ok: false };
      }
      success("Installed Ollama");
      ollama = detectOllama();
    }

    // Start Ollama if not running
    if (!ollama.running || needOllama) {
      step("Starting Ollama in the background...");
      run("brew", ["services", "start", "ollama"]);
      const isUp = await waitFor(() => {
        const r = detectOllama();
        return r.running;
      });
      if (!isUp) {
        fail("Ollama started but isn't responding after 15s.");
        info("Try: brew services restart ollama");
        return { ok: false };
      }
      success("Ollama is running on localhost:11434");
      ollama = detectOllama();
    }
  } else {
    success("Everything is already installed and running.");
  }

  // ─── Step 4: env file (we need DATABASE_URL before checking pgvector) ──
  const env = readEnv(ENV_PATH);
  let connectionString = env.DATABASE_URL;
  if (!connectionString) {
    connectionString = defaultConnectionString();
  }

  // ─── Step 5: Database exists ───────────────────────────────────────────
  const dbNameMatch = connectionString.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbNameMatch ? dbNameMatch[1] : DEFAULT_DB_NAME;

  const dbCheck = await detectDatabase(connectionString);
  if (!dbCheck.exists) {
    step(`Creating database '${dbName}'...`);
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
  step("Running database migrations...");
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

  // ─── Step 8: Always pull EmbeddingGemma (required for memory) ──────────
  if (ollama.running) {
    section("Setting up models");
    const embedModel = await detectOllamaModel("embeddinggemma");
    if (!embedModel.installed) {
      step("Downloading EmbeddingGemma (~600 MB, required for memory)...");
      try {
        execSync("ollama pull embeddinggemma", { stdio: "inherit" });
        success("EmbeddingGemma installed");
      } catch (err) {
        fail(`Failed to pull embeddinggemma: ${err.message}`);
        return { ok: false };
      }
    } else {
      success("EmbeddingGemma already installed");
    }

    // ─── Step 9: Pick a Gemma 4 chat model ───────────────────────────────
    // Check if any Gemma 4 chat model is already installed first.
    const has26 = await detectOllamaModel("gemma4:26b");
    const has31 = await detectOllamaModel("gemma4:31b");
    const hasE2 = await detectOllamaModel("gemma4:e2b");
    const hasAny = has26.installed || has31.installed || hasE2.installed;

    // Skip the Gemma chat model download in the installer entirely.
    // Users pick + download a model from the running web app (Settings →
    // Manage models) where there's a real progress bar. The chat UI
    // detects this state and shows an empty-state banner asking the user
    // to either download a model or add a cloud provider before chatting.
    if (hasAny) {
      success("A Gemma 4 chat model is already installed");
    }
  }

  // ─── Step 10: Write .env.local ─────────────────────────────────────────
  const finalEnv = {
    DATABASE_URL: env.DATABASE_URL || connectionString,
    OLLAMA_URL: env.OLLAMA_URL || "http://localhost:11434",
    OLLAMA_CHAT_MODEL: env.OLLAMA_CHAT_MODEL || "gemma4:26b",
    OLLAMA_FAST_MODEL: env.OLLAMA_FAST_MODEL || "gemma4:e4b",
    OLLAMA_EMBED_MODEL: env.OLLAMA_EMBED_MODEL || "embeddinggemma",
  };
  writeEnv(ENV_PATH, finalEnv);

  // ─── Step 11: Production build (skipped in dev mode) ──────────────────
  if (!devMode) {
    const hasBuild = fs.existsSync(
      path.join(installPath, ".next", "BUILD_ID")
    );
    if (!hasBuild) {
      section("Building app for production");
      info("This takes about 30-60 seconds, but only on the first install.");
      try {
        const buildResult = spawnSync("npx", ["next", "build"], {
          cwd: installPath,
          stdio: silent ? "pipe" : "inherit",
          env: { ...process.env, ...finalEnv },
        });
        if (buildResult.status !== 0) {
          warn("Production build failed, will fall back to dev mode at runtime");
        } else {
          success("Production build complete");
        }
      } catch (err) {
        warn(`Build failed: ${err.message}`);
      }
    }
  }

  blank();
  success(color.bold("Setup complete!"));
  blank();
  console.log("One more thing before you can chat:");
  console.log("");
  console.log("  You need either a cloud API key OR a local Gemma 4 model.");
  console.log("");
  console.log("  When the app opens, click " + color.bold("Settings") + " in the top right.");
  console.log("  Then pick ONE of these:");
  console.log("");
  console.log("    A) " + color.bold("Providers") + " — add a Claude or OpenAI API key (~30 sec, fastest)");
  console.log("    B) " + color.bold("Manage models") + " — download Gemma 4 E4B for 100% local mode");
  console.log("");
  console.log("  Either one works. You can do both later.");
  blank();

  return { ok: true };
}

module.exports = { setupCommand };

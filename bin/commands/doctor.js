/**
 * recallmem doctor
 *
 * Diagnostic command. Checks every dependency and prints a status report.
 * Doesn't try to fix anything -- just tells you what's working and what's not.
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  detectNode,
  detectPostgres,
  detectPostgresService,
  detectPgvector,
  detectOllama,
  detectOllamaModel,
  detectDatabase,
} = require("../lib/detect");

const {
  color,
  symbols,
  printHeader,
  section,
  success,
  fail,
  warn,
  info,
  blank,
} = require("../lib/output");

const PROJECT_ROOT = process.cwd();
const ENV_PATH = path.join(PROJECT_ROOT, ".env.local");

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const text = fs.readFileSync(ENV_PATH, "utf-8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function doctorCommand() {
  printHeader();
  section("System");

  // Node
  const node = detectNode();
  if (node.ok) success(`Node.js ${node.version}`);
  else fail(`Node.js ${node.version} (need ${node.needed}+)`);

  // Postgres
  const pg = detectPostgres();
  if (pg.ok) success(`Postgres ${pg.major} (${pg.psqlPath})`);
  else if (pg.installed) fail(`Postgres ${pg.major} - too old, need 17+`);
  else fail("Postgres not installed");

  // Service
  if (pg.installed) {
    const svc = detectPostgresService();
    if (svc.running) success("Postgres service running on localhost:5432");
    else fail("Postgres installed but not running");
  }

  // Env file
  section("Configuration");
  const envExists = fs.existsSync(ENV_PATH);
  if (envExists) success(`.env.local found`);
  else warn(".env.local not found - run `npx recallmem init` to create it");

  const env = readEnv();
  if (env.DATABASE_URL) {
    info(`DATABASE_URL=${env.DATABASE_URL.replace(/:[^@]*@/, ":***@")}`);
  }
  if (env.OLLAMA_URL) info(`OLLAMA_URL=${env.OLLAMA_URL}`);
  if (env.OLLAMA_CHAT_MODEL) info(`OLLAMA_CHAT_MODEL=${env.OLLAMA_CHAT_MODEL}`);
  if (env.OLLAMA_FAST_MODEL) info(`OLLAMA_FAST_MODEL=${env.OLLAMA_FAST_MODEL}`);
  if (env.OLLAMA_EMBED_MODEL) info(`OLLAMA_EMBED_MODEL=${env.OLLAMA_EMBED_MODEL}`);

  // Database connectivity
  section("Database");
  if (env.DATABASE_URL && pg.installed) {
    const dbCheck = await detectDatabase(env.DATABASE_URL);
    if (dbCheck.exists) {
      success("Database reachable");
      const pgvec = await detectPgvector(env.DATABASE_URL);
      if (pgvec.available) success("pgvector extension available");
      else fail("pgvector extension not available");
    } else {
      fail(`Cannot connect to database: ${dbCheck.error}`);
    }
  } else {
    info("Skipped (DATABASE_URL not set)");
  }

  // Ollama
  section("LLM runtime");
  const ollama = detectOllama();
  if (ollama.running) {
    success(`Ollama running ${ollama.version || ""}`);

    // Required model
    const embed = await detectOllamaModel("embeddinggemma");
    if (embed.installed) success("embeddinggemma installed (required)");
    else fail("embeddinggemma not installed - run: ollama pull embeddinggemma");

    // Optional models
    const models = ["gemma4:26b", "gemma4:31b", "gemma4:e4b", "gemma4:e2b"];
    for (const m of models) {
      const r = await detectOllamaModel(m);
      if (r.installed) success(`${m} installed`);
    }
  } else if (ollama.installed) {
    warn("Ollama installed but not running");
    info("Try: brew services start ollama (Mac) or ollama serve");
  } else {
    warn("Ollama not installed (optional - cloud providers still work)");
  }

  blank();
  console.log(color.dim("Done. Run `npx recallmem init` to fix any issues."));
  blank();
}

module.exports = { doctorCommand };

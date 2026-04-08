/**
 * recallmem upgrade
 *
 * Pulls the latest code (git pull), reinstalls dependencies, runs pending
 * migrations, and rebuilds the production bundle so the next start picks up
 * the new code. Doesn't restart the server itself -- assumes you're not
 * running it, or you'll restart manually.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { gitPull, detectInstallMode } = require("../lib/install-mode");
const { color, section, success, fail, warn, info, blank } = require("../lib/output");

async function upgradeCommand() {
  const mode = detectInstallMode();

  if (mode.mode === "first-run") {
    fail("Nothing to upgrade -- no install found.");
    info("Run `npx recallmem` first to install.");
    return;
  }

  section(`Upgrading ${mode.path}`);

  // Pull latest code
  const pullResult = gitPull(mode.path);
  if (!pullResult.ok) {
    fail(`git pull failed: ${pullResult.error}`);
    process.exit(1);
  }

  // Run pending migrations
  section("Running migrations");
  const migrateResult = spawnSync("npx", ["tsx", "scripts/migrate.ts"], {
    cwd: mode.path,
    stdio: "inherit",
    env: process.env,
  });

  if (migrateResult.status !== 0) {
    fail("Migration failed");
    process.exit(1);
  }

  // Rebuild the production bundle so the next start picks up new code.
  // Skip in dev mode since developers run `next dev` (which compiles on demand).
  if (mode.mode !== "dev") {
    section("Rebuilding production bundle");
    info("This takes about 30-60 seconds.");

    // Wipe old build first so we always get fresh output
    const nextDir = path.join(mode.path, ".next");
    if (fs.existsSync(nextDir)) {
      fs.rmSync(nextDir, { recursive: true, force: true });
    }

    const buildResult = spawnSync("npx", ["next", "build"], {
      cwd: mode.path,
      stdio: "inherit",
      env: process.env,
    });
    if (buildResult.status !== 0) {
      warn("Build failed, will fall back to dev mode at runtime");
    } else {
      success("Production build complete");
    }
  }

  blank();
  success("Up to date");
  info("Restart with: npx recallmem");
  blank();
}

module.exports = { upgradeCommand };

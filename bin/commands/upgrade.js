/**
 * recallmem upgrade
 *
 * Pulls the latest code (git pull), reinstalls dependencies, and runs any
 * pending migrations. Doesn't restart the server -- assumes you're not
 * running it, or you'll restart manually.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { gitPull, detectInstallMode } = require("../lib/install-mode");
const { color, section, success, fail, info, blank } = require("../lib/output");

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

  blank();
  success("Up to date");
  info("Restart with: npx recallmem");
  blank();
}

module.exports = { upgradeCommand };

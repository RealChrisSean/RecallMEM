/**
 * recallmem upgrade
 *
 * Runs pending migrations. Useful after pulling new code that includes
 * new migration files. Doesn't restart the server -- assumes you're not
 * running it, or you'll restart manually.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { color, section, success, fail, info, blank } = require("../lib/output");

const PROJECT_ROOT = process.cwd();

async function upgradeCommand() {
  section("Running migrations");

  const result = spawnSync("npx", ["tsx", "scripts/migrate.ts"], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    fail("Upgrade failed");
    process.exit(1);
  }

  blank();
  success("Up to date");
  info("Restart the server to pick up any code changes: npx recallmem start");
  blank();
}

module.exports = { upgradeCommand };

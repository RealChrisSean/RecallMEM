#!/usr/bin/env node
/**
 * RecallMEM CLI
 *
 * The npx entry point. Pure Node.js, no React/Next imports.
 *
 * Auto-detects install mode and supports two workflows:
 *
 *   Use case 1 - "just run it" (most users):
 *     $ npx recallmem
 *     CLI clones the repo to ~/.recallmem on first run, then starts the app.
 *     Subsequent runs use ~/.recallmem and start instantly.
 *
 *   Use case 3 - "fork and hack on it" (developers):
 *     $ git clone https://github.com/RealChrisSean/RecallMEM.git
 *     $ cd RecallMEM && npm install
 *     $ npx recallmem
 *     CLI detects it's already inside a recallmem checkout and uses cwd.
 *     Hot reload works, edits are reflected immediately.
 *
 * Commands:
 *   recallmem            - run setup if needed, then start the server
 *   recallmem init       - setup only (deps check, migrations, models, env)
 *   recallmem start      - start the server (assumes init was done)
 *   recallmem doctor     - diagnose what's missing or broken
 *   recallmem upgrade    - git pull, run pending migrations, restart
 *   recallmem version    - print version
 */

const { setupCommand } = require("./commands/setup");
const { startCommand } = require("./commands/start");
const { doctorCommand } = require("./commands/doctor");
const { upgradeCommand } = require("./commands/upgrade");
const {
  detectInstallMode,
  cloneAndInstall,
  gitInstalled,
  RECALLMEM_HOME,
} = require("./lib/install-mode");
const {
  printHeader,
  color,
  step,
  success,
  fail,
  info,
  section,
  blank,
} = require("./lib/output");

const COMMANDS = {
  init: { fn: initCommand, desc: "Run setup only (deps check, DB, models, env)" },
  start: { fn: startWrapper, desc: "Start the server (assumes setup was done)" },
  doctor: { fn: doctorCommand, desc: "Diagnose what's missing or broken" },
  upgrade: { fn: upgradeCommand, desc: "Git pull and run pending migrations" },
  version: { fn: versionCommand, desc: "Print version" },
  help: { fn: helpCommand, desc: "Show this help" },
};

/**
 * Resolve the install path. If first-run, clone the repo to ~/.recallmem first.
 * Returns the install path or null on failure.
 */
async function resolveInstallPath() {
  const mode = detectInstallMode();

  if (mode.mode === "dev") {
    info(`Using local checkout: ${mode.path}`);
    return mode.path;
  }

  if (mode.mode === "user") {
    info(`Using install at: ${mode.path}`);
    return mode.path;
  }

  // First run - clone the repo
  section("First-time setup");
  info(`Cloning RecallMEM to ${mode.path}`);

  if (!gitInstalled()) {
    fail("git is not installed");
    blank();
    console.log("Install git first:");
    console.log("  Mac:    brew install git");
    console.log("  Linux:  sudo apt install git");
    console.log("  Win:    https://git-scm.com/download/win");
    return null;
  }

  const result = cloneAndInstall(mode.path);
  if (!result.ok) {
    fail(`Install failed: ${result.error}`);
    return null;
  }

  success(`Installed RecallMEM to ${mode.path}`);
  return mode.path;
}

async function initCommand() {
  printHeader();
  const installPath = await resolveInstallPath();
  if (!installPath) process.exit(1);
  const result = await setupCommand({ installPath });
  if (!result.ok) process.exit(1);
}

async function startWrapper() {
  const installPath = await resolveInstallPath();
  if (!installPath) process.exit(1);
  await startCommand({ installPath });
}

async function defaultCommand() {
  printHeader();
  const installPath = await resolveInstallPath();
  if (!installPath) process.exit(1);
  const setupResult = await setupCommand({ installPath, skipIfDone: true });
  if (!setupResult.ok) process.exit(1);
  await startCommand({ installPath });
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Default behavior: setup if needed, then start
  if (!cmd) {
    return defaultCommand();
  }

  if (cmd === "--help" || cmd === "-h") {
    return helpCommand();
  }

  if (cmd === "--version" || cmd === "-v") {
    return versionCommand();
  }

  const command = COMMANDS[cmd];
  if (!command) {
    console.error(color.red(`Unknown command: ${cmd}`));
    console.error("");
    helpCommand();
    process.exit(1);
  }

  try {
    await command.fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(color.red(`✗ ${message}`));
    process.exit(1);
  }
}

function helpCommand() {
  printHeader();
  console.log("Usage:");
  console.log(`  ${color.bold("recallmem")}                Setup if needed, then start the app`);
  console.log("");
  console.log("Commands:");
  for (const [name, { desc }] of Object.entries(COMMANDS)) {
    console.log(`  ${color.bold(name.padEnd(10))}        ${desc}`);
  }
  console.log("");
  console.log("Options:");
  console.log(`  ${color.bold("--help, -h")}            Show this help`);
  console.log(`  ${color.bold("--version, -v")}         Show version`);
  console.log("");
  console.log("Install location:");
  console.log(`  ${color.dim("Default: ~/.recallmem")}`);
  console.log(`  ${color.dim("Override: RECALLMEM_HOME=/custom/path npx recallmem")}`);
  console.log("");
  console.log("Docs: https://github.com/RealChrisSean/RecallMEM");
}

function versionCommand() {
  const pkg = require("../package.json");
  console.log(`recallmem ${pkg.version}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(color.red(`✗ ${message}`));
  process.exit(1);
});

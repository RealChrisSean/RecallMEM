#!/usr/bin/env node
/**
 * RecallMEM CLI
 *
 * The npx entry point. Pure Node.js, no React/Next imports.
 * Bootstraps dependencies, runs migrations, starts the dev server.
 *
 * Commands:
 *   recallmem            - run setup if needed, then start the server
 *   recallmem init       - setup only (deps check, migrations, models, env)
 *   recallmem start      - start the server (assumes init was done)
 *   recallmem doctor     - diagnose what's missing or broken
 *   recallmem upgrade    - run pending migrations and restart
 *   recallmem version    - print version
 */

const { setupCommand } = require("./commands/setup");
const { startCommand } = require("./commands/start");
const { doctorCommand } = require("./commands/doctor");
const { upgradeCommand } = require("./commands/upgrade");
const { printHeader, color } = require("./lib/output");

const COMMANDS = {
  init: { fn: setupCommand, desc: "Run setup only (deps check, DB, models, env)" },
  start: { fn: startCommand, desc: "Start the server (assumes setup was done)" },
  doctor: { fn: doctorCommand, desc: "Diagnose what's missing or broken" },
  upgrade: { fn: upgradeCommand, desc: "Run pending migrations and restart" },
  version: { fn: versionCommand, desc: "Print version" },
  help: { fn: helpCommand, desc: "Show this help" },
};

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Default behavior: run setup if needed, then start
  if (!cmd) {
    printHeader();
    const setupResult = await setupCommand({ silent: false, skipIfDone: true });
    if (!setupResult.ok) {
      process.exit(1);
    }
    await startCommand();
    return;
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

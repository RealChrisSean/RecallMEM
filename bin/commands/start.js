/**
 * recallmem start
 *
 * Starts the Next.js server. In dev mode (no .next build), runs `next dev`.
 * In production mode (built), runs `next start`.
 *
 * Opens the browser when the server is ready.
 */

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { color, section, success, info } = require("../lib/output");

const PROJECT_ROOT = process.cwd();

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" :
    platform === "win32" ? "start" :
    "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // best effort
  }
}

async function startCommand() {
  section("Starting RecallMEM");

  const hasBuild = fs.existsSync(path.join(PROJECT_ROOT, ".next", "BUILD_ID"));
  const command = hasBuild ? "start" : "dev";

  info(hasBuild ? "Production build detected, running next start" : "No build found, running next dev");
  info("Opening http://localhost:3000 in your browser...");
  console.log("");
  console.log(color.dim("  (Press Ctrl+C to stop)"));
  console.log("");

  // Open the browser shortly after starting (give Next a moment to be ready)
  setTimeout(() => openBrowser("http://localhost:3000"), 2000);

  const child = spawn("npx", ["next", command], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Server exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

module.exports = { startCommand };

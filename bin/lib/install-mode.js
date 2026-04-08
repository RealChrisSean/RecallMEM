/**
 * Install mode detection.
 *
 * The CLI supports three workflows that all use the same `recallmem` command:
 *
 *   1. "dev" mode  - already inside a recallmem git checkout
 *                    (cwd has package.json with name "recallmem", app/, lib/, migrations/)
 *                    Use cwd. Don't clone anything. Hot reload works.
 *
 *   2. "user" mode - ~/.recallmem already exists from a previous run
 *                    Use that. Skip the clone step.
 *
 *   3. "first-run" mode - neither of the above
 *                         Clone the repo to ~/.recallmem, then proceed.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync, spawnSync } = require("node:child_process");

const RECALLMEM_HOME =
  process.env.RECALLMEM_HOME || path.join(os.homedir(), ".recallmem");

const REPO_URL =
  process.env.RECALLMEM_REPO || "https://github.com/RealChrisSean/RecallMEM.git";

function isRecallmemCheckout(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (pkg.name !== "recallmem") return false;
    return (
      fs.existsSync(path.join(dir, "app")) &&
      fs.existsSync(path.join(dir, "lib")) &&
      fs.existsSync(path.join(dir, "migrations"))
    );
  } catch {
    return false;
  }
}

function detectInstallMode() {
  // 1. Are we already inside a recallmem checkout?
  if (isRecallmemCheckout(process.cwd())) {
    return { mode: "dev", path: process.cwd() };
  }

  // 2. Does ~/.recallmem already exist as a checkout?
  if (isRecallmemCheckout(RECALLMEM_HOME)) {
    return { mode: "user", path: RECALLMEM_HOME };
  }

  // 3. Need to clone
  return { mode: "first-run", path: RECALLMEM_HOME };
}

function gitInstalled() {
  try {
    execSync("git --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone the repo to ~/.recallmem and run npm install.
 * Returns true on success, false on failure.
 */
function cloneAndInstall(targetPath) {
  if (!gitInstalled()) {
    return { ok: false, error: "git is not installed" };
  }

  // Make sure parent dir exists
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  // Clone (shallow, single branch, fast)
  const cloneResult = spawnSync(
    "git",
    ["clone", "--depth", "1", REPO_URL, targetPath],
    { stdio: "inherit" }
  );
  if (cloneResult.status !== 0) {
    return { ok: false, error: "git clone failed" };
  }

  // Install npm dependencies inside the clone
  const installResult = spawnSync("npm", ["install"], {
    cwd: targetPath,
    stdio: "inherit",
  });
  if (installResult.status !== 0) {
    return { ok: false, error: "npm install failed" };
  }

  return { ok: true };
}

/**
 * Pull latest changes inside an existing install. Used by `recallmem upgrade`.
 */
function gitPull(targetPath) {
  if (!gitInstalled()) {
    return { ok: false, error: "git is not installed" };
  }
  if (!fs.existsSync(path.join(targetPath, ".git"))) {
    return {
      ok: false,
      error: `${targetPath} is not a git repository (was it cloned?)`,
    };
  }
  const result = spawnSync("git", ["pull"], {
    cwd: targetPath,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    return { ok: false, error: "git pull failed" };
  }
  // Re-install in case dependencies changed
  const installResult = spawnSync("npm", ["install"], {
    cwd: targetPath,
    stdio: "inherit",
  });
  if (installResult.status !== 0) {
    return { ok: false, error: "npm install failed" };
  }
  return { ok: true };
}

module.exports = {
  RECALLMEM_HOME,
  REPO_URL,
  isRecallmemCheckout,
  detectInstallMode,
  gitInstalled,
  cloneAndInstall,
  gitPull,
};

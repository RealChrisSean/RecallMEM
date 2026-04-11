import { NextRequest } from "next/server";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

// The install path. npx users get ~/.recallmem, dev users get cwd.
function getInstallPath(): string {
  const home = process.env.RECALLMEM_HOME || path.join(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".recallmem"
  );
  // If we're running from ~/.recallmem, use that. Otherwise use cwd.
  if (fs.existsSync(path.join(home, "package.json"))) return home;
  return process.cwd();
}

/**
 * GET /api/update — check if an update is available.
 * Compares the local package.json version against the latest GitHub tag.
 */
export async function GET() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(getInstallPath(), "package.json"), "utf-8")
    );
    const currentVersion = pkg.version;

    // Check latest version from GitHub tags
    const res = await fetch(
      "https://api.github.com/repos/RealChrisSean/RecallMEM/tags?per_page=1",
      { headers: { "User-Agent": "RecallMEM" } }
    );
    let latestVersion = currentVersion;
    if (res.ok) {
      const tags = (await res.json()) as Array<{ name: string }>;
      if (tags.length > 0) {
        latestVersion = tags[0].name.replace(/^v/, "");
      }
    }

    const updateAvailable = latestVersion !== currentVersion && latestVersion > currentVersion;

    return json({
      currentVersion,
      latestVersion,
      updateAvailable,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * POST /api/update — pull the latest code, install deps, run migrations.
 * Does NOT restart the server — the user needs to restart manually.
 */
export async function POST(_req: NextRequest) {
  const installPath = getInstallPath();

  const steps: { step: string; ok: boolean; output?: string }[] = [];

  // 1. Git pull
  try {
    const output = execSync("git pull origin main", {
      cwd: installPath,
      encoding: "utf-8",
      timeout: 30000,
    });
    steps.push({ step: "git pull", ok: true, output: output.trim() });
  } catch (err) {
    steps.push({
      step: "git pull",
      ok: false,
      output: err instanceof Error ? err.message : String(err),
    });
    return json({ ok: false, steps, message: "Git pull failed" }, 500);
  }

  // 2. npm install
  try {
    execSync("npm install --production", {
      cwd: installPath,
      encoding: "utf-8",
      timeout: 60000,
    });
    steps.push({ step: "npm install", ok: true });
  } catch (err) {
    steps.push({
      step: "npm install",
      ok: false,
      output: err instanceof Error ? err.message : String(err),
    });
    return json({ ok: false, steps, message: "npm install failed" }, 500);
  }

  // 3. Run migrations
  try {
    execSync("npx tsx scripts/migrate.ts", {
      cwd: installPath,
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env },
    });
    steps.push({ step: "migrations", ok: true });
  } catch (err) {
    steps.push({
      step: "migrations",
      ok: false,
      output: err instanceof Error ? err.message : String(err),
    });
    // Don't fail entirely — migrations might just be up to date
  }

  // Read the new version
  let newVersion = "unknown";
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(installPath, "package.json"), "utf-8")
    );
    newVersion = pkg.version;
  } catch { /* ignore */ }

  return json({
    ok: true,
    steps,
    newVersion,
    message: "Updated! Restart RecallMEM to apply the new version.",
  });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

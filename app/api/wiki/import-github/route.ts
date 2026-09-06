import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ingestWikiSource } from "@/lib/wiki";

export const runtime = "nodejs";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".go",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".sh",
  ".ex",
  ".exs",
  ".html",
  ".css",
]);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  "deps",
  "_build",
]);

const MAX_FILE_BYTES = 220_000;
const MAX_FILES_PER_REPO = 120;
const MAX_REPOS_PER_IMPORT = 8;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    brain?: string;
    repos?: string[];
  };
  const brain = body.brain || "default";
  const requestedRepos = Array.isArray(body.repos)
    ? body.repos.filter((repo): repo is string => typeof repo === "string")
    : [];
  const repos = Array.from(
    new Set(requestedRepos.map(normalizeGitHubRepo).filter(Boolean))
  ).slice(0, MAX_REPOS_PER_IMPORT);

  if (repos.length === 0) {
    return Response.json(
      { ok: false, error: "At least one public GitHub repository is required." },
      { status: 400 }
    );
  }

  const results = [];
  for (const repo of repos) {
    try {
      results.push(await importRepo(brain, repo));
    } catch (err) {
      results.push({
        repo,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return Response.json({ ok: true, results });
}

function normalizeGitHubRepo(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
}

async function importRepo(brain: string, repo: string) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid GitHub repo: ${repo}`);
  }

  const workDir = path.join(tmpdir(), `recallmem-wiki-${randomUUID()}`);
  const repoDir = path.join(workDir, repo.replace("/", "__"));
  const url = `https://github.com/${repo}.git`;

  await fs.mkdir(workDir, { recursive: true });
  try {
    await execFileAsync("git", ["clone", "--depth", "1", url, repoDir], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "rev-parse", "HEAD"], {
      timeout: 10_000,
    });
    const sha = stdout.trim();
    const files = await listTextFiles(repoDir);

    let changed = 0;
    let unchanged = 0;
    let chunks = 0;
    let embedded = 0;
    const errors: string[] = [];

    for (const filePath of files.slice(0, MAX_FILES_PER_REPO)) {
      const absolutePath = path.join(repoDir, filePath);
      try {
        const buffer = await fs.readFile(absolutePath);
        if (buffer.includes(0)) continue;
        const text = buffer.toString("utf8");
        if (!text.trim()) continue;
        const result = await ingestWikiSource({
          brain,
          title: repo,
          sourceKind: "repo",
          uri: `https://github.com/${repo}`,
          sourceRef: sha,
          path: filePath,
          text,
        });
        if (result.unchanged) unchanged += 1;
        else changed += 1;
        chunks += result.chunks;
        embedded += result.embedded;
        if (result.embeddingError) errors.push(`${filePath}: ${result.embeddingError}`);
      } catch (err) {
        errors.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      repo,
      ok: true,
      sha,
      filesConsidered: files.length,
      filesIngested: Math.min(files.length, MAX_FILES_PER_REPO),
      changed,
      unchanged,
      chunks,
      embedded,
      errors,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function listTextFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(absolute);
      if (stat.size > MAX_FILE_BYTES) continue;
      out.push(path.relative(root, absolute));
    }
  }
  await walk(root);
  return out.sort();
}

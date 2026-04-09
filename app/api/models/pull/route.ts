import "server-only";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/models/pull  body: { model: "gemma4:31b" }
 *
 * Kicks off an Ollama model pull in the background. The download runs
 * server-side and survives page navigation (the old SSE approach died
 * when the user left the settings page because the browser killed the
 * stream). Progress is tracked in a module-level map and polled via
 * GET /api/models/pull?model=...
 *
 * POST /api/models/pull/cancel  body: { model: "gemma4:31b" }
 * Aborts the in-flight download.
 */

interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
  error?: string;
  done: boolean;
}

// Module-level state so it survives across requests. One download at a
// time is fine for a single-user local app.
const activePulls = new Map<string, { progress: PullProgress; abort: AbortController }>();

export async function POST(req: NextRequest) {
  let model: string;
  try {
    const body = (await req.json()) as { model?: string };
    if (!body.model || typeof body.model !== "string") {
      return json({ error: "model name required" }, 400);
    }
    model = body.model;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  // Already downloading this model?
  const existing = activePulls.get(model);
  if (existing && !existing.progress.done) {
    return json({ ok: true, status: "already downloading" });
  }

  const abort = new AbortController();
  const progress: PullProgress = { status: "starting", done: false };
  activePulls.set(model, { progress, abort });

  // Fire-and-forget: start the pull in the background.
  const ollamaUrl = `${process.env.OLLAMA_URL || "http://localhost:11434"}/api/pull`;
  (async () => {
    try {
      const res = await fetch(ollamaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        progress.status = "error";
        progress.error = `Ollama returned ${res.status}`;
        progress.done = true;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line) as {
              status?: string;
              total?: number;
              completed?: number;
              error?: string;
            };
            if (j.error) {
              progress.status = "error";
              progress.error = j.error;
              progress.done = true;
              return;
            }
            progress.status = j.status || "downloading";
            if (j.total) progress.total = j.total;
            if (j.completed) progress.completed = j.completed;
            if (j.status === "success") {
              progress.done = true;
              return;
            }
          } catch {
            // skip malformed
          }
        }
      }
      // Stream ended without explicit success — mark done anyway
      if (!progress.done) {
        progress.done = true;
        if (!progress.error) progress.status = "success";
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        progress.status = "cancelled";
        progress.done = true;
      } else {
        progress.status = "error";
        progress.error = err instanceof Error ? err.message : String(err);
        progress.done = true;
      }
    }
  })();

  return json({ ok: true, status: "started" });
}

// GET /api/models/pull?model=gemma4:26b — poll progress
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const model = url.searchParams.get("model");
  if (!model) return json({ error: "model param required" }, 400);

  const entry = activePulls.get(model);
  if (!entry) return json({ status: "idle", done: true });

  const p = entry.progress;
  // Clean up after the client has seen the terminal state
  if (p.done) {
    activePulls.delete(model);
  }
  return json(p);
}

// DELETE /api/models/pull?model=gemma4:26b — cancel in-flight download
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const model = url.searchParams.get("model");
  if (!model) return json({ error: "model param required" }, 400);

  const entry = activePulls.get(model);
  if (!entry || entry.progress.done) {
    return json({ ok: true, status: "not downloading" });
  }
  entry.abort.abort();
  return json({ ok: true, status: "cancelled" });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

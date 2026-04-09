import "server-only";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/models/delete  body: { model: "gemma4:31b" }
 *
 * Removes a model from local Ollama. Frees the disk space immediately.
 * Wraps Ollama's DELETE /api/delete endpoint.
 *
 * Using POST instead of DELETE method so the body is unambiguous and
 * we don't fight with Next's router about DELETE-with-body semantics.
 */
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

  const ollamaUrl = `${process.env.OLLAMA_URL || "http://localhost:11434"}/api/delete`;

  try {
    const res = await fetch(ollamaUrl, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      const text = await res.text();
      return json(
        { error: `Ollama returned ${res.status}: ${text}` },
        502
      );
    }
    return json({ ok: true });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : String(err) },
      502
    );
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

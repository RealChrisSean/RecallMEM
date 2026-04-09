import "server-only";

export const runtime = "nodejs";

/**
 * GET /api/models/list
 *
 * Returns the list of Ollama models currently installed on this machine.
 * Used by the chat UI and the settings page to know which models are
 * actually pull-and-ready vs which ones need to be downloaded.
 *
 * Wraps Ollama's GET /api/tags endpoint with the same shape it uses.
 */
export async function GET() {
  const url = `${process.env.OLLAMA_URL || "http://localhost:11434"}/api/tags`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return json({ ok: false, error: `Ollama returned ${res.status}` }, 502);
    }
    const data = (await res.json()) as { models?: { name: string; size?: number }[] };
    const models = (data.models || []).map((m) => ({
      name: m.name,
      sizeBytes: m.size || 0,
    }));
    return json({ ok: true, models });
  } catch (err) {
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
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

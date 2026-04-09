import "server-only";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/models/pull  body: { model: "gemma4:31b" }
 *
 * Streams Ollama's pull progress to the browser as Server-Sent Events.
 * Each NDJSON line from Ollama becomes one SSE `data:` line. The client
 * shows a progress bar by reading `total` and `completed` from each
 * status frame.
 *
 * Ollama's /api/pull response is NDJSON (one JSON object per line):
 *   {"status":"pulling manifest"}
 *   {"status":"downloading","digest":"...","total":18000000000,"completed":1234567}
 *   {"status":"verifying sha256 digest"}
 *   {"status":"writing manifest"}
 *   {"status":"success"}
 */
export async function POST(req: NextRequest) {
  let model: string;
  try {
    const body = (await req.json()) as { model?: string };
    if (!body.model || typeof body.model !== "string") {
      return new Response(
        JSON.stringify({ error: "model name required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    model = body.model;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ollamaUrl = `${process.env.OLLAMA_URL || "http://localhost:11434"}/api/pull`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        const ollamaRes = await fetch(ollamaUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, stream: true }),
        });

        if (!ollamaRes.ok || !ollamaRes.body) {
          send({
            status: "error",
            error: `Ollama returned ${ollamaRes.status}`,
          });
          controller.close();
          return;
        }

        const reader = ollamaRes.body.getReader();
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
              const json = JSON.parse(line);
              send(json);
              if (json.status === "success") {
                controller.close();
                return;
              }
              if (json.error) {
                controller.close();
                return;
              }
            } catch {
              // skip malformed lines
            }
          }
        }
        controller.close();
      } catch (err) {
        send({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

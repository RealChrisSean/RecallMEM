import { NextRequest } from "next/server";
import { searchFacts } from "@/lib/facts";
import { searchChunks } from "@/lib/chunks";

export const runtime = "nodejs";

/**
 * POST /api/voice-agent/memory — vector search for the voice agent.
 * Called when Grok invokes the search_memory function during a conversation.
 * Returns relevant facts and past conversation excerpts.
 */
export async function POST(req: NextRequest) {
  const { query } = (await req.json()) as { query: string };
  const queryText = typeof query === "string" ? query.trim() : "";
  if (!queryText) return Response.json({ facts: [], conversations: [] });

  // Run fact search and chunk search in parallel
  const [relevantFacts, relevantChunks] = await Promise.all([
    searchFacts(queryText, 15).catch(() => []),
    searchChunks(queryText, null, 5).catch(() => []),
  ]);

  const facts = relevantFacts
    .filter(
      (f) =>
        f.match_reason !== "semantic" ||
        (f.distance !== null && f.distance < 0.65)
    )
    .map((f) => {
      const reason = f.match_reason === "receipt" ? "receipt match" : `${f.match_reason} match`;
      return `[${(f.valid_from || f.created_at).toISOString().slice(0, 10)}; ${reason}] ${f.fact_text}`;
    });

  const chunks = relevantChunks
    .filter(
      (c) =>
        c.match_reason !== "semantic" ||
        (c.distance !== null && c.distance < 0.6)
    )
    .map(
      (c) =>
        `[from ${c.chat_created_at.toISOString().slice(0, 10)}; ${c.match_reason} match] ${c.chunk_text}`
    );

  return Response.json({
    facts,
    conversations: chunks,
  });
}

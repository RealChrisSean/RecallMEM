import { NextRequest } from "next/server";
import { searchFacts, getPinnedFacts } from "@/lib/facts";
import { searchChunks } from "@/lib/chunks";

export const runtime = "nodejs";

/**
 * POST /api/voice-agent/memory — vector search for the voice agent.
 * Called when Grok invokes the search_memory function during a conversation.
 * Returns relevant facts and past conversation excerpts.
 */
export async function POST(req: NextRequest) {
  const { query } = (await req.json()) as { query: string };
  if (!query) return Response.json({ results: [] });

  // Run fact search and chunk search in parallel
  const [relevantFacts, relevantChunks] = await Promise.all([
    searchFacts(query, 15).catch(() => []),
    searchChunks(query, null, 5).catch(() => []),
  ]);

  const facts = relevantFacts
    .filter((f) => f.distance < 0.65)
    .map((f) => `[${(f.valid_from || f.created_at).toISOString().slice(0, 10)}] ${f.fact_text}`);

  const chunks = relevantChunks
    .filter((c) => c.distance < 0.6)
    .map((c) => `[from ${c.chat_created_at.toISOString().slice(0, 10)}] ${c.chunk_text}`);

  return Response.json({
    facts,
    conversations: chunks,
  });
}

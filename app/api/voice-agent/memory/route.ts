import { NextRequest } from "next/server";
import { searchFacts, searchFactsKeyword } from "@/lib/facts";
import { searchChunks, searchChunksKeyword } from "@/lib/chunks";

export const runtime = "nodejs";
const VOICE_MEMORY_SEMANTIC_BUDGET_MS = 900;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(fallback);
    }, ms);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * POST /api/voice-agent/memory — vector search for the voice agent.
 * Called when Deepgram invokes the search_memory function during a conversation.
 * Returns relevant facts and past conversation excerpts.
 */
export async function POST(req: NextRequest) {
  const { query } = (await req.json()) as { query: string };
  const queryText = typeof query === "string" ? query.trim() : "";
  if (!queryText) return Response.json({ facts: [], conversations: [] });

  // Realtime voice needs a tighter latency budget than chat. Return exact
  // keyword/receipt matches first, then include semantic matches only if they
  // finish quickly enough not to make the agent feel laggy.
  const [keywordFacts, keywordChunks] = await Promise.all([
    searchFactsKeyword(queryText, 10).catch(() => []),
    searchChunksKeyword(queryText, null, 3).catch(() => []),
  ]);

  const [semanticFacts, semanticChunks] = await Promise.all([
    withTimeout(searchFacts(queryText, 15), VOICE_MEMORY_SEMANTIC_BUDGET_MS, []),
    withTimeout(searchChunks(queryText, null, 5), VOICE_MEMORY_SEMANTIC_BUDGET_MS, []),
  ]);

  const factMap = new Map<string, string>();
  for (const text of [...keywordFacts, ...semanticFacts]
    .filter(
      (f) =>
        f.match_reason !== "semantic" ||
        (f.distance !== null && f.distance < 0.65)
    )
    .map((f) => {
      const reason = f.match_reason === "receipt" ? "receipt match" : `${f.match_reason} match`;
      return `[${(f.valid_from || f.created_at).toISOString().slice(0, 10)}; ${reason}] ${f.fact_text}`;
    })) {
    factMap.set(text, text);
  }

  const chunkMap = new Map<string, string>();
  for (const text of [...keywordChunks, ...semanticChunks]
    .filter(
      (c) =>
        c.match_reason !== "semantic" ||
        (c.distance !== null && c.distance < 0.6)
    )
    .map(
      (c) =>
        `[from ${c.chat_created_at.toISOString().slice(0, 10)}; ${c.match_reason} match] ${c.chunk_text}`
    )) {
    chunkMap.set(text, text);
  }

  return Response.json({
    facts: [...factMap.values()].slice(0, 15),
    conversations: [...chunkMap.values()].slice(0, 5),
  });
}

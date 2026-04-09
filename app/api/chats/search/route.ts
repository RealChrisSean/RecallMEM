import { NextRequest } from "next/server";
import { query, toVectorString, getUserId } from "@/lib/db";
import { embed } from "@/lib/embeddings";

export const runtime = "nodejs";

// Search chats by title (text mode) or by transcript content via vector
// similarity (vector mode). Returns an ordered list of matching chat ids.
//
//   GET /api/chats/search?q=...&mode=text|vector
//
// Text mode: ILIKE on title only. Instant, works on any hardware.
// Vector mode: embeds the query, runs cosine similarity over transcript chunks,
//   collapses to distinct chat ids ordered by best match. Also unions title
//   matches so a query like "databricks" still surfaces a chat titled
//   "Acme interview" even if the body wasn't embedded yet.
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const mode = url.searchParams.get("mode") === "vector" ? "vector" : "text";
    if (!q) return new Response(JSON.stringify({ chatIds: [] }), { headers: { "Content-Type": "application/json" } });

    const userId = await getUserId();
    const like = `%${q}%`;

    if (mode === "text") {
      const rows = await query<{ id: string }>(
        `SELECT id FROM s2m_chats
         WHERE user_id = $1 AND (title ILIKE $2 OR transcript ILIKE $2)
         ORDER BY updated_at DESC
         LIMIT 50`,
        [userId, like]
      );
      return new Response(
        JSON.stringify({ chatIds: rows.map((r) => r.id), mode: "text" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Vector mode: cosine similarity over chunks, plus union with title matches
    const vec = toVectorString(await embed(q));
    const chunkRows = await query<{ chat_id: string; distance: number }>(
      `SELECT chat_id, MIN(embedding <=> $1::vector) AS distance
       FROM s2m_transcript_chunks
       WHERE user_id = $2
       GROUP BY chat_id
       ORDER BY distance ASC
       LIMIT 25`,
      [vec, userId]
    );
    const titleRows = await query<{ id: string }>(
      `SELECT id FROM s2m_chats WHERE user_id = $1 AND title ILIKE $2 LIMIT 25`,
      [userId, like]
    );

    // Title matches go first, then vector matches not already included
    const seen = new Set<string>();
    const chatIds: string[] = [];
    for (const r of titleRows) {
      if (!seen.has(r.id)) { seen.add(r.id); chatIds.push(r.id); }
    }
    for (const r of chunkRows) {
      if (!seen.has(r.chat_id)) { seen.add(r.chat_id); chatIds.push(r.chat_id); }
    }

    return new Response(
      JSON.stringify({ chatIds, mode: "vector" }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

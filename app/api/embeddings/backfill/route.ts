import { query, getBaseUserId } from "@/lib/db";
import { embedBatchWithSource } from "@/lib/embeddings";

export const runtime = "nodejs";

/**
 * POST /api/embeddings/backfill
 *
 * Re-embeds all facts and transcript chunks with the current embedding provider.
 * Called when a user adds an OpenAI key — converts all Ollama 768-dim embeddings
 * to OpenAI 256-dim so vector search uses the same model everywhere.
 */
export async function POST() {
  const userId = await getBaseUserId();

  let factsUpdated = 0;
  let chunksUpdated = 0;

  // --- Backfill facts ---
  const facts = await query<{ id: string; fact_text: string }>(
    `SELECT id, fact_text FROM s2m_user_facts WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );

  if (facts.length > 0) {
    // Batch in groups of 100
    for (let i = 0; i < facts.length; i += 100) {
      const batch = facts.slice(i, i + 100);
      const texts = batch.map((f) => f.fact_text);
      const results = await embedBatchWithSource(texts);
      const col = results[0].source === "openai" ? "embedding_oai" : "embedding";

      for (let j = 0; j < batch.length; j++) {
        const vecStr = `[${results[j].vector.join(",")}]`;
        await query(
          `UPDATE s2m_user_facts SET ${col} = $1::vector WHERE id = $2`,
          [vecStr, batch[j].id]
        );
        factsUpdated++;
      }
    }
  }

  // --- Backfill transcript chunks ---
  const chunks = await query<{ id: string; chunk_text: string }>(
    `SELECT id, chunk_text FROM s2m_transcript_chunks WHERE user_id = $1`,
    [userId]
  );

  if (chunks.length > 0) {
    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      const texts = batch.map((c) => c.chunk_text.slice(0, 1000));
      const results = await embedBatchWithSource(texts);
      const col = results[0].source === "openai" ? "embedding_oai" : "embedding";

      for (let j = 0; j < batch.length; j++) {
        const vecStr = `[${results[j].vector.join(",")}]`;
        await query(
          `UPDATE s2m_transcript_chunks SET ${col} = $1::vector WHERE id = $2`,
          [vecStr, batch[j].id]
        );
        chunksUpdated++;
      }
    }
  }

  return Response.json({
    ok: true,
    factsUpdated,
    chunksUpdated,
    total: factsUpdated + chunksUpdated,
  });
}

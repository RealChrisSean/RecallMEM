import { query, toVectorString, getUserId } from "@/lib/db";
import { embedWithSource, embedBatchWithSource, getEmbeddingSource } from "@/lib/embeddings";

// Which column to use based on embedding source
function embCol(source: "openai" | "ollama"): string {
  return source === "openai" ? "embedding_oai" : "embedding";
}

// Split a transcript into ~1000 char chunks at sentence/message boundaries
export function chunkTranscript(transcript: string, maxChars = 1000): string[] {
  if (!transcript) return [];

  const messages = transcript.split(/\n\n+/).filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";

  for (const msg of messages) {
    if (buffer.length + msg.length + 2 > maxChars && buffer) {
      chunks.push(buffer.trim());
      buffer = msg;
    } else {
      buffer = buffer ? `${buffer}\n\n${msg}` : msg;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

// Embed transcript chunks for a chat and store them. Replaces existing chunks for that chat.
export async function embedAndStoreChunks(
  chatId: string,
  transcript: string
): Promise<number> {
  const userId = await getUserId();
  const chunks = chunkTranscript(transcript);
  if (chunks.length === 0) return 0;

  await query(`DELETE FROM s2m_transcript_chunks WHERE chat_id = $1`, [chatId]);

  const results = await embedBatchWithSource(chunks);
  const col = embCol(results[0].source);

  for (let i = 0; i < chunks.length; i++) {
    await query(
      `INSERT INTO s2m_transcript_chunks (user_id, chat_id, chunk_text, chunk_index, ${col})
       VALUES ($1, $2, $3, $4, $5::vector)`,
      [userId, chatId, chunks[i], i, toVectorString(results[i].vector)]
    );
  }
  return chunks.length;
}

// Embed a single exchange and store it. Called after each response
// so older messages are searchable via the sliding window.
export async function embedExchange(
  chatId: string,
  userMessage: string,
  assistantMessage: string,
  exchangeIndex: number
): Promise<void> {
  const userId = await getUserId();
  const text = `${userMessage}\n${assistantMessage}`.trim();
  if (!text || text.length < 20) return;

  const result = await embedWithSource(text.slice(0, 1000));
  const col = embCol(result.source);

  await query(
    `INSERT INTO s2m_transcript_chunks (user_id, chat_id, chunk_text, chunk_index, ${col})
     VALUES ($1, $2, $3, $4, $5::vector)`,
    [userId, chatId, text, exchangeIndex, toVectorString(result.vector)]
  );
}

// Vector search within a specific chat (for sliding window context retrieval)
export async function searchChunksInChat(
  queryText: string,
  chatId: string,
  limit = 3
): Promise<{ chunk_text: string; distance: number }[]> {
  const userId = await getUserId();
  const result = await embedWithSource(queryText);
  const col = embCol(result.source);
  const vector = toVectorString(result.vector);

  return query(
    `SELECT chunk_text, ${col} <=> $1::vector AS distance
     FROM s2m_transcript_chunks
     WHERE user_id = $2 AND chat_id = $3 AND ${col} IS NOT NULL
     ORDER BY distance ASC
     LIMIT $4`,
    [vector, userId, chatId, limit]
  );
}

// Vector search over past transcript chunks for relevant context.
export async function searchChunks(
  queryText: string,
  excludeChatId: string | null = null,
  limit = 5
): Promise<{ chunk_text: string; distance: number; chat_id: string; chat_created_at: Date }[]> {
  const userId = await getUserId();
  const result = await embedWithSource(queryText);
  const col = embCol(result.source);
  const vector = toVectorString(result.vector);

  if (excludeChatId) {
    return query(
      `SELECT c.chunk_text, c.chat_id, ch.created_at AS chat_created_at,
              c.${col} <=> $1::vector AS distance
       FROM s2m_transcript_chunks c
       JOIN s2m_chats ch ON ch.id = c.chat_id
       WHERE c.user_id = $2 AND c.chat_id != $3 AND c.${col} IS NOT NULL
       ORDER BY distance ASC
       LIMIT $4`,
      [vector, userId, excludeChatId, limit]
    );
  }

  return query(
    `SELECT c.chunk_text, c.chat_id, ch.created_at AS chat_created_at,
            c.${col} <=> $1::vector AS distance
     FROM s2m_transcript_chunks c
     JOIN s2m_chats ch ON ch.id = c.chat_id
     WHERE c.user_id = $2 AND c.${col} IS NOT NULL
     ORDER BY distance ASC
     LIMIT $3`,
    [vector, userId, limit]
  );
}

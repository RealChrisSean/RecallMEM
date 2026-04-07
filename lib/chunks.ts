import { query, toVectorString } from "@/lib/db";
import { embed, embedBatch } from "@/lib/embeddings";

const USER_ID = "local-user";

// Split a transcript into ~1000 char chunks at sentence/message boundaries
export function chunkTranscript(transcript: string, maxChars = 1000): string[] {
  if (!transcript) return [];

  // Split on message boundaries first (\n\n)
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
  const chunks = chunkTranscript(transcript);
  if (chunks.length === 0) return 0;

  // Delete existing chunks for this chat (we always replace, so re-saves stay in sync)
  await query(`DELETE FROM s2m_transcript_chunks WHERE chat_id = $1`, [chatId]);

  // Generate embeddings in one batch call
  const embeddings = await embedBatch(chunks);

  // Insert all chunks
  for (let i = 0; i < chunks.length; i++) {
    await query(
      `INSERT INTO s2m_transcript_chunks (user_id, chat_id, chunk_text, chunk_index, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)`,
      [USER_ID, chatId, chunks[i], i, toVectorString(embeddings[i])]
    );
  }
  return chunks.length;
}

// Vector search over past transcript chunks for relevant context
export async function searchChunks(
  queryText: string,
  excludeChatId: string | null = null,
  limit = 5
): Promise<{ chunk_text: string; distance: number; chat_id: string }[]> {
  const queryEmbedding = await embed(queryText);
  const vector = toVectorString(queryEmbedding);

  if (excludeChatId) {
    return query(
      `SELECT chunk_text, chat_id, embedding <=> $1::vector AS distance
       FROM s2m_transcript_chunks
       WHERE user_id = $2 AND chat_id != $3
       ORDER BY distance ASC
       LIMIT $4`,
      [vector, USER_ID, excludeChatId, limit]
    );
  }

  return query(
    `SELECT chunk_text, chat_id, embedding <=> $1::vector AS distance
     FROM s2m_transcript_chunks
     WHERE user_id = $2
     ORDER BY distance ASC
     LIMIT $3`,
    [vector, USER_ID, limit]
  );
}

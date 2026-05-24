import { NextRequest } from "next/server";
import {
  storeFacts,
  recategorizeAllFacts,
} from "@/lib/facts";
import { rebuildProfile } from "@/lib/profile";
import { embedAndStoreChunks } from "@/lib/chunks";
import { getUserId, query } from "@/lib/db";
import { v5 as uuidv5 } from "uuid";

export const runtime = "nodejs";

const EXTERNAL_MEMORY_NAMESPACE = "3dd86b58-f1b8-4e92-a9c2-43683b6eb123";

/**
 * POST /api/memory/ingest
 *
 * Accepts facts from external sources (Moose connectors, etc) and runs
 * them through the same validation pipeline as chat-extracted facts:
 * garbage filter, dedup, categorize, store.
 *
 * Body: { facts: string[], source?: string }
 *
 * The source field is informational only (logged, not stored). Facts
 * go through the same validation as chat-extracted ones — garbage
 * patterns are rejected, duplicates are skipped, categories are
 * assigned by keyword matching.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      facts?: string[];
      source?: string;
    };

    if (!body.facts || !Array.isArray(body.facts) || body.facts.length === 0) {
      return json({ error: "facts array required" }, 400);
    }

    const source = body.source || "external";
    // Pass null for sourceChatId since these facts come from external
    // connectors, not from a chat conversation.
    const inserted = await storeFacts(body.facts, null);

    if (inserted > 0) {
      const moved = await recategorizeAllFacts();
      await rebuildProfile();
      console.log(
        `[ingest] source=${source} received=${body.facts.length} inserted=${inserted} recategorized=${moved}`
      );

      // Also embed the facts as transcript chunks so vector search
      // can find external data (Notion, Gmail, Calendar, GitHub),
      // not just chat transcripts. This is what makes "what's in my
      // Notion?" actually work via semantic search.
      try {
        const transcript = body.facts.join("\n\n");
        const externalChatId = await upsertExternalMemoryChat(source, transcript, body.facts.length);
        await embedAndStoreChunks(externalChatId, transcript);
        console.log(`[ingest] embedded ${body.facts.length} facts as chunks for vector search`);
      } catch (err) {
        console.error("[ingest] embedding failed:", err);
      }
    }

    return json({
      ok: true,
      received: body.facts.length,
      inserted,
      source,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
}

async function upsertExternalMemoryChat(
  source: string,
  transcript: string,
  factCount: number
): Promise<string> {
  const userId = await getUserId();
  const chatId = uuidv5(`external-memory:${userId}:${source}`, EXTERNAL_MEMORY_NAMESPACE);

  await query(
    `INSERT INTO s2m_chats (id, user_id, title, transcript, message_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE
       SET transcript = EXCLUDED.transcript,
           message_count = EXCLUDED.message_count,
           updated_at = NOW()`,
    [chatId, userId, `External memory: ${source}`, transcript, factCount]
  );

  return chatId;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

import { chat as llmChat, FAST_MODEL } from "@/lib/llm";
import { setChatTitle, getChat } from "@/lib/chats";
import { extractFactsFromTranscript, storeFacts } from "@/lib/facts";
import { rebuildProfile } from "@/lib/profile";
import { embedAndStoreChunks } from "@/lib/chunks";

// Run after a chat exchange completes. Generates title (if missing), extracts facts,
// re-synthesizes profile, and embeds transcript chunks for vector search.
// Fire-and-forget from the chat endpoint.
export async function runPostChatPipeline(chatId: string): Promise<void> {
  try {
    const chatRow = await getChat(chatId);
    if (!chatRow || !chatRow.transcript) return;

    // 1. Generate title if missing and we have at least 2 messages
    if (!chatRow.title && chatRow.message_count >= 2) {
      try {
        const title = await generateTitle(chatRow.transcript);
        if (title) await setChatTitle(chatId, title);
      } catch (err) {
        console.error("[post-chat] title generation failed:", err);
      }
    }

    // 2. Extract facts (skip very short conversations)
    if (chatRow.message_count >= 4 && chatRow.transcript.length >= 200) {
      try {
        const facts = await extractFactsFromTranscript(chatRow.transcript);
        if (facts.length > 0) {
          const inserted = await storeFacts(facts, chatId);
          console.log(`[post-chat] extracted ${facts.length} facts, inserted ${inserted} new`);

          // 3. Rebuild profile if we added new facts
          if (inserted > 0) {
            await rebuildProfile();
          }
        }
      } catch (err) {
        console.error("[post-chat] fact extraction failed:", err);
      }
    }

    // 4. Embed and store transcript chunks for vector search
    try {
      const count = await embedAndStoreChunks(chatId, chatRow.transcript);
      console.log(`[post-chat] embedded ${count} chunks`);
    } catch (err) {
      console.error("[post-chat] embedding failed:", err);
    }
  } catch (err) {
    console.error("[post-chat] pipeline failed:", err);
  }
}

async function generateTitle(transcript: string): Promise<string | null> {
  // Just use the first ~1500 chars for the title prompt
  const snippet = transcript.slice(0, 1500);
  const response = await llmChat(
    [
      {
        role: "user",
        content: `Generate a short, descriptive title (3-7 words) for this conversation. Return ONLY the title, no quotes, no commentary.

Conversation:
${snippet}

Title:`,
      },
    ],
    { model: FAST_MODEL }
  );
  const cleaned = response
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^title:\s*/i, "")
    .trim();
  if (cleaned.length === 0 || cleaned.length > 100) return null;
  return cleaned;
}

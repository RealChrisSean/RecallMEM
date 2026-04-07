import { getProfile } from "@/lib/profile";
import { getActiveFacts } from "@/lib/facts";
import { searchChunks } from "@/lib/chunks";
import { getLastChatTime } from "@/lib/chats";
import { getRules } from "@/lib/rules";
import { buildSystemPrompt } from "@/lib/prompts";

const MAX_QUICK_FACTS = 50;

// Load the full memory context for a chat and build the system prompt.
// This is what gets injected as the system message in every LLM call.
export async function buildMemoryAwareSystemPrompt(
  latestUserMessage: string,
  excludeChatId: string | null
): Promise<string> {
  const [profileRow, facts, lastChatTime, customRules] = await Promise.all([
    getProfile(),
    getActiveFacts(MAX_QUICK_FACTS),
    getLastChatTime(),
    getRules(),
  ]);

  // Vector search for relevant past chunks (skip if no message yet)
  let recallChunks: string[] = [];
  if (latestUserMessage && latestUserMessage.length > 5) {
    try {
      const results = await searchChunks(latestUserMessage, excludeChatId, 5);
      // Only include chunks that are reasonably similar (cosine distance < 0.6)
      recallChunks = results
        .filter((r) => r.distance < 0.6)
        .map((r) => r.chunk_text);
    } catch (err) {
      console.error("[memory] vector search failed:", err);
    }
  }

  return buildSystemPrompt({
    profile: profileRow?.profile_summary || null,
    recentFacts: facts.map((f) => f.fact_text),
    recallChunks,
    lastChatTime,
    customRules: customRules || null,
  });
}

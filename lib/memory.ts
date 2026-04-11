import { getProfile } from "@/lib/profile";
import { getActiveFacts } from "@/lib/facts";
import { searchChunks } from "@/lib/chunks";
import { getLastChatTime } from "@/lib/chats";
import { getRules } from "@/lib/rules";
import { buildSystemPrompt } from "@/lib/prompts";

const MAX_QUICK_FACTS = 200;

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

  // Vector search for relevant past chunks (skip if no message yet). Each
  // surviving chunk is stamped with its chat's date so the model knows
  // when this context was created.
  let recallChunks: { text: string; date: Date }[] = [];
  if (latestUserMessage && latestUserMessage.length > 5) {
    try {
      const results = await searchChunks(latestUserMessage, excludeChatId, 5);
      recallChunks = results
        .filter((r) => r.distance < 0.6)
        .map((r) => ({ text: r.chunk_text, date: r.chat_created_at }));
    } catch (err) {
      console.error("[memory] vector search failed:", err);
    }
  }

  return buildSystemPrompt({
    profile: profileRow?.profile_summary || null,
    recentFacts: facts.map((f) => ({
      text: f.fact_text,
      date: f.valid_from || f.created_at,
    })),
    recallChunks,
    lastChatTime,
    customRules: customRules || null,
  });
}

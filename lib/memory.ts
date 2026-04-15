import { getProfile } from "@/lib/profile";
import { getSmartFacts } from "@/lib/facts";
import { searchChunks } from "@/lib/chunks";
import { getLastChatTime } from "@/lib/chats";
import { getRules } from "@/lib/rules";
import { buildSystemPrompt } from "@/lib/prompts";

// Load the full memory context for a chat and build the system prompt.
// This is what gets injected as the system message in every LLM call.
export async function buildMemoryAwareSystemPrompt(
  latestUserMessage: string,
  excludeChatId: string | null
): Promise<string> {
  const [profileRow, facts, lastChatTime, customRules] = await Promise.all([
    getProfile(),
    getSmartFacts(latestUserMessage, 150),
    getLastChatTime(),
    getRules(),
  ]);

  // Vector search for relevant past chunks (skip if no message yet). Each
  // surviving chunk is stamped with its chat's date so the model knows
  // when this context was created.
  let recallChunks: { text: string; date: Date }[] = [];
  if (latestUserMessage && latestUserMessage.length > 5) {
    try {
      const searchPromise = searchChunks(latestUserMessage, excludeChatId, 8);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000)
      );
      const results = await Promise.race([searchPromise, timeoutPromise]);
      recallChunks = results
        .filter((r) => r.distance < 0.6)
        .map((r) => ({ text: r.chunk_text, date: r.chat_created_at }));
    } catch (err) {
      console.warn("[memory] vector search timed out, continuing without recalled chunks");
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

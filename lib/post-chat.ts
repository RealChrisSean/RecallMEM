import { chat as llmChat, FAST_MODEL, getCheapestLLM } from "@/lib/llm";
import { setChatTitle, getChat } from "@/lib/chats";
import {
  extractFactsWithSupersession,
  markFactsSuperseded,
  storeFacts,
  recategorizeAllFacts,
} from "@/lib/facts";
import { rebuildProfile } from "@/lib/profile";
import { embedAndStoreChunks } from "@/lib/chunks";
import { getLangfuse } from "@/lib/langfuse";

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

    // 2. Extract facts + supersede stale ones (skip very short conversations).
    // Use whichever model + provider was last used for this chat so cloud
    // users get extraction via their cloud provider and local users get
    // free local extraction. Falls back to FAST_MODEL via Ollama if the
    // chat row doesn't have a model recorded yet (older chats).
    if (chatRow.message_count >= 4 && chatRow.transcript.length >= 200) {
      try {
        const cheapLLM = await getCheapestLLM();
        const { facts, supersedes } = await extractFactsWithSupersession(
          chatRow.transcript,
          cheapLLM
        );
        const retired = await markFactsSuperseded(supersedes, chatId);
        const inserted = facts.length > 0 ? await storeFacts(facts, chatId) : 0;
        console.log(
          `[post-chat] extracted ${facts.length}, inserted ${inserted}, retired ${retired}`
        );

        // 3. Rebuild profile if anything changed
        if (inserted > 0 || retired > 0) {
          const moved = await recategorizeAllFacts();
          if (moved > 0) console.log(`[post-chat] recategorized ${moved} facts`);
          await rebuildProfile();
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

// Per-message live extraction. Runs after every assistant reply as fire-and-
// forget so facts surface in real time without waiting for the user to end
// the chat. Uses whichever LLM the user is currently chatting with (cloud
// or local) so we don't fail silently when the hardcoded FAST_MODEL isn't
// installed on a fresh machine. Local models = free; cloud providers =
// small per-turn cost.
export async function extractFactsLive(
  chatId: string,
  _llmOpts: { model?: string; providerId?: string } = {}
): Promise<void> {
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "live-fact-extraction",
    metadata: { chatId },
  });
  try {
    const chatRow = await getChat(chatId);
    if (!chatRow || !chatRow.transcript) {
      trace?.update({ output: { skipped: "no transcript" } });
      return;
    }
    if (chatRow.message_count < 2 || chatRow.transcript.length < 100) {
      trace?.update({ output: { skipped: "below quality bar" } });
      return;
    }

    // Only extract from the LATEST exchange, not the full transcript.
    // The active facts list handles contradiction detection.
    // This cuts Haiku input from ~50K tokens to ~2K per call.
    let latestExchange = chatRow.transcript;
    try {
      const parsed = JSON.parse(chatRow.transcript);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        const lastTwo = parsed.slice(-2);
        latestExchange = lastTwo.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join("\n\n");
      }
    } catch {
      // Plain text transcript -- grab last user+assistant block
      const blocks = chatRow.transcript.split(/\n\n+/);
      const lastBlocks: string[] = [];
      let found = 0;
      for (let i = blocks.length - 1; i >= 0 && found < 2; i--) {
        if (blocks[i].startsWith("user:") || blocks[i].startsWith("assistant:")) {
          lastBlocks.unshift(blocks[i]);
          found++;
        }
      }
      if (lastBlocks.length > 0) latestExchange = lastBlocks.join("\n\n");
    }

    const extractSpan = trace?.span({
      name: "extract-and-supersede",
      input: { exchangeLength: latestExchange.length },
    });
    const cheapLLM = await getCheapestLLM();
    const { facts, supersedes } = await extractFactsWithSupersession(
      latestExchange,
      cheapLLM
    );
    extractSpan?.end({ output: { facts, supersedes } });

    const retired = await markFactsSuperseded(supersedes, chatId);
    const inserted = facts.length > 0 ? await storeFacts(facts, chatId) : 0;
    console.log(
      `[live-facts] extracted ${facts.length} new, inserted ${inserted}, retired ${retired}`
    );
    if (inserted > 0 || retired > 0) {
      const moved = await recategorizeAllFacts();
      if (moved > 0) console.log(`[live-facts] recategorized ${moved}`);
      await rebuildProfile();
    }
    trace?.update({
      output: { factsExtracted: facts.length, inserted, retired },
    });
  } catch (err) {
    trace?.update({
      output: { error: err instanceof Error ? err.message : String(err) },
    });
    console.error("[live-facts] failed:", err);
  } finally {
    // Flush so the trace shows up immediately even though this is fire-
    // and-forget. Without this, the request handler returns before the
    // SDK has a chance to send.
    await langfuse?.flushAsync().catch(() => {});
  }
}

// Just the title step from the pipeline. Used after the very first assistant
// response so the chat shows up in the sidebar with a real title immediately,
// instead of waiting for the user to click "New chat".
//
// If `providerId` is passed, it uses the same cloud provider the chat is using
// (so cloud-only users without Ollama still get titles). Otherwise it falls
// back to the local FAST_MODEL via Ollama.
export async function generateTitleIfMissing(
  chatId: string,
  _opts: { providerId?: string } = {}
): Promise<void> {
  try {
    const chatRow = await getChat(chatId);
    if (!chatRow || !chatRow.transcript) return;
    if (chatRow.title) return;
    if (chatRow.message_count < 2) return;

    const title = await generateTitle(chatRow.transcript);
    if (title) await setChatTitle(chatId, title);
  } catch (err) {
    console.error("[post-chat] early title generation failed:", err);
  }
}

async function generateTitle(
  transcript: string,
): Promise<string | null> {
  const snippet = transcript.slice(0, 1500);

  // Always use the cheapest available model for title generation
  const llmOpts = await getCheapestLLM();

  let response: string;
  try {
    response = await llmChat(
      [
        {
          role: "user",
          content: `Generate a short, descriptive title (3-7 words) for this conversation. Return ONLY the title, no quotes, no commentary.

Conversation:
${snippet}

Title:`,
        },
      ],
      llmOpts
    );
  } catch (err) {
    console.error("[post-chat] title LLM call failed, using fallback:", err);
    // Fallback: extract the first user message and truncate
    const firstUserLine = transcript
      .split(/\n\n+/)
      .find((b) => b.startsWith("user:"));
    if (firstUserLine) {
      const text = firstUserLine.replace(/^user:\s*/i, "").trim();
      const truncated = text.length > 50 ? text.slice(0, 47) + "..." : text;
      return truncated || null;
    }
    return null;
  }

  const cleaned = response
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^title:\s*/i, "")
    .trim();
  if (cleaned.length === 0 || cleaned.length > 100) return null;
  return cleaned;
}

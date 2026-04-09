import { chat as llmChat, FAST_MODEL } from "@/lib/llm";
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

    // 2. Extract facts + supersede stale ones (skip very short conversations)
    if (chatRow.message_count >= 4 && chatRow.transcript.length >= 200) {
      try {
        const { facts, supersedes } = await extractFactsWithSupersession(
          chatRow.transcript
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
// forget so facts surface in real time without waiting for the user to end the
// chat. Always uses the local FAST_MODEL (Ollama) so cloud-provider users
// don't get billed per turn for fact extraction.
export async function extractFactsLive(chatId: string): Promise<void> {
  // Standalone trace - this runs fire-and-forget after the chat trace has
  // already finished, so we don't try to nest it under the parent.
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
    // Same quality bar as the batch pipeline so we don't extract from a
    // single greeting.
    if (chatRow.message_count < 2 || chatRow.transcript.length < 100) {
      trace?.update({ output: { skipped: "below quality bar" } });
      return;
    }

    // Combined extract + supersede in one LLM call. Retires stale facts
    // ("works at TiDB" once "got laid off from TiDB" is said) so the
    // active set always reflects current truth.
    const extractSpan = trace?.span({
      name: "extract-and-supersede",
      input: { transcriptLength: chatRow.transcript.length },
    });
    const { facts, supersedes } = await extractFactsWithSupersession(
      chatRow.transcript
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
  opts: { providerId?: string } = {}
): Promise<void> {
  try {
    const chatRow = await getChat(chatId);
    if (!chatRow || !chatRow.transcript) return;
    if (chatRow.title) return; // already has one
    if (chatRow.message_count < 2) return; // need at least one user msg + one assistant reply

    const title = await generateTitle(chatRow.transcript, opts);
    if (title) await setChatTitle(chatId, title);
  } catch (err) {
    console.error("[post-chat] early title generation failed:", err);
  }
}

async function generateTitle(
  transcript: string,
  opts: { providerId?: string } = {}
): Promise<string | null> {
  // Just use the first ~1500 chars for the title prompt
  const snippet = transcript.slice(0, 1500);

  // If a providerId is passed, route through the user's selected cloud provider.
  // Otherwise use the local FAST_MODEL (Gemma 4 E4B via Ollama).
  // Falls back to a heuristic title if both fail (e.g., Ollama down + no provider).
  const llmOpts = opts.providerId
    ? { providerId: opts.providerId }
    : { model: FAST_MODEL };

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

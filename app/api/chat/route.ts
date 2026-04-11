import { NextRequest } from "next/server";
import { chatStream, type ModelMode, type ChatMessage } from "@/lib/llm";
import { createChat, updateChat, getChat } from "@/lib/chats";
import { buildMemoryAwareSystemPrompt } from "@/lib/memory";
import { generateTitleIfMissing, extractFactsLive } from "@/lib/post-chat";
import { getLangfuse } from "@/lib/langfuse";
import { searchWeb, formatWebOutcome } from "@/lib/web-search";
import { getProvider } from "@/lib/providers";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      messages: Message[];
      mode?: ModelMode;
      chatId?: string;
      model?: string;
      providerId?: string;
      webSearch?: boolean;
      thinking?: boolean;
      privateMode?: boolean;
    };

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const mode: ModelMode = body.mode || "standard";

    // Open a Langfuse trace for this turn (no-op if env vars unset).
    // Spans for memory build, llm generation, fact extraction etc all
    // hang off this trace so the whole pipeline shows up in one timeline.
    const langfuse = getLangfuse();
    const trace = langfuse?.trace({
      name: "chat-turn",
      input: { lastUserMessage: body.messages[body.messages.length - 1]?.content },
      metadata: {
        mode,
        providerId: body.providerId || null,
        model: body.model || null,
        webSearch: !!body.webSearch,
        messageCount: body.messages.length,
      },
    });

    // Get or create chat row. Track the chat's last-updated timestamp so we
    // can detect "this is a resumed chat from days ago" and inject a gap
    // marker into the conversation.
    let chatId = body.chatId;
    let chatLastUpdated: Date | null = null;
    if (chatId) {
      const existing = await getChat(chatId);
      if (!existing) {
        chatId = undefined;
      } else {
        chatLastUpdated = existing.updated_at;
      }
    }
    if (!chatId) {
      chatId = await createChat(mode);
    }

    // Build system prompt. In private mode, skip all memory context
    // (profile, facts, vector search) and only include custom rules.
    // The user's personal data never reaches the cloud LLM.
    const latestUserMessage = body.messages[body.messages.length - 1];
    let systemPromptText: string;

    if (body.privateMode) {
      // Private mode: rules only, no memory
      const { getRules } = await import("@/lib/rules");
      const rules = await getRules();
      systemPromptText = rules
        ? `You are a helpful assistant.\n\n<custom_rules>\n${rules}\n</custom_rules>`
        : "You are a helpful assistant.";
    } else {
      const memorySpan = trace?.span({
        name: "build-memory-prompt",
        input: { query: latestUserMessage.content, chatId },
      });
      systemPromptText = await buildMemoryAwareSystemPrompt(
        latestUserMessage.content,
        chatId
      );
      memorySpan?.end({
        output: { promptLength: systemPromptText.length },
      });
    }

    // Web search for local providers (Ollama). Anthropic gets web search via
    // its own native tool downstream; OpenAI is not wired yet. For Ollama
    // and "no provider" (built-in local), we do the search ourselves and
    // prepend results to the system prompt as live context. This is the
    // ONLY place in the local path where the user's query leaves the
    // machine - explicitly opt-in via the UI toggle, with a one-time
    // privacy warning the first time the user enables it.
    if (body.webSearch) {
      let providerType: string | null = null;
      if (body.providerId) {
        const row = await getProvider(body.providerId);
        providerType = row?.type || null;
      } else {
        providerType = "ollama"; // default local
      }
      if (providerType !== "anthropic") {
        // All non-Anthropic providers use Brave for web search.
        // Anthropic uses its own native web_search tool in lib/llm.ts.
        const webSpan = trace?.span({
          name: "web-search-brave",
          input: { query: latestUserMessage.content },
        });
        const outcome = await searchWeb(latestUserMessage.content);
        webSpan?.end({
          output: { status: outcome.status, count: outcome.results.length },
        });
        // Always inject the formatted block - even on failure - so the
        // model knows to tell the user what happened instead of silently
        // answering as if no search was attempted.
        const block = formatWebOutcome(outcome);
        if (block) {
          systemPromptText = `${block}\n\n${systemPromptText}`;
        }
      }
    }

    // Detect a resumed chat: if the chat was last touched more than 2 hours
    // ago and there are existing messages, inject a single system marker
    // right before the latest user turn so the model knows time passed.
    const RESUME_GAP_MS = 2 * 60 * 60 * 1000;
    const now = new Date();
    const gapMs = chatLastUpdated ? now.getTime() - chatLastUpdated.getTime() : 0;
    const shouldMarkResume =
      chatLastUpdated && gapMs > RESUME_GAP_MS && body.messages.length > 1;

    const baseMessages = body.messages
      .filter((m) => m.content?.trim() || (m.images && m.images.length > 0))
      .map((m) => ({
        role: m.role,
        content: m.content || "[image attached]",
        ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
      }));
    let chatMessages: ChatMessage[];
    if (shouldMarkResume) {
      const dateStr = now.toISOString().slice(0, 10);
      const gapDays = Math.round(gapMs / (24 * 60 * 60 * 1000));
      const gapText = gapDays >= 1
        ? `${gapDays} day${gapDays === 1 ? "" : "s"} later`
        : `${Math.round(gapMs / (60 * 60 * 1000))} hours later`;
      const marker: ChatMessage = {
        role: "system",
        content: `[Conversation resumed ${gapText}, on ${dateStr}. Earlier messages above are historical context from a previous session.]`,
      };
      // Insert the marker right before the latest user message
      const beforeLast = baseMessages.slice(0, -1);
      const last = baseMessages[baseMessages.length - 1];
      chatMessages = [...beforeLast, marker, last];
    } else {
      chatMessages = baseMessages;
    }

    const llmMessages: ChatMessage[] = [
      { role: "system", content: systemPromptText },
      ...chatMessages,
    ];

    // Stream the response back as Server-Sent Events
    const encoder = new TextEncoder();
    let assistantContent = "";
    const finalChatId = chatId;

    const stream = new ReadableStream({
      async start(controller) {
        // Send the chat_id first so the client can track it
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ chatId: finalChatId })}\n\n`)
        );

        const generation = trace?.generation({
          name: "chat-llm",
          input: llmMessages,
          model: body.model || "(provider default)",
          metadata: {
            providerId: body.providerId || null,
            webSearch: !!body.webSearch,
          },
        });

        // Periodic save: every 3 seconds during streaming, save the partial
        // response to the DB. If the user refreshes mid-stream, the chat
        // shows whatever was saved instead of losing the whole message.
        let lastSaveTime = Date.now();
        const SAVE_INTERVAL_MS = 3000;

        try {
          for await (const chunk of chatStream(llmMessages, { mode, model: body.model, providerId: body.providerId, webSearch: body.webSearch, thinking: body.thinking })) {
            if (chunk.delta) {
              assistantContent += chunk.delta;
              const data = JSON.stringify({ delta: chunk.delta });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));

              // Save partial response periodically so refreshes don't lose content
              const now = Date.now();
              if (now - lastSaveTime > SAVE_INTERVAL_MS) {
                lastSaveTime = now;
                const partialMessages: Message[] = [
                  ...body.messages,
                  { role: "assistant", content: assistantContent },
                ];
                updateChat(finalChatId, partialMessages, {
                  model: body.model || null,
                  providerId: body.providerId || null,
                }).catch(() => {}); // fire-and-forget, don't block the stream
              }
            }
            if (chunk.done) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
              controller.close();

              generation?.end({
                output: assistantContent,
              });
              trace?.update({ output: assistantContent });

              // Save updated chat with the new assistant message
              const fullMessages: Message[] = [
                ...body.messages,
                { role: "assistant", content: assistantContent },
              ];
              // Record which model + provider was used so the post-chat
              // pipeline can extract facts with the same LLM the user
              // was actually chatting with.
              await updateChat(finalChatId, fullMessages, {
                model: body.model || null,
                providerId: body.providerId || null,
              });

              // Fire-and-forget: generate the chat title right after the first
              // exchange so the sidebar shows a real title immediately instead
              // of "Untitled". Skips if the chat already has a title.
              // Uses the same provider as the chat (so cloud-only users without
              // Ollama installed still get titles via Claude/GPT).
              generateTitleIfMissing(finalChatId, {
                providerId: body.providerId,
              }).catch((err) =>
                console.error("[chat] title generation error:", err)
              );

              // Live fact extraction: kick off a background pass against the
              // updated transcript so new facts (and an updated profile)
              // appear in the next message without waiting for chat
              // finalization. Always uses local FAST_MODEL so cloud users
              // don't pay extra per turn.
              // Skip fact extraction in private mode — private conversations
              // should not be saved to memory.
              if (!body.privateMode) {
                extractFactsLive(finalChatId, {
                  model: body.model,
                  providerId: body.providerId,
                }).catch((err) =>
                  console.error("[chat] live fact extraction error:", err)
                );
              }

              // Full memory persistence (facts + profile + embeddings) still
              // happens via /api/chat/finalize when the user ends the
              // conversation (clicks New chat or closes the tab).
              return;
            }
          }
          controller.close();
        } catch (err) {
          generation?.end({
            level: "ERROR",
            statusMessage: err instanceof Error ? err.message : String(err),
          });
          const message = err instanceof Error ? err.message : String(err);
          const errChunk = JSON.stringify({ error: message, done: true });
          controller.enqueue(encoder.encode(`data: ${errChunk}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

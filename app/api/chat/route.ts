import { NextRequest } from "next/server";
import { chatStream, type ModelMode, type ChatMessage } from "@/lib/llm";
import { createChat, updateChat, getChat } from "@/lib/chats";
import { buildMemoryAwareSystemPrompt } from "@/lib/memory";
import { generateTitleIfMissing, extractFactsLive } from "@/lib/post-chat";
import { getLangfuse } from "@/lib/langfuse";
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

    // Build memory-aware system prompt using the latest user message for vector search
    const latestUserMessage = body.messages[body.messages.length - 1];
    const memorySpan = trace?.span({
      name: "build-memory-prompt",
      input: { query: latestUserMessage.content, chatId },
    });
    const systemPromptText = await buildMemoryAwareSystemPrompt(
      latestUserMessage.content,
      chatId
    );
    memorySpan?.end({
      output: { promptLength: systemPromptText.length },
    });

    // Detect a resumed chat: if the chat was last touched more than 2 hours
    // ago and there are existing messages, inject a single system marker
    // right before the latest user turn so the model knows time passed.
    const RESUME_GAP_MS = 2 * 60 * 60 * 1000;
    const now = new Date();
    const gapMs = chatLastUpdated ? now.getTime() - chatLastUpdated.getTime() : 0;
    const shouldMarkResume =
      chatLastUpdated && gapMs > RESUME_GAP_MS && body.messages.length > 1;

    const baseMessages = body.messages.map((m) => ({ role: m.role, content: m.content }));
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

        try {
          for await (const chunk of chatStream(llmMessages, { mode, model: body.model, providerId: body.providerId, webSearch: body.webSearch })) {
            if (chunk.delta) {
              assistantContent += chunk.delta;
              const data = JSON.stringify({ delta: chunk.delta });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
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
              await updateChat(finalChatId, fullMessages);

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
              extractFactsLive(finalChatId).catch((err) =>
                console.error("[chat] live fact extraction error:", err)
              );

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

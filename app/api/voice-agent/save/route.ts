import { NextRequest } from "next/server";
import { createChat, getChat, updateChat } from "@/lib/chats";
import { extractFactsLive, generateTitleIfMissing } from "@/lib/post-chat";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";

interface VoiceAgentSaveRequest {
  chatId?: string | null;
  messages?: Message[];
  providerId?: string | null;
  model?: string | null;
}

function cleanMessages(messages: Message[] | undefined): Message[] {
  return (messages || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .map((m) => ({
      role: m.role,
      content: m.content.trim(),
      ...(m.usage ? { usage: m.usage } : {}),
    }));
}

/**
 * POST /api/voice-agent/save
 *
 * Deepgram owns the realtime voice loop, but RecallMEM still owns the chat
 * transcript and post-chat memory pipeline. This persists completed voice
 * turns as normal chat messages.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VoiceAgentSaveRequest;
    const messages = cleanMessages(body.messages);
    if (messages.length === 0) {
      return Response.json({ error: "messages required" }, { status: 400 });
    }

    let chatId = body.chatId || null;
    if (chatId) {
      const existing = await getChat(chatId);
      if (!existing) chatId = null;
    }
    if (!chatId) {
      chatId = await createChat("standard");
    }

    await updateChat(chatId, messages, {
      model: body.model?.trim() || "voice-agent",
      providerId: body.providerId || null,
    });

    await generateTitleIfMissing(chatId).catch((err) =>
      console.error("[voice-agent] title generation failed:", err)
    );

    extractFactsLive(chatId).catch((err) =>
      console.error("[voice-agent] live fact extraction failed:", err)
    );

    return Response.json({ ok: true, chatId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

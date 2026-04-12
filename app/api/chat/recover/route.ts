import { NextRequest } from "next/server";
import { updateChat } from "@/lib/chats";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/chat/recover
 *
 * Emergency recovery endpoint. If the client detects that a chat
 * exists in the DB with 0 messages but has messages in localStorage,
 * it sends them here to be saved. This is a safety net for when the
 * normal updateChat call fails silently (e.g. user_id mismatch bug).
 */
export async function POST(req: NextRequest) {
  const { chatId, messages } = (await req.json()) as {
    chatId: string;
    messages: Message[];
  };

  if (!chatId || !messages?.length) {
    return Response.json({ error: "chatId and messages required" }, { status: 400 });
  }

  // Sanitize messages — strip null bytes and other invalid UTF-8
  const cleaned = messages.map((m) => ({
    ...m,
    // eslint-disable-next-line no-control-regex
    content: (m.content || "").replace(/\x00/g, ""),
  }));

  await updateChat(chatId, cleaned);
  return Response.json({ ok: true, recovered: cleaned.length });
}

import { NextRequest } from "next/server";
import { runPostChatPipeline } from "@/lib/post-chat";

// Runs the post-chat pipeline synchronously: extracts facts, rebuilds profile,
// embeds chunks, and generates a title. Called when the user ends a conversation
// (clicks "New chat" or closes the tab).
//
// Returns once fact extraction and profile rebuild are done so the next conversation
// can immediately see the new memories.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { chatId?: string };
    if (!body.chatId) {
      return new Response(JSON.stringify({ error: "chatId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await runPostChatPipeline(body.chatId);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

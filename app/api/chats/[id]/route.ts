import { NextRequest } from "next/server";
import {
  getChat,
  deleteChat,
  transcriptToMessages,
  setPinned,
} from "@/lib/chats";

export const runtime = "nodejs";

// Get a single chat by id, returns the chat metadata + parsed messages
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const chat = await getChat(id);
    if (!chat) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const messages = transcriptToMessages(chat.transcript || "");
    return new Response(
      JSON.stringify({
        id: chat.id,
        title: chat.title,
        model_mode: chat.model_mode,
        message_count: chat.message_count,
        messages,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Patch a chat (currently only supports toggling pinned state)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { is_pinned?: boolean };
    if (typeof body.is_pinned === "boolean") {
      await setPinned(id, body.is_pinned);
    }
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

// Delete a chat (cascades to facts, transcript chunks via FK)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteChat(id);
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

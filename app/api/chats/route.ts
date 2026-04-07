import { listChats } from "@/lib/chats";

export const runtime = "nodejs";

// List all chats for the local user, newest first
export async function GET() {
  try {
    const chats = await listChats(200);
    return new Response(
      JSON.stringify(
        chats.map((c) => ({
          id: c.id,
          title: c.title,
          message_count: c.message_count,
          model_mode: c.model_mode,
          is_pinned: c.is_pinned,
          created_at: c.created_at,
          updated_at: c.updated_at,
        }))
      ),
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

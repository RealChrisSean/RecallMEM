import { query, queryOne, getUserId, getBaseUserId } from "@/lib/db";
import type { ChatRow, Message, ModelMode } from "@/lib/types";

// Build an ownership predicate that scopes a chat lookup to the current
// user across ALL of their brains. Chats are created with a brain-namespaced
// user_id (e.g. "local-user::work"); matching on the exact namespaced id
// caused silent data loss when the brain cookie changed between create and
// update. Scoping to the BASE user (and any "<base>::brain" namespace)
// keeps cross-brain resume working while still preventing another user from
// reading/mutating a chat by guessing its id (IDOR).
//
// Returns the SQL fragment plus the two params to append. `startIndex` is
// the next free positional-parameter number.
function ownershipClause(
  baseUserId: string,
  startIndex: number
): { sql: string; params: [string, string] } {
  return {
    sql: `(user_id = $${startIndex} OR user_id LIKE $${startIndex + 1})`,
    params: [baseUserId, `${baseUserId}::%`],
  };
}

// Format messages to transcript. Uses JSON to preserve usage data.
export function messagesToTranscript(messages: Message[]): string {
  return JSON.stringify(messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.usage ? { usage: m.usage } : {}),
  })));
}

// Parse transcript back into messages. Handles both JSON (new) and
// plain text (old format) for backwards compatibility.
export function transcriptToMessages(transcript: string): Message[] {
  if (!transcript) return [];

  // Try JSON first (new format)
  if (transcript.startsWith("[")) {
    try {
      return JSON.parse(transcript) as Message[];
    } catch { /* fall through to plain text parser */ }
  }

  // Plain text parser (old format: "user: ...\n\nassistant: ...")
  const blocks = transcript.split(/\n\n+/);
  const messages: Message[] = [];
  let current: Message | null = null;

  for (const block of blocks) {
    const match = block.match(/^(user|assistant):\s*([\s\S]*)$/);
    if (match) {
      if (current) messages.push(current);
      current = {
        role: match[1] as "user" | "assistant",
        content: match[2].trim(),
      };
    } else if (current) {
      current.content += `\n\n${block}`;
    }
  }
  if (current) messages.push(current);
  return messages;
}

// Create a new chat row, return the id
export async function createChat(mode: ModelMode = "standard"): Promise<string> {
  const userId = await getUserId();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO s2m_chats (user_id, model_mode, transcript, message_count)
     VALUES ($1, $2, '', 0)
     RETURNING id`,
    [userId, mode]
  );
  if (!row) throw new Error("Failed to create chat");
  return row.id;
}

// Update a chat with the latest transcript and message count. Optionally
// records which model + provider was used so the post-chat finalize
// pipeline can extract facts using the same LLM the user was actually
// chatting with.
export async function updateChat(
  chatId: string,
  messages: Message[],
  opts: { model?: string | null; providerId?: string | null } = {}
): Promise<void> {
  const transcript = messagesToTranscript(messages);
  // Scope to the owning user (across brains) so a chat can only be
  // overwritten by its owner, while still surviving a brain-cookie change.
  const own = ownershipClause(await getBaseUserId(), 6);
  await query(
    `UPDATE s2m_chats
     SET transcript = $1,
         message_count = $2,
         model = COALESCE($3, model),
         provider_id = COALESCE($4::uuid, provider_id),
         updated_at = NOW()
     WHERE id = $5 AND ${own.sql}`,
    [
      transcript,
      messages.length,
      opts.model ?? null,
      opts.providerId ?? null,
      chatId,
      ...own.params,
    ]
  );
}

// Set the chat title (set after auto-generation)
export async function setChatTitle(chatId: string, title: string): Promise<void> {
  const own = ownershipClause(await getBaseUserId(), 3);
  await query(
    `UPDATE s2m_chats SET title = $1 WHERE id = $2 AND ${own.sql}`,
    [title, chatId, ...own.params]
  );
}

// Get a single chat by id, scoped to the owning user (across brains).
// The id is a UUID, but ids leak (logs, the chat list, backups), so
// ownership is enforced here rather than relying on unguessability.
export async function getChat(chatId: string): Promise<ChatRow | null> {
  const own = ownershipClause(await getBaseUserId(), 2);
  return queryOne<ChatRow>(
    `SELECT * FROM s2m_chats WHERE id = $1 AND ${own.sql}`,
    [chatId, ...own.params]
  );
}

// List all chats for the user, pinned first then newest
export async function listChats(limit = 100): Promise<ChatRow[]> {
  const userId = await getUserId();
  return query<ChatRow>(
    `SELECT id, user_id, title, transcript, message_count, model_mode, is_pinned, created_at, updated_at
     FROM s2m_chats
     WHERE user_id = $1
     ORDER BY is_pinned DESC, updated_at DESC
     LIMIT $2`,
    [userId, limit]
  );
}

// Toggle pinned state for a chat
export async function setPinned(chatId: string, pinned: boolean): Promise<void> {
  const own = ownershipClause(await getBaseUserId(), 3);
  await query(
    `UPDATE s2m_chats SET is_pinned = $1 WHERE id = $2 AND ${own.sql}`,
    [pinned, chatId, ...own.params]
  );
}

// Delete a chat (cascading: facts, chunks all get removed via FK)
export async function deleteChat(chatId: string): Promise<void> {
  const own = ownershipClause(await getBaseUserId(), 2);
  await query(
    `DELETE FROM s2m_chats WHERE id = $1 AND ${own.sql}`,
    [chatId, ...own.params]
  );
}

// Get the most recent chat's updated_at timestamp (for "last conversation was X ago")
export async function getLastChatTime(): Promise<Date | null> {
  const userId = await getUserId();
  const row = await queryOne<{ updated_at: Date }>(
    `SELECT updated_at FROM s2m_chats
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId]
  );
  return row?.updated_at || null;
}

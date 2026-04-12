import { NextRequest } from "next/server";
import { query, getBaseUserId } from "@/lib/db";

export const runtime = "nodejs";

/** GET /api/brains — list all brains for the current user */
export async function GET() {
  const userId = await getBaseUserId();
  const rows = await query<{ name: string; emoji: string }>(
    `SELECT name, emoji FROM s2m_brains WHERE user_id = $1 ORDER BY sort_order, created_at`,
    [userId]
  );
  return Response.json({ brains: rows });
}

/** POST /api/brains — create a new brain */
export async function POST(req: NextRequest) {
  const { name, emoji } = (await req.json()) as { name: string; emoji?: string };
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").trim();
  if (!slug) return Response.json({ error: "name required" }, { status: 400 });

  const userId = await getBaseUserId();

  // Check for duplicates
  const existing = await query(
    `SELECT 1 FROM s2m_brains WHERE user_id = $1 AND name = $2`,
    [userId, slug]
  );
  if (existing.length > 0) return Response.json({ error: "brain already exists" }, { status: 409 });

  await query(
    `INSERT INTO s2m_brains (user_id, name, emoji) VALUES ($1, $2, $3)`,
    [userId, slug, emoji || "⭐"]
  );
  return Response.json({ ok: true, name: slug, emoji: emoji || "⭐" });
}

/** DELETE /api/brains — delete a brain and ALL its data */
export async function DELETE(req: NextRequest) {
  const { name } = (await req.json()) as { name: string };
  if (!name || name === "default") return Response.json({ error: "cannot delete default brain" }, { status: 400 });

  const userId = await getBaseUserId();
  const brainUserId = `${userId}::${name}`;

  // Delete all data for this brain (order matters for foreign keys)
  await query(`DELETE FROM s2m_transcript_chunks WHERE user_id = $1`, [brainUserId]);
  await query(`DELETE FROM s2m_user_facts WHERE user_id = $1`, [brainUserId]);
  await query(`DELETE FROM s2m_chats WHERE user_id = $1`, [brainUserId]);
  await query(`DELETE FROM s2m_user_profiles WHERE user_id = $1`, [brainUserId]);
  await query(`DELETE FROM s2m_brains WHERE user_id = $1 AND name = $2`, [userId, name]);

  return Response.json({ ok: true });
}

/** PATCH /api/brains — rename a brain */
export async function PATCH(req: NextRequest) {
  const { oldName, newName, emoji } = (await req.json()) as { oldName: string; newName?: string; emoji?: string };
  if (!oldName) return Response.json({ error: "oldName required" }, { status: 400 });

  const userId = await getBaseUserId();

  if (newName) {
    const slug = newName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").trim();
    if (!slug) return Response.json({ error: "invalid name" }, { status: 400 });
    await query(
      `UPDATE s2m_brains SET name = $3, emoji = COALESCE($4, emoji) WHERE user_id = $1 AND name = $2`,
      [userId, oldName, slug, emoji || null]
    );
    return Response.json({ ok: true, name: slug });
  }

  if (emoji) {
    await query(
      `UPDATE s2m_brains SET emoji = $3 WHERE user_id = $1 AND name = $2`,
      [userId, oldName, emoji]
    );
  }
  return Response.json({ ok: true });
}

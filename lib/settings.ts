import { query, queryOne, getBaseUserId } from "@/lib/db";

// Settings are shared across all brains (Brave key, etc).
const getUserId = getBaseUserId;

/**
 * Per-user key/value settings store. Used for things normal users need to
 * configure via the UI (Brave Search API key, etc) instead of editing
 * .env.local. Falls back to env vars in lib/web-search.ts so developers
 * can still use the file-based path if they prefer.
 */

export async function getSetting(key: string): Promise<string | null> {
  const userId = await getUserId();
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM s2m_settings WHERE user_id = $1 AND key = $2`,
    [userId, key]
  );
  return row?.value || null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const userId = await getUserId();
  await query(
    `INSERT INTO s2m_settings (user_id, key, value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, key) DO UPDATE
     SET value = EXCLUDED.value, updated_at = NOW()`,
    [userId, key, value]
  );
}

export async function deleteSetting(key: string): Promise<void> {
  const userId = await getUserId();
  await query(
    `DELETE FROM s2m_settings WHERE user_id = $1 AND key = $2`,
    [userId, key]
  );
}

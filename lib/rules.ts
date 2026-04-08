import { query, queryOne, getUserId } from "@/lib/db";

// Get the user's custom rules / instructions for the AI
export async function getRules(): Promise<string> {
  const userId = await getUserId();
  const row = await queryOne<{ custom_instructions: string | null }>(
    `SELECT custom_instructions FROM s2m_user_profiles WHERE user_id = $1`,
    [userId]
  );
  return row?.custom_instructions || "";
}

// Save the user's custom rules. Upserts the profile row.
export async function saveRules(rules: string): Promise<void> {
  const userId = await getUserId();
  await query(
    `INSERT INTO s2m_user_profiles (user_id, custom_instructions, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET custom_instructions = EXCLUDED.custom_instructions,
         updated_at = NOW()`,
    [userId, rules]
  );
}

import { query, queryOne } from "@/lib/db";

const USER_ID = "local-user";

// Get the user's custom rules / instructions for the AI
export async function getRules(): Promise<string> {
  const row = await queryOne<{ custom_instructions: string | null }>(
    `SELECT custom_instructions FROM s2m_user_profiles WHERE user_id = $1`,
    [USER_ID]
  );
  return row?.custom_instructions || "";
}

// Save the user's custom rules. Upserts the profile row.
export async function saveRules(rules: string): Promise<void> {
  await query(
    `INSERT INTO s2m_user_profiles (user_id, custom_instructions, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET custom_instructions = EXCLUDED.custom_instructions,
         updated_at = NOW()`,
    [USER_ID, rules]
  );
}

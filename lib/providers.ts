import { query, queryOne, getUserId } from "@/lib/db";

export type ProviderType =
  | "ollama"
  | "anthropic"
  | "openai"
  | "openai-compatible";

export interface ProviderRow {
  id: string;
  user_id: string;
  label: string;
  type: ProviderType;
  base_url: string | null;
  api_key: string | null;
  model: string;
  created_at: Date;
}

// Default base URLs by type
export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  ollama: "http://localhost:11434",
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  "openai-compatible": "",
};

// List all custom providers configured by the user
export async function listProviders(): Promise<ProviderRow[]> {
  const userId = await getUserId();
  return query<ProviderRow>(
    `SELECT * FROM s2m_llm_providers WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
}

export async function getProvider(id: string): Promise<ProviderRow | null> {
  const userId = await getUserId();
  return queryOne<ProviderRow>(
    `SELECT * FROM s2m_llm_providers WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
}

export async function createProvider(input: {
  label: string;
  type: ProviderType;
  base_url?: string | null;
  api_key?: string | null;
  model: string;
}): Promise<string> {
  const userId = await getUserId();
  const baseUrl = input.base_url || DEFAULT_BASE_URLS[input.type] || null;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO s2m_llm_providers (user_id, label, type, base_url, api_key, model)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, input.label, input.type, baseUrl, input.api_key || null, input.model]
  );
  if (!row) throw new Error("Failed to create provider");
  return row.id;
}

export async function updateProvider(
  id: string,
  input: {
    label?: string;
    type?: ProviderType;
    base_url?: string | null;
    api_key?: string | null;
    model?: string;
  }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.label !== undefined) {
    sets.push(`label = $${i++}`);
    params.push(input.label);
  }
  if (input.type !== undefined) {
    sets.push(`type = $${i++}`);
    params.push(input.type);
  }
  if (input.base_url !== undefined) {
    sets.push(`base_url = $${i++}`);
    params.push(input.base_url);
  }
  if (input.api_key !== undefined) {
    sets.push(`api_key = $${i++}`);
    params.push(input.api_key);
  }
  if (input.model !== undefined) {
    sets.push(`model = $${i++}`);
    params.push(input.model);
  }
  if (sets.length === 0) return;
  const userId = await getUserId();
  params.push(id, userId);
  await query(
    `UPDATE s2m_llm_providers SET ${sets.join(", ")} WHERE id = $${i++} AND user_id = $${i}`,
    params
  );
}

export async function deleteProvider(id: string): Promise<void> {
  const userId = await getUserId();
  await query(`DELETE FROM s2m_llm_providers WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ]);
}

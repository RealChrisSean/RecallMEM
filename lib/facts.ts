import { query, queryOne, getUserId } from "@/lib/db";
import { chat as llmChat, FAST_MODEL } from "@/lib/llm";
import type { UserFactRow } from "@/lib/types";

export const FACT_CATEGORIES = [
  "identity",
  "family",
  "work",
  "finance",
  "health",
  "interest",
  "project",
  "social",
  "preference",
  "other",
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

// Word-boundary keyword match (avoids "son" matching "Sonnet")
export function matchesKeyword(text: string, keyword: string): boolean {
  if (keyword.includes(" ")) return text.toLowerCase().includes(keyword.toLowerCase());
  // Prefix word match: \bwork matches work/worked/working but not framework
  const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  return re.test(text);
}

const CATEGORY_KEYWORDS: Record<FactCategory, string[]> = {
  identity: [
    "name is", "name's", "my name", "years old", "age", "born", "birthday",
    "lives in", "moved to", "live in", "from",
  ],
  family: [
    "wife", "husband", "spouse", "partner", "married",
    "daughter", "son", "child", "children", "baby", "kid", "kids",
    "mother", "father", "mom", "dad", "parent", "brother", "sister", "sibling",
    "family", "uncle", "aunt", "cousin", "grandma", "grandpa",
    "pet", "dog", "cat",
    "anniversary", "wedding",
  ],
  work: [
    "job", "work", "career", "company", "employer", "boss", "manager",
    "salary", "income", "promoted", "interview", "hired", "fired",
    "coworker", "colleague", "team", "freelance", "client",
  ],
  finance: [
    "invest", "investment", "401k", "ira", "stock", "savings", "debt",
    "loan", "mortgage", "credit", "bank", "crypto", "bitcoin",
  ],
  health: [
    "health", "doctor", "hospital", "medication", "therapy", "anxiety",
    "depression", "exercise", "workout", "gym", "sleep", "diet",
    "diagnosis", "condition", "pain", "dyslexia", "adhd",
  ],
  interest: [
    "hobby", "enjoy", "passion", "game", "music", "guitar", "piano",
    "read", "book", "movie", "show", "cook", "travel", "youtube",
  ],
  project: [
    "building", "project", "app", "website", "startup", "side project",
    "working on", "code", "coding", "programming",
  ],
  social: [
    "friend", "buddy", "neighbor", "roommate", "date", "dating",
    "relationship", "party", "church", "community",
  ],
  preference: [
    "like", "love", "hate", "prefer", "favorite", "enjoy", "dislike",
  ],
  other: [],
};

function categorize(fact: string): FactCategory {
  const lower = fact.toLowerCase();
  for (const category of FACT_CATEGORIES) {
    if (category === "other") continue;
    for (const keyword of CATEGORY_KEYWORDS[category]) {
      if (matchesKeyword(lower, keyword)) return category;
    }
  }
  return "other";
}

// Reject obviously bad facts (meta-observations, non-facts, AI commentary)
const GARBAGE_PATTERNS = [
  /^user\s+(tested|asked|checked|wanted to see)/i,
  /^(the\s+)?ai\s+(didn't|did not|wasn't|responded)/i,
  /^assistant\s+(said|suggested|responded)/i,
  /hasn't\s+shared/i,
  /not\s+(clearly\s+)?established/i,
  /not\s+mentioned/i,
  /^had\s+a\s+(good|nice|great)\s+conversation/i,
  /^this\s+was\s+their\s+(first|second|third)/i,
  /^\s*$/,
];

function isGarbage(fact: string): boolean {
  return GARBAGE_PATTERNS.some((p) => p.test(fact)) || fact.length < 10;
}

// Extract facts from a conversation transcript using the LLM
export async function extractFactsFromTranscript(
  transcript: string
): Promise<string[]> {
  if (!transcript || transcript.length < 100) return [];

  const prompt = `You are extracting durable, long-term facts about the USER from a conversation transcript. These facts will be remembered across all future conversations to give the AI persistent memory of who the user is.

EXTRACT facts that are:
- Personal identity (name, age, location, background)
- Relationships (family members, partners, friends, with names if given)
- Work and career (job, company, role, projects)
- Health (conditions, treatments, ongoing concerns)
- Interests, hobbies, preferences
- Goals, plans, ongoing projects
- Strong opinions or values they hold

DO NOT extract:
- Generic conversation observations ("user asked about X")
- AI behavior notes ("AI suggested Y")
- Temporary feelings or moods
- Things the AI said
- Speculation or things not directly stated by the user

Each fact should be a complete, standalone statement (8-25 words). Use third person ("User's wife is named Sarah" not "My wife is Sarah").

Return ONLY a JSON array of fact strings. No commentary, no markdown, no code blocks. Just the raw JSON array.

Example output:
["User's name is Chris", "User lives in Los Angeles", "User has dyslexia and prefers plain language explanations"]

CONVERSATION TRANSCRIPT:
${transcript}

Return the JSON array now:`;

  try {
    const response = await llmChat(
      [{ role: "user", content: prompt }],
      { model: FAST_MODEL }
    );
    // Try to extract JSON array from the response
    const cleaned = response
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.trim())
      .filter((f) => !isGarbage(f));
  } catch (err) {
    console.error("[facts] extraction failed:", err);
    return [];
  }
}

// Combined extract + supersede pass. Sees the existing active facts and the
// new transcript in one LLM call, returns both new facts to add AND ids of
// existing facts that this conversation contradicts/replaces. This solves
// the staleness side of context collapse: when "got laid off from TiDB"
// arrives, the older "works at TiDB" gets retired instead of sitting next
// to it as if both were currently true.
export async function extractFactsWithSupersession(
  transcript: string
): Promise<{ facts: string[]; supersedes: string[] }> {
  if (!transcript || transcript.length < 100) return { facts: [], supersedes: [] };

  // Pull current active facts so the LLM can compare against them. We pass
  // id + text so it can return the ids it wants to retire.
  const userId = await getUserId();
  const active = await query<{ id: string; fact_text: string }>(
    `SELECT id, fact_text FROM s2m_user_facts
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );

  const existingBlock = active.length === 0
    ? "(none)"
    : active.map((f) => `${f.id} :: ${f.fact_text}`).join("\n");

  const prompt = `You are maintaining a long-term memory of facts about the USER. You see (1) the existing active facts and (2) a new conversation transcript. Your job: extract NEW facts to add, AND identify which EXISTING facts the new conversation contradicts or replaces.

EXTRACT new facts that are durable and personal:
- Identity, family, work, health, interests, goals, opinions, projects
- Each fact: 8-25 words, third person ("User's wife is Sarah", not "My wife is Sarah")

DO NOT extract:
- Generic conversation observations or AI behavior notes
- Temporary moods, speculation, things not directly stated by the user

SUPERSEDE existing facts when the new conversation makes them no longer true:
- "User works at TiDB" + "User was laid off from TiDB" → supersede the first
- "User lives in LA" + "User just moved to NYC" → supersede the first
- "User is single" + "User got engaged to Sarah" → supersede the first
- Be conservative: only mark a fact superseded if the new information clearly replaces it. If both can still be true (e.g. "User likes coffee" + "User likes tea"), do NOT supersede.

Return ONLY this JSON object, no commentary, no code blocks:
{"facts": ["new fact 1", "new fact 2"], "supersedes": ["uuid-of-old-fact"]}

EXISTING ACTIVE FACTS:
${existingBlock}

NEW CONVERSATION TRANSCRIPT:
${transcript}

Return the JSON object now:`;

  try {
    const response = await llmChat(
      [{ role: "user", content: prompt }],
      { model: FAST_MODEL }
    );
    const cleaned = response.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return { facts: [], supersedes: [] };
    const parsed = JSON.parse(match[0]) as { facts?: unknown; supersedes?: unknown };
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts
          .filter((f): f is string => typeof f === "string")
          .map((f) => f.trim())
          .filter((f) => !isGarbage(f))
      : [];
    const supersedes = Array.isArray(parsed.supersedes)
      ? parsed.supersedes
          .filter((id): id is string => typeof id === "string")
          .filter((id) => active.some((a) => a.id === id))
      : [];
    return { facts, supersedes };
  } catch (err) {
    console.error("[facts] extract+supersede failed:", err);
    return { facts: [], supersedes: [] };
  }
}

// Mark a list of facts as superseded by a new chat. Sets is_active=false,
// valid_to=NOW(), and (when we know the replacement) superseded_by.
export async function markFactsSuperseded(
  factIds: string[],
  bySourceChatId: string
): Promise<number> {
  if (factIds.length === 0) return 0;
  const userId = await getUserId();
  const result = await query(
    `UPDATE s2m_user_facts
     SET is_active = FALSE, valid_to = NOW()
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE`,
    [userId, factIds]
  );
  // bySourceChatId currently unused for the FK link; kept in the signature
  // so future versions can wire superseded_by to a new fact id.
  void bySourceChatId;
  return Array.isArray(result) ? result.length : factIds.length;
}

// Store extracted facts, deduplicating against existing facts
export async function storeFacts(
  facts: string[],
  sourceChatId: string
): Promise<number> {
  if (facts.length === 0) return 0;
  const userId = await getUserId();

  // Get existing active facts to dedupe against
  const existing = await query<{ fact_text: string }>(
    `SELECT fact_text FROM s2m_user_facts WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );
  const existingSet = new Set(existing.map((r) => r.fact_text.toLowerCase().trim()));

  let inserted = 0;
  for (const fact of facts) {
    const normalized = fact.toLowerCase().trim();
    if (existingSet.has(normalized)) continue;
    const category = categorize(fact);
    await query(
      `INSERT INTO s2m_user_facts (user_id, fact_text, category, source_chat_id, is_active)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [userId, fact, category, sourceChatId]
    );
    existingSet.add(normalized);
    inserted++;
  }
  return inserted;
}

// Get all active facts for the user
export async function getActiveFacts(limit = 200): Promise<UserFactRow[]> {
  const userId = await getUserId();
  return query<UserFactRow>(
    `SELECT * FROM s2m_user_facts
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
}

// Delete a single fact (mark inactive)
export async function deleteFact(factId: string): Promise<void> {
  const userId = await getUserId();
  await query(
    `UPDATE s2m_user_facts SET is_active = FALSE WHERE id = $1 AND user_id = $2`,
    [factId, userId]
  );
}

// Hard delete a fact (removes from DB completely)
export async function hardDeleteFact(factId: string): Promise<void> {
  const userId = await getUserId();
  await query(
    `DELETE FROM s2m_user_facts WHERE id = $1 AND user_id = $2`,
    [factId, userId]
  );
}

// Wipe ALL memory: facts, profile, and transcript chunks. Chats themselves are preserved.
// Uses VACUUM FULL + CHECKPOINT to make the data physically unrecoverable at the
// database level. (Filesystem-level forensic recovery is a separate concern that
// requires full-disk encryption like FileVault.)
export async function wipeAllMemory(): Promise<{
  factsDeleted: number;
  chunksDeleted: number;
  profileCleared: boolean;
}> {
  const userId = await getUserId();
  // Count first so we can report accurate numbers
  const beforeFacts = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM s2m_user_facts WHERE user_id = $1`,
    [userId]
  );
  const beforeChunks = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM s2m_transcript_chunks WHERE user_id = $1`,
    [userId]
  );

  // Step 1: logical delete
  await query(`DELETE FROM s2m_user_facts WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM s2m_transcript_chunks WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM s2m_user_profiles WHERE user_id = $1`, [userId]);

  // Step 2: physically reclaim space (rewrites tables, releases dead tuples)
  // VACUUM FULL takes an exclusive lock — fine for a personal single-user setup.
  // We use try/catch because VACUUM can't run inside a transaction block.
  try {
    await query(`VACUUM FULL s2m_user_facts`);
    await query(`VACUUM FULL s2m_transcript_chunks`);
    await query(`VACUUM FULL s2m_user_profiles`);
  } catch (err) {
    console.error("[wipe] VACUUM FULL failed:", err);
  }

  // Step 3: force a checkpoint so the changes hit disk and WAL gets recycled
  try {
    await query(`CHECKPOINT`);
  } catch (err) {
    console.error("[wipe] CHECKPOINT failed:", err);
  }

  return {
    factsDeleted: parseInt(beforeFacts?.count || "0", 10),
    chunksDeleted: parseInt(beforeChunks?.count || "0", 10),
    profileCleared: true,
  };
}

// Nuke everything: chats, messages, facts, profile, embeddings. Total wipe.
// Same VACUUM FULL + CHECKPOINT treatment so data is unrecoverable at the DB level.
export async function nukeEverything(): Promise<{
  chatsDeleted: number;
  factsDeleted: number;
  chunksDeleted: number;
}> {
  const userId = await getUserId();
  const beforeChats = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM s2m_chats WHERE user_id = $1`,
    [userId]
  );
  const beforeFacts = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM s2m_user_facts WHERE user_id = $1`,
    [userId]
  );
  const beforeChunks = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM s2m_transcript_chunks WHERE user_id = $1`,
    [userId]
  );

  // Deleting chats cascades to facts and chunks via FK ON DELETE CASCADE,
  // but we delete explicitly to be safe.
  await query(`DELETE FROM s2m_user_facts WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM s2m_transcript_chunks WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM s2m_user_profiles WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM s2m_chats WHERE user_id = $1`, [userId]);

  try {
    await query(`VACUUM FULL s2m_chats`);
    await query(`VACUUM FULL s2m_user_facts`);
    await query(`VACUUM FULL s2m_transcript_chunks`);
    await query(`VACUUM FULL s2m_user_profiles`);
  } catch (err) {
    console.error("[nuke] VACUUM FULL failed:", err);
  }
  try {
    await query(`CHECKPOINT`);
  } catch (err) {
    console.error("[nuke] CHECKPOINT failed:", err);
  }

  return {
    chatsDeleted: parseInt(beforeChats?.count || "0", 10),
    factsDeleted: parseInt(beforeFacts?.count || "0", 10),
    chunksDeleted: parseInt(beforeChunks?.count || "0", 10),
  };
}

// Re-run categorize() on every active fact and update rows whose category
// changed. Cheap (no LLM, no embeddings) — safe to call after every chat,
// edit, or delete so categories stay correct as the categorizer improves.
export async function recategorizeAllFacts(): Promise<number> {
  const userId = await getUserId();
  const rows = await query<{ id: string; fact_text: string; category: string }>(
    `SELECT id, fact_text, category FROM s2m_user_facts
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );
  let updated = 0;
  for (const row of rows) {
    const next = categorize(row.fact_text);
    if (next !== row.category) {
      await query(
        `UPDATE s2m_user_facts SET category = $1 WHERE id = $2 AND user_id = $3`,
        [next, row.id, userId]
      );
      updated++;
    }
  }
  return updated;
}

// Update a fact's text and optionally re-categorize it
export async function updateFact(
  factId: string,
  newText: string,
  newCategory?: FactCategory
): Promise<void> {
  const userId = await getUserId();
  const category = newCategory || categorize(newText);
  await query(
    `UPDATE s2m_user_facts
     SET fact_text = $1, category = $2
     WHERE id = $3 AND user_id = $4`,
    [newText, category, factId, userId]
  );
}

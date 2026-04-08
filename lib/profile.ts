import { query, queryOne, getUserId } from "@/lib/db";
import { getActiveFacts, FACT_CATEGORIES, type FactCategory } from "@/lib/facts";
import type { UserProfileRow } from "@/lib/types";

// Cap each category to prevent unbounded growth
const CATEGORY_CAPS: Record<FactCategory, number> = {
  identity: 25,
  family: 25,
  work: 20,
  finance: 15,
  health: 15,
  interest: 20,
  project: 15,
  social: 15,
  preference: 20,
  other: 15,
};

// Build a structured profile string from active facts, grouped by category
export async function buildProfileFromFacts(): Promise<string> {
  const facts = await getActiveFacts(1000);
  if (facts.length === 0) return "";

  // Group by category
  const byCategory = new Map<FactCategory, string[]>();
  for (const cat of FACT_CATEGORIES) byCategory.set(cat, []);
  for (const fact of facts) {
    const cat = (fact.category as FactCategory) || "other";
    const list = byCategory.get(cat) || [];
    list.push(fact.fact_text);
  }

  // Build the profile sections, respecting caps
  const sections: string[] = [];
  const labels: Record<FactCategory, string> = {
    identity: "IDENTITY",
    family: "FAMILY",
    work: "WORK",
    finance: "FINANCE",
    health: "HEALTH",
    interest: "INTERESTS",
    project: "PROJECTS",
    social: "SOCIAL",
    preference: "PREFERENCES",
    other: "OTHER",
  };

  for (const cat of FACT_CATEGORIES) {
    const items = byCategory.get(cat) || [];
    if (items.length === 0) continue;
    const cap = CATEGORY_CAPS[cat];
    const capped = items.slice(0, cap);
    sections.push(`${labels[cat]}:\n${capped.map((f) => `- ${f}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

// Get the cached profile from the database
export async function getProfile(): Promise<UserProfileRow | null> {
  const userId = await getUserId();
  return queryOne<UserProfileRow>(
    `SELECT * FROM s2m_user_profiles WHERE user_id = $1`,
    [userId]
  );
}

// Rebuild and save the profile from current active facts
export async function rebuildProfile(): Promise<string> {
  const userId = await getUserId();
  const profile = await buildProfileFromFacts();
  await query(
    `INSERT INTO s2m_user_profiles (user_id, profile_summary, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET profile_summary = EXCLUDED.profile_summary,
         updated_at = NOW()`,
    [userId, profile]
  );
  return profile;
}

import { NextRequest } from "next/server";
import { listProviders } from "@/lib/providers";
import { getProfile } from "@/lib/profile";
import { getPinnedFacts, getActiveFacts } from "@/lib/facts";
import { getRules } from "@/lib/rules";

export const runtime = "nodejs";

const MAX_PROFILE_CHARS = 4000;
const MAX_FACTS = 40;

/**
 * GET /api/voice-agent — returns config for the voice agent WebSocket.
 * Builds a lean system prompt optimized for real-time voice (smaller than
 * the full text chat prompt so Grok responds faster).
 */
export async function GET(req: NextRequest) {
  const providers = await listProviders();
  const xai = providers.find(
    (p) => p.type === "openai-compatible" && p.api_key && p.base_url?.includes("x.ai")
  );

  if (!xai?.api_key) {
    return Response.json({ error: "No xAI provider configured" }, { status: 404 });
  }

  // Prefetch memory in parallel (like Speak2Me does)
  const [profileRow, pinnedFacts, recentFacts, customRules] = await Promise.all([
    getProfile(),
    getPinnedFacts(20),
    getActiveFacts(MAX_FACTS),
    getRules(),
  ]);

  // Deduplicate: pinned first, then fill with recent
  const seen = new Set<string>();
  const facts: { text: string; date: string }[] = [];
  for (const f of pinnedFacts) {
    if (!seen.has(f.id) && facts.length < MAX_FACTS) {
      seen.add(f.id);
      facts.push({ text: f.fact_text, date: (f.valid_from || f.created_at).toISOString().slice(0, 10) });
    }
  }
  for (const f of recentFacts) {
    if (!seen.has(f.id) && facts.length < MAX_FACTS) {
      seen.add(f.id);
      facts.push({ text: f.fact_text, date: (f.valid_from || f.created_at).toISOString().slice(0, 10) });
    }
  }

  const profile = profileRow?.profile_summary
    ? profileRow.profile_summary.slice(0, MAX_PROFILE_CHARS)
    : null;

  const now = new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date());

  // Build a tight voice-optimized prompt
  const systemPrompt = `You are RecallMEM, a personal AI with persistent memory. You are in a real-time voice conversation. Be concise and conversational — this is spoken, not written. No markdown, no bullet points, no numbered lists. Talk naturally like a real person.

${customRules ? `<rules>\n${customRules.slice(0, 2000)}\n</rules>\n` : ""}
Current time: ${now}

${profile ? `<user_profile>\n${profile}\n</user_profile>` : "This is a new user. Learn about them as you talk."}

${facts.length > 0 ? `<facts>\n${facts.map((f) => `[${f.date}] ${f.text}`).join("\n")}\n</facts>` : ""}

Keep responses short and natural for voice. Use their name when you know it. Never guess names or facts you don't have. If you don't know something, ask.`;

  return Response.json({
    apiKey: xai.api_key,
    systemPrompt,
    voice: "eve",
  });
}

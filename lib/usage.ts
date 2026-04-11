import { query, getBaseUserId } from "@/lib/db";

// Cost per unit in cents. These are approximate and may change.
const PRICING: Record<string, number> = {
  // Chat: cost per 1M tokens in cents
  "anthropic:tokens_in": 300,     // Claude Sonnet ~$3/1M in
  "anthropic:tokens_out": 1500,   // Claude Sonnet ~$15/1M out
  "openai:tokens_in": 250,       // GPT-4o ~$2.50/1M in
  "openai:tokens_out": 1000,     // GPT-4o ~$10/1M out
  "xai:tokens_in": 200,          // Grok ~$2/1M in
  "xai:tokens_out": 1000,        // Grok ~$10/1M out
  "ollama:tokens_in": 0,         // Free (local)
  "ollama:tokens_out": 0,
  // TTS: cost per 1M characters in cents
  "xai:tts_chars": 420,          // $4.20/1M chars
  "openai:tts_chars": 3000,      // $30/1M chars
  "deepgram:tts_chars": 3000,    // $30/1M chars
  // STT: cost per minute in cents
  "deepgram:stt_ms": 0.043,     // $0.0043/min = 0.043 cents/min (stored as ms)
  "whisper:stt_ms": 0,           // Free (local)
};

function estimateCostCents(provider: string, unitType: string, units: number): number {
  const key = `${provider}:${unitType}`;
  const ratePerMillion = PRICING[key];
  if (ratePerMillion === undefined || ratePerMillion === 0) return 0;

  if (unitType === "stt_ms") {
    // Convert ms to minutes, then multiply by cost per minute
    const minutes = units / 60000;
    return minutes * ratePerMillion;
  }

  // tokens or characters: rate is per 1M units
  return (units / 1_000_000) * ratePerMillion;
}

export async function logUsage(opts: {
  provider: string;
  service: "chat" | "tts" | "stt";
  model?: string;
  units: number;
  unitType: "tokens_in" | "tokens_out" | "characters" | "ms";
}): Promise<void> {
  if (opts.units <= 0) return;

  const userId = await getBaseUserId();
  const costCents = estimateCostCents(opts.provider, opts.unitType === "characters" ? `${opts.service}_chars` : opts.unitType === "ms" ? "stt_ms" : opts.unitType, opts.units);

  await query(
    `INSERT INTO s2m_usage (user_id, provider, service, model, units, unit_type, cost_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, opts.provider, opts.service, opts.model || null, opts.units, opts.unitType, costCents]
  ).catch((err) => {
    // Non-critical — don't break the feature if logging fails
    console.error("[usage] failed to log:", err);
  });
}

export interface UsageSummary {
  today: { cost_cents: number; breakdown: UsageBreakdown[] };
  thisWeek: { cost_cents: number; breakdown: UsageBreakdown[] };
  thisMonth: { cost_cents: number; breakdown: UsageBreakdown[] };
  allTime: { cost_cents: number; breakdown: UsageBreakdown[] };
}

interface UsageBreakdown {
  provider: string;
  service: string;
  total_units: number;
  unit_type: string;
  cost_cents: number;
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const userId = await getBaseUserId();

  const breakdownQuery = `
    SELECT provider, service, unit_type,
           SUM(units)::int as total_units,
           SUM(cost_cents)::numeric as cost_cents
    FROM s2m_usage
    WHERE user_id = $1 AND created_at >= $2
    GROUP BY provider, service, unit_type
    ORDER BY cost_cents DESC
  `;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const allTimeStart = new Date(0);

  const [today, thisWeek, thisMonth, allTime] = await Promise.all([
    query<UsageBreakdown>(breakdownQuery, [userId, todayStart]),
    query<UsageBreakdown>(breakdownQuery, [userId, weekStart]),
    query<UsageBreakdown>(breakdownQuery, [userId, monthStart]),
    query<UsageBreakdown>(breakdownQuery, [userId, allTimeStart]),
  ]);

  const sumCost = (rows: UsageBreakdown[]) =>
    rows.reduce((acc, r) => acc + Number(r.cost_cents), 0);

  return {
    today: { cost_cents: sumCost(today), breakdown: today },
    thisWeek: { cost_cents: sumCost(thisWeek), breakdown: thisWeek },
    thisMonth: { cost_cents: sumCost(thisMonth), breakdown: thisMonth },
    allTime: { cost_cents: sumCost(allTime), breakdown: allTime },
  };
}

export async function getUsageForRange(from: Date, to: Date): Promise<{ cost_cents: number; breakdown: UsageBreakdown[] }> {
  const userId = await getBaseUserId();
  const rows = await query<UsageBreakdown>(
    `SELECT provider, service, unit_type,
            SUM(units)::int as total_units,
            SUM(cost_cents)::numeric as cost_cents
     FROM s2m_usage
     WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
     GROUP BY provider, service, unit_type
     ORDER BY cost_cents DESC`,
    [userId, from, to]
  );
  const cost_cents = rows.reduce((acc, r) => acc + Number(r.cost_cents), 0);
  return { cost_cents, breakdown: rows };
}

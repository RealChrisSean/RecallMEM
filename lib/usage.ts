import { query, getBaseUserId } from "@/lib/db";

// Model-specific pricing per 1M tokens (in cents).
// Falls back to provider-level defaults if model not found.
const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  // Anthropic
  "claude-opus-4-7":             { in: 500,  out: 2500 },  // $5/$25
  "claude-opus-4-6":             { in: 500,  out: 2500 },  // $5/$25
  "claude-opus-4-5":             { in: 500,  out: 2500 },
  "claude-sonnet-4-6":           { in: 300,  out: 1500 },  // $3/$15
  "claude-sonnet-4-5":           { in: 300,  out: 1500 },
  "claude-haiku-4-5-20251001":   { in: 80,   out: 400 },   // $0.80/$4
  // OpenAI
  "gpt-5.4":                     { in: 250,  out: 1500 },  // $2.50/$15
  "gpt-5.4-pro":                 { in: 3000, out: 18000 }, // $30/$180
  "gpt-5.4-mini":                { in: 75,   out: 450 },   // $0.75/$4.50
  "gpt-5.4-nano":                { in: 20,   out: 125 },   // $0.20/$1.25
  "gpt-5":                       { in: 250,  out: 1500 },
  "gpt-5-mini":                  { in: 75,   out: 450 },
  "gpt-4.1":                     { in: 200,  out: 800 },   // $2/$8
  "gpt-4.1-mini":                { in: 40,   out: 160 },   // $0.40/$1.60
  "gpt-4.1-nano":                { in: 10,   out: 40 },    // $0.10/$0.40
  "o4-mini":                     { in: 400,  out: 1600 },  // $4/$16
  // xAI
  "grok-3":                      { in: 300,  out: 1500 },  // $3/$15
  "grok-3-mini":                 { in: 25,   out: 50 },    // $0.25/$0.50
  "grok-3-fast":                 { in: 20,   out: 50 },    // $0.20/$0.50
  "grok-4.20-0309-reasoning":    { in: 300,  out: 1500 },
};

// Provider-level defaults (fallback if model not in the table above)
const PROVIDER_DEFAULTS: Record<string, { in: number; out: number }> = {
  anthropic: { in: 300, out: 1500 },   // Sonnet pricing as default
  openai:    { in: 250, out: 1500 },
  xai:       { in: 300, out: 1500 },
  ollama:    { in: 0,   out: 0 },
};

// Non-chat pricing
const OTHER_PRICING: Record<string, number> = {
  "xai:tts_chars":      420,     // $4.20/1M chars
  "openai:tts_chars":   3000,    // $30/1M chars
  "deepgram:tts_chars": 3000,    // $30/1M chars
  "deepgram:stt_ms":    0.043,   // $0.0043/min
  "whisper:stt_ms":     0,
};

function estimateCostCents(provider: string, unitType: string, units: number, model?: string | null): number {
  if (units <= 0) return 0;

  // Token pricing — look up by model first, then provider default
  if (unitType === "tokens_in" || unitType === "tokens_out") {
    const modelPricing = model ? MODEL_PRICING[model] : null;
    const pricing = modelPricing || PROVIDER_DEFAULTS[provider] || { in: 0, out: 0 };
    const rate = unitType === "tokens_in" ? pricing.in : pricing.out;
    return (units / 1_000_000) * rate;
  }

  // STT pricing (ms -> minutes)
  if (unitType === "stt_ms") {
    const rate = OTHER_PRICING[`${provider}:stt_ms`] || 0;
    return (units / 60000) * rate;
  }

  // TTS / character pricing
  const key = `${provider}:${unitType === "characters" ? "tts_chars" : unitType}`;
  const rate = OTHER_PRICING[key] || 0;
  return (units / 1_000_000) * rate;
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
  const costCents = estimateCostCents(opts.provider, opts.unitType, opts.units, opts.model);

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
  model: string | null;
  total_units: number;
  unit_type: string;
  cost_cents: number;
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const userId = await getBaseUserId();

  const breakdownQuery = `
    SELECT provider, service, model,
           CASE WHEN unit_type IN ('tokens_in','tokens_out') THEN 'tokens' ELSE unit_type END as unit_type,
           SUM(units)::int as total_units,
           SUM(cost_cents)::numeric as cost_cents
    FROM s2m_usage
    WHERE user_id = $1 AND created_at >= $2
    GROUP BY provider, service, model,
             CASE WHEN unit_type IN ('tokens_in','tokens_out') THEN 'tokens' ELSE unit_type END
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
    `SELECT provider, service, model,
            CASE WHEN unit_type IN ('tokens_in','tokens_out') THEN 'tokens' ELSE unit_type END as unit_type,
            SUM(units)::int as total_units,
            SUM(cost_cents)::numeric as cost_cents
     FROM s2m_usage
     WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
     GROUP BY provider, service, model,
              CASE WHEN unit_type IN ('tokens_in','tokens_out') THEN 'tokens' ELSE unit_type END
     ORDER BY cost_cents DESC`,
    [userId, from, to]
  );
  const cost_cents = rows.reduce((acc, r) => acc + Number(r.cost_cents), 0);
  return { cost_cents, breakdown: rows };
}

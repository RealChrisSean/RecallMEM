import "server-only";
import { getSetting } from "@/lib/settings";

/**
 * Web search backend for local models (Ollama / Gemma).
 *
 * Anthropic and OpenAI have native web_search tools that the model can call
 * itself. Local Gemma can't, so when the user enables the web search toggle
 * on a local provider, we do a search ourselves and prepend the results to
 * the system prompt as context. Same RAG pattern as memory recall, just
 * outward-facing.
 *
 * Backend: Brave Search API. $5/1,000 requests with $5 free monthly credits
 * index, clean privacy story (no scraping, real ToS).
 *
 * **The data leaves the machine.** This is the only place in RecallMEM
 * where the user's literal message is sent to a third party in the local
 * provider path. The user is warned in the UI before the toggle is enabled
 * the first time. Memory, facts, profile, transcripts all stay local; only
 * the query string itself goes to Brave.
 *
 * Setup: get an API key at https://brave.com/search/api and set
 * BRAVE_SEARCH_API_KEY in your .env.local. Without the key this function
 * returns an empty result set (no-op).
 */

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type WebSearchStatus = "ok" | "no-key" | "quota-exhausted" | "error";

export interface WebSearchOutcome {
  status: WebSearchStatus;
  results: WebSearchResult[];
  message?: string;
}

export async function searchWeb(
  query: string,
  limit = 5
): Promise<WebSearchOutcome> {
  // Settings DB is the primary source so normal users can paste a key
  // into the /settings page. Env var is the fallback for developers.
  const apiKey =
    (await getSetting("brave_search_api_key")) ||
    process.env.BRAVE_SEARCH_API_KEY ||
    null;
  if (!apiKey) return { status: "no-key", results: [] };
  if (!query.trim()) return { status: "ok", results: [] };

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    });
    if (res.status === 429) {
      console.error("[web-search] Brave quota exhausted (HTTP 429)");
      return {
        status: "quota-exhausted",
        results: [],
        message: "Brave Search monthly credits exhausted. Additional requests will be charged at $5/1,000.",
      };
    }
    if (!res.ok) {
      console.error(`[web-search] Brave returned ${res.status}`);
      return {
        status: "error",
        results: [],
        message: `Brave Search returned HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as BraveSearchResponse;
    const results = data.web?.results || [];
    return {
      status: "ok",
      results: results.slice(0, limit).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description || "",
      })),
    };
  } catch (err) {
    console.error("[web-search] failed:", err);
    return {
      status: "error",
      results: [],
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// Format an outcome into a system-prompt block. Tells the model what
// happened so it can either use the results or explain to the user why
// search didn't work this turn.
export function formatWebOutcome(outcome: WebSearchOutcome): string {
  if (outcome.status === "ok" && outcome.results.length > 0) {
    const formatted = outcome.results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
      .join("\n\n");
    return `<web_search_results>
The user has web search enabled. These are live search results for their latest message. Use them as supporting context but cite the source URL when you rely on a specific result.

${formatted}
</web_search_results>`;
  }

  if (outcome.status === "no-key") {
    return `<web_search_unavailable>
The user toggled web search ON but no Brave Search API key is configured. Briefly tell the user that web search needs a Brave Search API key ($5/1,000 requests, includes $5 free credits every month), and they can add it on the Settings page (link: /settings). Sign up at https://brave.com/search/api. Then answer their question from your existing knowledge.
</web_search_unavailable>`;
  }

  if (outcome.status === "quota-exhausted") {
    return `<web_search_unavailable>
The user toggled web search ON but the Brave Search free tier monthly quota is exhausted. Briefly tell the user that web search is unavailable until next month, or that they can upgrade to Brave's paid tier ($3/month for 20,000 requests). Then answer their question from your existing knowledge.
</web_search_unavailable>`;
  }

  if (outcome.status === "error") {
    return `<web_search_unavailable>
The user toggled web search ON but Brave Search returned an error: ${outcome.message || "unknown"}. Briefly tell the user web search is currently unavailable, then answer from your existing knowledge.
</web_search_unavailable>`;
  }

  return "";
}

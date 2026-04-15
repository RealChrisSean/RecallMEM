// LLM chat completion router (server-only). Supports:
//   - Ollama (local, no auth) - default
//   - Anthropic (Claude) via /v1/messages
//   - OpenAI / OpenAI-compatible via /v1/chat/completions
//
// IMPORTANT: This file is server-only because it imports from `lib/providers`
// which uses `pg`. Client-safe constants (MODEL_OPTIONS, ModelId, ModelMode)
// live in `lib/llm-config.ts` and should be imported from React components.

import "server-only";
import { getProvider, type ProviderType, type ProviderRow } from "@/lib/providers";
import {
  type ModelMode,
  type ModelConfig,
  MODEL_OPTIONS,
  type ModelId,
} from "@/lib/llm-config";

// Re-export client-safe types and constants for convenience on the server side
export { MODEL_OPTIONS };
export type { ModelMode, ModelConfig, ModelId };

export const MODEL_CONFIGS: Record<ModelMode, ModelConfig> = {
  standard: {
    baseURL: process.env.OLLAMA_URL || "http://localhost:11434",
    defaultModel: process.env.OLLAMA_CHAT_MODEL || "gemma4:26b",
    label: "Standard",
    description: "Gemma 4 via Ollama",
  },
  unrestricted: {
    baseURL: process.env.VMLX_URL || "http://localhost:8080",
    defaultModel: process.env.VMLX_CHAT_MODEL || "gemma-4-31b-jang-crack",
    label: "Unrestricted",
    description: "Gemma 4 31B (abliterated) - no refusals",
  },
};

// The fast model used for background pipeline tasks (title gen, fact extraction)
export const FAST_MODEL =
  process.env.OLLAMA_FAST_MODEL || "gemma4:e4b";

/**
 * Find the cheapest available LLM for background tasks (fact extraction, title gen).
 * Priority: Haiku > GPT-4.1 Nano > Grok Mini > local Gemma.
 * Returns { model, providerId } for use with llmChat().
 */
import { listProviders } from "@/lib/providers";

let _cheapestCache: { model: string; providerId?: string } | null = null;
let _cheapestCacheTime = 0;

export async function getCheapestLLM(): Promise<{ model: string; providerId?: string }> {
  // Cache for 60 seconds to avoid querying providers on every message
  if (_cheapestCache && Date.now() - _cheapestCacheTime < 60000) return _cheapestCache;

  const providers = await listProviders();

  // 1. Haiku via Anthropic ($1/$5)
  const anthropic = providers.find((p) => p.type === "anthropic" && p.api_key);
  if (anthropic) {
    _cheapestCache = { model: "claude-haiku-4-5-20251001", providerId: anthropic.id };
    _cheapestCacheTime = Date.now();
    return _cheapestCache;
  }

  // 2. GPT-4.1 Nano via OpenAI ($0.10/$0.40)
  const openai = providers.find((p) => p.type === "openai" && p.api_key);
  if (openai) {
    _cheapestCache = { model: "gpt-4.1-nano", providerId: openai.id };
    _cheapestCacheTime = Date.now();
    return _cheapestCache;
  }

  // 3. Grok Mini via xAI ($0.25/$0.50)
  const xai = providers.find((p) => p.type === "openai-compatible" && p.api_key && p.base_url?.includes("x.ai"));
  if (xai) {
    _cheapestCache = { model: "grok-3-mini", providerId: xai.id };
    _cheapestCacheTime = Date.now();
    return _cheapestCache;
  }

  // 4. Local Gemma (free)
  _cheapestCache = { model: FAST_MODEL };
  _cheapestCacheTime = Date.now();
  return _cheapestCache;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[]; // base64-encoded images for vision-capable models
}

export interface ChatStreamChunk {
  delta: string;
  done: boolean;
}

export interface ChatOptions {
  mode?: ModelMode;
  model?: string; // override the default model (for ollama path)
  providerId?: string; // if set, route through a custom provider
  webSearch?: boolean; // enable native web search tool (anthropic/openai only)
  thinking?: boolean; // enable thinking/reasoning mode
}

interface ResolvedProvider {
  type: ProviderType;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

// Resolve which provider/model to use for this request
async function resolveProvider(
  options: ChatOptions
): Promise<ResolvedProvider> {
  if (options.providerId) {
    const row = await getProvider(options.providerId);
    if (!row) throw new Error(`Provider not found: ${options.providerId}`);
    return rowToResolved(row);
  }
  // Default: local Ollama
  const mode: ModelMode = options.mode || "standard";
  const config = MODEL_CONFIGS[mode];
  return {
    type: "ollama",
    baseUrl: config.baseURL,
    apiKey: null,
    model: options.model || config.defaultModel,
  };
}

function rowToResolved(row: ProviderRow): ResolvedProvider {
  return {
    type: row.type,
    baseUrl: row.base_url || "",
    apiKey: row.api_key,
    model: row.model,
  };
}

// Streaming chat. Routes to the right provider based on type.
export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions = {}
): AsyncGenerator<ChatStreamChunk> {
  const provider = await resolveProvider(options);
  // Native web search only works for Anthropic (web_search_20250305).
  // OpenAI's chat completions doesn't support web_search_preview
  // (that's Responses API only). Ollama, OpenAI, and OpenAI-compatible
  // all use Brave search via the chat route instead.
  const webSearch = !!options.webSearch && provider.type === "anthropic";
  const thinking = !!options.thinking;
  if (provider.type === "anthropic") {
    yield* anthropicStream(provider, messages, webSearch);
  } else if (provider.type === "ollama") {
    yield* ollamaStream(provider, messages, thinking);
  } else {
    yield* openaiStream(provider, messages, webSearch);
  }
}

// Test a provider config without saving it. Sends a tiny "Hi" message and
// reports success or the actual error from the provider. Used by the
// /providers UI to validate API key + model name before save.
export async function testProvider(input: {
  type: ProviderType;
  base_url?: string | null;
  api_key?: string | null;
  model: string;
}): Promise<{ ok: boolean; error?: string; reply?: string }> {
  const provider: ResolvedProvider = {
    type: input.type,
    baseUrl:
      input.base_url ||
      ({
        ollama: "http://localhost:11434",
        anthropic: "https://api.anthropic.com",
        openai: "https://api.openai.com",
        "openai-compatible": "",
      }[input.type] || ""),
    apiKey: input.api_key || null,
    model: input.model,
  };
  if (
    (provider.type === "anthropic" || provider.type === "openai") &&
    !provider.apiKey
  ) {
    return { ok: false, error: "API key is required" };
  }
  if (provider.type === "openai-compatible" && !provider.baseUrl) {
    return { ok: false, error: "Base URL is required" };
  }
  const messages: ChatMessage[] = [
    { role: "user", content: "Reply with just the word: ok" },
  ];
  try {
    let reply: string;
    if (provider.type === "anthropic") {
      reply = await anthropicNonStream(provider, messages);
    } else if (provider.type === "ollama") {
      reply = await ollamaNonStream(provider, messages);
    } else {
      reply = await openaiNonStream(provider, messages);
    }
    return { ok: true, reply: reply.slice(0, 100) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Non-streaming chat. Used by background tasks (title gen, fact extraction).
// Always goes through Ollama with the FAST_MODEL since it's local and free.
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const provider = await resolveProvider(options);
  if (provider.type === "anthropic") {
    return anthropicNonStream(provider, messages);
  }
  if (provider.type === "ollama") {
    return ollamaNonStream(provider, messages);
  }
  return openaiNonStream(provider, messages);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama transport (existing path)
// ─────────────────────────────────────────────────────────────────────────────

async function* ollamaStream(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  thinking = false
): AsyncGenerator<ChatStreamChunk> {
  const res = await fetch(`${provider.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true,
      think: thinking,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let thinkingStarted = false;
  let thinkingEnded = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line) as {
          message?: { content?: string; thinking?: string };
          done: boolean;
        };
        // When think=true, Ollama sends reasoning in `thinking` and
        // the visible response in `content`. We wrap thinking tokens
        // in <think> tags so the client can render them in a
        // collapsible section.
        const thinkDelta = json.message?.thinking || "";
        const contentDelta = json.message?.content || "";

        if (thinkDelta && !contentDelta) {
          // Still in the thinking phase
          if (!thinkingStarted) {
            yield { delta: "<think>\n", done: false };
            thinkingStarted = true;
          }
          yield { delta: thinkDelta, done: false };
        } else if (contentDelta) {
          // Transitioned to the response phase
          if (thinkingStarted && !thinkingEnded) {
            yield { delta: "\n</think>\n\n", done: false };
            thinkingEnded = true;
          }
          yield { delta: contentDelta, done: false };
        }

        if (json.done) {
          if (thinkingStarted && !thinkingEnded) {
            yield { delta: "\n</think>\n\n", done: false };
          }
          yield { delta: "", done: true };
          return;
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}

async function ollamaNonStream(
  provider: ResolvedProvider,
  messages: ChatMessage[]
): Promise<string> {
  const res = await fetch(`${provider.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: false,
      think: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { message: { content: string } };
  return data.message.content;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI / OpenAI-compatible transport
// Format: POST {baseUrl}/v1/chat/completions, Bearer auth, OpenAI message format
// ─────────────────────────────────────────────────────────────────────────────

function openaiHeaders(provider: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;
  return headers;
}

function openaiBody(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  stream: boolean,
  webSearch = false
): string {
  return JSON.stringify({
    model: provider.model,
    messages: messages.map((m) => {
      if (m.images && m.images.length > 0) {
        const content: Array<Record<string, unknown>> = [];
        for (const img of m.images) {
          content.push({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${img}` },
          });
        }
        if (m.content) {
          content.push({ type: "text", text: m.content });
        }
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    }),
    stream,
  });
}

async function* openaiStream(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  webSearch = false
): AsyncGenerator<ChatStreamChunk> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: openaiHeaders(provider),
    body: openaiBody(provider, messages, true, webSearch),
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        yield { delta: "", done: true };
        return;
      }
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
        };
        const delta = json.choices?.[0]?.delta?.content || "";
        if (delta) yield { delta, done: false };
      } catch {
        // skip malformed
      }
    }
  }
  yield { delta: "", done: true };
}

async function openaiNonStream(
  provider: ResolvedProvider,
  messages: ChatMessage[]
): Promise<string> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: openaiHeaders(provider),
    body: openaiBody(provider, messages, false),
  });
  if (!res.ok) throw new Error(`OpenAI failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content || "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic transport
// Format: POST {baseUrl}/v1/messages, x-api-key + anthropic-version headers,
// system prompt is a top-level field, messages are user/assistant only
// ─────────────────────────────────────────────────────────────────────────────

function anthropicHeaders(provider: ResolvedProvider): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": provider.apiKey || "",
    "anthropic-version": "2023-06-01",
  };
}

function anthropicBody(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  stream: boolean,
  webSearch = false
): string {
  // Anthropic puts system prompt outside the messages array
  const systemMessages = messages.filter((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");
  const systemContent = systemMessages.map((m) => m.content).join("\n\n");
  return JSON.stringify({
    model: provider.model,
    max_tokens: 4096,
    system: systemContent || undefined,
    messages: chatMessages.map((m) => {
      // If the message has images, send as content blocks (Anthropic vision format)
      if (m.images && m.images.length > 0) {
        const content: Array<Record<string, unknown>> = [];
        for (const img of m.images) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: img,
            },
          });
        }
        if (m.content) {
          content.push({ type: "text", text: m.content });
        }
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    }),
    stream,
    ...(webSearch && {
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    }),
  });
}

async function* anthropicStream(
  provider: ResolvedProvider,
  messages: ChatMessage[],
  webSearch = false
): AsyncGenerator<ChatStreamChunk> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: anthropicHeaders(provider),
    body: anthropicBody(provider, messages, true, webSearch),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      try {
        const json = JSON.parse(data) as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (json.type === "content_block_delta" && json.delta?.text) {
          yield { delta: json.delta.text, done: false };
        }
        if (json.type === "message_stop") {
          yield { delta: "", done: true };
          return;
        }
      } catch {
        // skip
      }
    }
  }
  yield { delta: "", done: true };
}

async function anthropicNonStream(
  provider: ResolvedProvider,
  messages: ChatMessage[]
): Promise<string> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: anthropicHeaders(provider),
    body: anthropicBody(provider, messages, false),
  });
  if (!res.ok) throw new Error(`Anthropic failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("");
}

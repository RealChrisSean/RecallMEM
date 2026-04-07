// LLM chat completion via Ollama (OpenAI-compatible API)
// Supports model toggle: "standard" (Ollama Gemma 4) and "unrestricted" (vMLX abliterated, future)

export type ModelMode = "standard" | "unrestricted";

export interface ModelConfig {
  baseURL: string;
  defaultModel: string;
  label: string;
  description: string;
}

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

// User-selectable model variants for the UI picker
// Only "standard" mode supports model switching for now
export const MODEL_OPTIONS = [
  {
    id: "gemma4:31b",
    label: "Gemma 4 31B",
    description: "Best quality, slowest. ~17 tok/s",
    sizeGB: 19,
  },
  {
    id: "gemma4:26b",
    label: "Gemma 4 26B MoE",
    description: "Recommended. Fast and smart. ~50-80 tok/s",
    sizeGB: 18,
  },
  {
    id: "gemma4:e4b",
    label: "Gemma 4 E4B",
    description: "Lighter. Good for laptops. Very fast.",
    sizeGB: 4,
  },
  {
    id: "gemma4:e2b",
    label: "Gemma 4 E2B",
    description: "Smallest. Phones / 8GB devices.",
    sizeGB: 2,
  },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

// The fast model used for background pipeline tasks (title gen, fact extraction)
export const FAST_MODEL =
  process.env.OLLAMA_FAST_MODEL || "gemma4:e4b";

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
  model?: string; // override the default model
}

// Streaming chat using Ollama's native /api/chat endpoint
export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions = {}
): AsyncGenerator<ChatStreamChunk> {
  const mode: ModelMode = options.mode || "standard";
  const config = MODEL_CONFIGS[mode];
  const model = options.model || config.defaultModel;

  const res = await fetch(`${config.baseURL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      think: false,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed: ${res.status} ${await res.text()}`);
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
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line) as {
          message?: { content?: string };
          done: boolean;
        };
        const delta = json.message?.content || "";
        if (delta) {
          yield { delta, done: false };
        }
        if (json.done) {
          yield { delta: "", done: true };
          return;
        }
      } catch {
        // skip malformed lines
      }
    }
  }
}

// Non-streaming chat (for short tasks like title generation and fact extraction)
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> {
  const mode: ModelMode = options.mode || "standard";
  const config = MODEL_CONFIGS[mode];
  const model = options.model || config.defaultModel;

  const res = await fetch(`${config.baseURL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      think: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Chat request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { message: { content: string } };
  return data.message.content;
}

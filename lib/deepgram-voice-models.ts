import "server-only";

import {
  BUNDLED_DEEPGRAM_VOICE_THINK_MODELS,
  filterCuratedDeepgramVoiceModels,
  type DeepgramVoiceThinkModel,
  type DeepgramVoiceThinkProviderType,
} from "@/lib/voice-agent-models";

const DEEPGRAM_THINK_MODELS_URL =
  "https://agent.deepgram.com/v1/agent/settings/think/models";
const CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDERS = new Set<DeepgramVoiceThinkProviderType>([
  "open_ai",
  "anthropic",
  "google",
  "groq",
  "nvidia",
]);

let cachedModels: DeepgramVoiceThinkModel[] | null = null;
let cachedAt = 0;

interface DeepgramResponseModel {
  id: string;
  name: string;
  provider: DeepgramVoiceThinkProviderType;
}

function isVoiceModel(value: unknown): value is DeepgramResponseModel {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    typeof row.provider === "string" &&
    PROVIDERS.has(row.provider as DeepgramVoiceThinkProviderType)
  );
}

export async function getDeepgramVoiceThinkModels(): Promise<{
  models: DeepgramVoiceThinkModel[];
  source: "live" | "bundled";
}> {
  if (cachedModels && Date.now() - cachedAt < CACHE_TTL_MS) {
    return { models: cachedModels, source: "live" };
  }

  try {
    const response = await fetch(DEEPGRAM_THINK_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Deepgram returned ${response.status}`);
    const body = (await response.json()) as { models?: unknown[] };
    const availableModels = (body.models || []).filter(isVoiceModel).map((row) => ({
      provider: row.provider,
      model: row.id,
      label: row.name,
    }));
    if (availableModels.length === 0) {
      throw new Error("Deepgram returned no think models");
    }
    const models = filterCuratedDeepgramVoiceModels(availableModels);
    cachedModels = models;
    cachedAt = Date.now();
    return { models, source: "live" };
  } catch {
    return {
      models: BUNDLED_DEEPGRAM_VOICE_THINK_MODELS.map((model) => ({ ...model })),
      source: "bundled",
    };
  }
}

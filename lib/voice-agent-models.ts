import type { ProviderModelMode } from "@/lib/llm-config";

export type DeepgramVoiceThinkProviderType =
  | "open_ai"
  | "anthropic"
  | "google"
  | "groq"
  | "nvidia";

export interface DeepgramVoiceThinkModel {
  provider: DeepgramVoiceThinkProviderType;
  model: string;
  label: string;
}

export interface VoiceAgentProviderSelection {
  providerId?: string | null;
  providerType?: string | null;
  providerLabel?: string | null;
  providerBaseUrl?: string | null;
  providerModel?: string | null;
  selectedModel?: string | null;
  selectedModelMode?: ProviderModelMode | null;
}

export type DeepgramVoiceCompatibility =
  | {
      compatible: true;
      provider: DeepgramVoiceThinkProviderType;
      model: string;
      providerLabel: string;
      supportedModels: string[];
    }
  | {
      compatible: false;
      reason: string;
      supportedModels: string[];
    };

export const BUNDLED_DEEPGRAM_VOICE_THINK_MODELS = [
  { provider: "open_ai", model: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { provider: "open_ai", model: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { provider: "open_ai", model: "gpt-5.2", label: "GPT 5.2" },
  { provider: "open_ai", model: "gpt-5.4", label: "GPT 5.4" },
  { provider: "open_ai", model: "gpt-4.1", label: "GPT-4.1" },
  { provider: "open_ai", model: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
  { provider: "open_ai", model: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
  { provider: "open_ai", model: "gpt-4o", label: "GPT-4o" },
  { provider: "open_ai", model: "gpt-4o-mini", label: "GPT-4o Mini" },
  { provider: "open_ai", model: "gpt-5", label: "GPT-5" },
  { provider: "open_ai", model: "gpt-5-mini", label: "GPT-5 Mini" },
  { provider: "open_ai", model: "gpt-5-nano", label: "GPT-5 Nano" },
  { provider: "open_ai", model: "gpt-5.1-chat-latest", label: "GPT-5.1 Instant" },
  { provider: "open_ai", model: "gpt-5.1", label: "GPT-5.1 Thinking" },
  { provider: "open_ai", model: "gpt-5.2-chat-latest", label: "GPT-5.2 Instant" },
  { provider: "open_ai", model: "gpt-5.3-chat-latest", label: "GPT-5.3 Instant" },
  { provider: "open_ai", model: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { provider: "open_ai", model: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
  { provider: "open_ai", model: "gpt-5.5", label: "GPT-5.5" },
  { provider: "anthropic", model: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { provider: "anthropic", model: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { provider: "anthropic", model: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { provider: "google", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { provider: "google", model: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  { provider: "google", model: "gemini-3-flash-preview", label: "Gemini 3.0 Flash Preview" },
  { provider: "google", model: "gemini-3-pro-preview", label: "Gemini 3.0 Pro Preview" },
  { provider: "google", model: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
  { provider: "google", model: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { provider: "groq", model: "openai/gpt-oss-20b", label: "GPT OSS 20B" },
  { provider: "nvidia", model: "nemotron-3-nano-30B-A3B", label: "Nemotron 3 Nano 30B A3B" },
] as const satisfies readonly DeepgramVoiceThinkModel[];

const PROVIDER_LABELS: Record<DeepgramVoiceThinkProviderType, string> = {
  open_ai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  groq: "Groq",
  nvidia: "Nvidia",
};

const DEFAULT_VOICE_RECOMMENDATIONS = [
  "GPT-5.6 Terra",
  "GPT-5.6 Luna",
  "Claude Sonnet 5",
  "Claude Haiku 4.5",
  "Gemini 3.5 Flash",
];

function modelRowsForProvider(
  provider: DeepgramVoiceThinkProviderType,
  models: readonly DeepgramVoiceThinkModel[]
) {
  return models.filter(
    (row) => row.provider === provider
  );
}

function supportedLabelsForProvider(
  provider: DeepgramVoiceThinkProviderType,
  models: readonly DeepgramVoiceThinkModel[]
) {
  return modelRowsForProvider(provider, models).map((row) => row.label);
}

function isSupported(
  provider: DeepgramVoiceThinkProviderType,
  model: string,
  models: readonly DeepgramVoiceThinkModel[]
) {
  return modelRowsForProvider(provider, models).some((row) => row.model === model);
}

function normalizeHostedModelName(model: string) {
  return model.trim().replace(/^models\//, "");
}

function normalizeProviderModel(
  model: string,
  provider: DeepgramVoiceThinkProviderType
) {
  const normalized = normalizeHostedModelName(model);
  const lastSegment = normalized.split("/").pop()?.trim() || normalized;

  if (provider === "anthropic" && lastSegment === "claude-haiku-4-5-20251001") {
    return "claude-haiku-4-5";
  }

  if (provider === "groq" && lastSegment === "gpt-oss-20b") {
    return "openai/gpt-oss-20b";
  }

  if (provider === "nvidia" && lastSegment.toLowerCase() === "nemotron-3-nano-30b-a3b") {
    return "nemotron-3-nano-30B-A3B";
  }

  if (provider === "google" || provider === "anthropic" || provider === "open_ai") {
    return lastSegment;
  }

  return normalized;
}

function inferDeepgramProvider(
  selection: VoiceAgentProviderSelection,
  model: string
): DeepgramVoiceThinkProviderType | null {
  const modelKey = model.toLowerCase();
  const providerType = (selection.providerType || "").toLowerCase();
  const providerKey = [
    selection.providerLabel,
    selection.providerBaseUrl,
    selection.providerModel,
    selection.selectedModel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (providerType === "openai") return "open_ai";
  if (providerType === "anthropic") return "anthropic";
  if (providerType !== "openai-compatible") return null;

  if (modelKey.includes("grok") || providerKey.includes("x.ai")) return null;
  if (modelKey.startsWith("claude-") || providerKey.includes("anthropic")) {
    return "anthropic";
  }
  if (modelKey.includes("gemini") || providerKey.includes("google")) {
    return "google";
  }
  if (providerKey.includes("groq") || modelKey.includes("gpt-oss")) {
    return "groq";
  }
  if (providerKey.includes("nvidia") || modelKey.includes("nemotron")) {
    return "nvidia";
  }
  if (modelKey.startsWith("gpt-") || /^o\d/.test(modelKey) || providerKey.includes("openai")) {
    return "open_ai";
  }

  return null;
}

function unsupportedMessage(
  model: string,
  provider: DeepgramVoiceThinkProviderType,
  supportedModels: string[]
) {
  return [
    `Deepgram Voice Agent is incompatible with "${model}" as a realtime think model.`,
    `Use one of these ${PROVIDER_LABELS[provider]} voice models: ${supportedModels.join(", ")}.`,
  ].join(" ");
}

export function formatVoiceAgentSupportedModels(models: string[]) {
  return models.join(", ");
}

export function getDeepgramVoiceAgentCompatibility(
  selection: VoiceAgentProviderSelection,
  models: readonly DeepgramVoiceThinkModel[] = BUNDLED_DEEPGRAM_VOICE_THINK_MODELS
): DeepgramVoiceCompatibility {
  const model = (selection.selectedModel || selection.providerModel || "").trim();
  const providerType = (selection.providerType || "").toLowerCase();

  if (!selection.providerId || !providerType) {
    return {
      compatible: false,
      reason:
        "Voice Agent needs a cloud model. Local Gemma/Ollama is too slow for realtime voice, so pick a supported cloud model first.",
      supportedModels: DEFAULT_VOICE_RECOMMENDATIONS,
    };
  }

  if (providerType === "ollama" || model.toLowerCase().includes("gemma")) {
    return {
      compatible: false,
      reason:
        "Voice Agent does not run with local Gemma/Ollama yet. Gemma is too slow for realtime voice, so pick a faster cloud voice model first.",
      supportedModels: DEFAULT_VOICE_RECOMMENDATIONS,
    };
  }

  if (!model) {
    return {
      compatible: false,
      reason: "The selected voice model is missing.",
      supportedModels: DEFAULT_VOICE_RECOMMENDATIONS,
    };
  }

  if (selection.selectedModelMode && selection.selectedModelMode !== "instant") {
    return {
      compatible: false,
      reason:
        "Deepgram Voice Agent only supports realtime/instant model selections. Reasoning, max, pro, deep, and adaptive modes are for text chat.",
      supportedModels: DEFAULT_VOICE_RECOMMENDATIONS,
    };
  }

  const provider = inferDeepgramProvider(selection, model);
  const modelKey = model.toLowerCase();
  const providerKey = `${selection.providerLabel || ""} ${selection.providerBaseUrl || ""}`.toLowerCase();

  if (!provider) {
    const isGrok = modelKey.includes("grok") || providerKey.includes("x.ai");
    return {
      compatible: false,
      reason: isGrok
        ? "Deepgram Voice Agent does not support xAI/Grok as the realtime think model yet."
        : "Deepgram Voice Agent does not know how to run this provider as a realtime think model yet.",
      supportedModels: DEFAULT_VOICE_RECOMMENDATIONS,
    };
  }

  const normalizedModel = normalizeProviderModel(model, provider);
  const supportedModels = supportedLabelsForProvider(provider, models);

  if (!isSupported(provider, normalizedModel, models)) {
    return {
      compatible: false,
      reason: unsupportedMessage(model, provider, supportedModels),
      supportedModels,
    };
  }

  return {
    compatible: true,
    provider,
    model: normalizedModel,
    providerLabel: PROVIDER_LABELS[provider],
    supportedModels,
  };
}

// Client-safe LLM constants (no server imports)
// This file is safe to import from React components.
// Server-side LLM code lives in `lib/llm.ts` and imports from this file.

export type ModelMode = "standard" | "unrestricted";

export type ProviderModelMode =
  | "instant"
  | "openai-thinking"
  | "openai-deep"
  | "openai-pro"
  | "openai-max"
  | "anthropic-adaptive-low"
  | "anthropic-adaptive-medium"
  | "anthropic-adaptive-high"
  | "anthropic-adaptive-xhigh"
  | "anthropic-adaptive-max";

export const DEFAULT_PROVIDER_MODEL_MODE: ProviderModelMode = "instant";

const PROVIDER_MODEL_MODES = new Set<ProviderModelMode>([
  "instant",
  "openai-thinking",
  "openai-deep",
  "openai-pro",
  "openai-max",
  "anthropic-adaptive-low",
  "anthropic-adaptive-medium",
  "anthropic-adaptive-high",
  "anthropic-adaptive-xhigh",
  "anthropic-adaptive-max",
]);

export function isProviderModelMode(value: string | null | undefined): value is ProviderModelMode {
  return !!value && PROVIDER_MODEL_MODES.has(value as ProviderModelMode);
}

export interface ModelConfig {
  baseURL: string;
  defaultModel: string;
  label: string;
  description: string;
}

export type CuratedProviderType = "anthropic" | "openai";

export interface ProviderModelOption {
  label: string;
  apiId: string;
  pricing: string;
  mode: ProviderModelMode;
}

export interface KnownProviderModel {
  label: string;
  apiId: string;
  pricing: string;
}

export const CURRENT_PROVIDER_MODELS: Record<CuratedProviderType, KnownProviderModel[]> = {
  anthropic: [
    { label: "Claude Fable 5.1", apiId: "claude-fable-5-1", pricing: "$10/$50 per 1M tok" },
    { label: "Claude Opus 5", apiId: "claude-opus-5", pricing: "$5/$25 per 1M tok" },
    { label: "Claude Sonnet 5", apiId: "claude-sonnet-5", pricing: "$2/$10 per 1M tok" },
    { label: "Claude Haiku 4.5", apiId: "claude-haiku-4-5-20251001", pricing: "$1/$5 per 1M tok" },
  ],
  openai: [
    { label: "GPT-5.6 Sol", apiId: "gpt-5.6-sol", pricing: "$4/$20 per 1M tok" },
    { label: "GPT-5.6 Terra", apiId: "gpt-5.6-terra", pricing: "$2/$12 per 1M tok" },
    { label: "GPT-5.6 Luna", apiId: "gpt-5.6-luna", pricing: "$0.20/$1.20 per 1M tok" },
  ],
};

const OPENAI_MODES: Array<{ suffix: string; mode: ProviderModelMode }> = [
  { suffix: "Instant", mode: "instant" },
  { suffix: "Thinking", mode: "openai-thinking" },
  { suffix: "Deep", mode: "openai-deep" },
  { suffix: "Max", mode: "openai-max" },
];

const ANTHROPIC_ADAPTIVE_MODES: Array<{ suffix: string; mode: ProviderModelMode }> = [
  { suffix: "Adaptive Low", mode: "anthropic-adaptive-low" },
  { suffix: "Adaptive Medium", mode: "anthropic-adaptive-medium" },
  { suffix: "Adaptive High", mode: "anthropic-adaptive-high" },
  { suffix: "Adaptive XHigh", mode: "anthropic-adaptive-xhigh" },
  { suffix: "Adaptive Max", mode: "anthropic-adaptive-max" },
];

export const PROVIDER_MODEL_OPTIONS: Record<CuratedProviderType, ProviderModelOption[]> = {
  anthropic: [
    ...CURRENT_PROVIDER_MODELS.anthropic
      .filter((model) => model.apiId !== "claude-haiku-4-5-20251001")
      .flatMap((model) =>
        ANTHROPIC_ADAPTIVE_MODES.map((variant) => ({
          ...model,
          label: `${model.label} ${variant.suffix}`,
          mode: variant.mode,
        }))
      ),
    {
      ...CURRENT_PROVIDER_MODELS.anthropic[3],
      mode: "instant",
    },
  ],
  openai: CURRENT_PROVIDER_MODELS.openai.flatMap((model) =>
    OPENAI_MODES.map((variant) => ({
      ...model,
      label: `${model.label} ${variant.suffix}`,
      mode: variant.mode,
    }))
  ),
};

export const WIKI_PROVIDER_MODEL_OPTIONS: Record<CuratedProviderType, ProviderModelOption[]> = {
  anthropic: [
    {
      ...CURRENT_PROVIDER_MODELS.anthropic[2],
      mode: "anthropic-adaptive-high",
    },
    {
      ...CURRENT_PROVIDER_MODELS.anthropic[3],
      mode: "instant",
    },
  ],
  openai: [
    {
      ...CURRENT_PROVIDER_MODELS.openai[1],
      mode: "instant",
    },
    {
      ...CURRENT_PROVIDER_MODELS.openai[2],
      mode: "instant",
    },
  ],
};

export const CURRENT_MODEL_PRICING_CENTS: Record<string, { in: number; out: number }> = {
  "claude-fable-5-1": { in: 1000, out: 5000 },
  "claude-opus-5": { in: 500, out: 2500 },
  "claude-sonnet-5": { in: 200, out: 1000 },
  "claude-haiku-4-5-20251001": { in: 100, out: 500 },
  "claude-haiku-4-5": { in: 100, out: 500 },
  "gpt-5.6-sol": { in: 400, out: 2000 },
  "gpt-5.6": { in: 400, out: 2000 },
  "gpt-5.6-terra": { in: 200, out: 1200 },
  "gpt-5.6-luna": { in: 20, out: 120 },
};

export function migrateProviderModelSelection(
  providerType: string,
  model: string,
  mode: ProviderModelMode
): { model: string; mode: ProviderModelMode } {
  if (providerType === "openai") {
    let nextModel = model;
    let nextMode = mode === "openai-pro" ? "openai-max" : mode;

    if (/^gpt-5(?:\.(?:4|5))?(?:-pro)?$/.test(model) || model === "gpt-4.1") {
      nextModel = "gpt-5.6-sol";
    } else if (/^gpt-(?:5(?:\.4)?|4\.1)-(?:mini|nano)$/.test(model)) {
      nextModel = "gpt-5.6-luna";
    }

    if (model.endsWith("-pro")) nextMode = "openai-max";
    return { model: nextModel, mode: nextMode };
  }

  if (providerType === "anthropic") {
    let nextModel = model;
    if (model === "claude-fable-5") nextModel = "claude-fable-5-1";
    else if (/^claude-opus-4(?:-|$)/.test(model)) nextModel = "claude-opus-5";
    else if (/^claude-sonnet-4(?:-|$)/.test(model)) nextModel = "claude-sonnet-5";
    else if (model === "claude-haiku-4-5") nextModel = "claude-haiku-4-5-20251001";

    if (nextModel === "claude-haiku-4-5-20251001") {
      return { model: nextModel, mode: "instant" };
    }
    if (
      ["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"].includes(nextModel) &&
      mode === "instant"
    ) {
      return { model: nextModel, mode: "anthropic-adaptive-high" };
    }
    return { model: nextModel, mode };
  }

  return { model, mode };
}

// User-selectable model variants for the UI picker
export const MODEL_OPTIONS = [
  {
    id: "gemma4:31b",
    label: "Gemma 4 31B",
    description: "Best quality, slowest. ~17 tok/s",
    sizeGB: 20,
    recommended: false,
  },
  {
    id: "gemma4:26b",
    label: "Gemma 4 26B MoE",
    description: "Fast and smart. ~50-80 tok/s",
    sizeGB: 18,
    recommended: true,
  },
  {
    id: "gemma4:e4b",
    label: "Gemma 4 E4B",
    description: "Lighter. Good for laptops. Very fast.",
    sizeGB: 10,
    recommended: false,
  },
  {
    id: "gemma4:e2b",
    label: "Gemma 4 E2B",
    description: "Smallest. Fastest download.",
    sizeGB: 7,
    recommended: false,
  },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

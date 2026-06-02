// Client-safe LLM constants (no server imports)
// This file is safe to import from React components.
// Server-side LLM code lives in `lib/llm.ts` and imports from this file.

export type ModelMode = "standard" | "unrestricted";

export type ProviderModelMode =
  | "instant"
  | "openai-thinking"
  | "openai-deep"
  | "openai-pro"
  | "anthropic-adaptive-low"
  | "anthropic-adaptive-medium"
  | "anthropic-adaptive-high"
  | "anthropic-adaptive-xhigh";

export const DEFAULT_PROVIDER_MODEL_MODE: ProviderModelMode = "instant";

const PROVIDER_MODEL_MODES = new Set<ProviderModelMode>([
  "instant",
  "openai-thinking",
  "openai-deep",
  "openai-pro",
  "anthropic-adaptive-low",
  "anthropic-adaptive-medium",
  "anthropic-adaptive-high",
  "anthropic-adaptive-xhigh",
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

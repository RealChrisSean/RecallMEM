// Client-safe LLM constants (no server imports)
// This file is safe to import from React components.
// Server-side LLM code lives in `lib/llm.ts` and imports from this file.

export type ModelMode = "standard" | "unrestricted";

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

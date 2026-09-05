import { describe, expect, it } from "vitest";
import {
  CURRENT_MODEL_PRICING_CENTS,
  CURRENT_PROVIDER_MODELS,
  PROVIDER_MODEL_OPTIONS,
  WIKI_PROVIDER_MODEL_OPTIONS,
  migrateProviderModelSelection,
} from "@/lib/llm-config";

describe("current provider model catalog", () => {
  it("contains only the current curated model families", () => {
    expect(CURRENT_PROVIDER_MODELS.openai.map((model) => model.apiId)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(CURRENT_PROVIDER_MODELS.anthropic.map((model) => model.apiId)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
  });

  it("keeps labels and accounting prices aligned", () => {
    expect(CURRENT_MODEL_PRICING_CENTS["gpt-5.6-sol"]).toEqual({ in: 400, out: 2000 });
    expect(CURRENT_MODEL_PRICING_CENTS["gpt-5.6-terra"]).toEqual({ in: 200, out: 1200 });
    expect(CURRENT_MODEL_PRICING_CENTS["gpt-5.6-luna"]).toEqual({ in: 20, out: 120 });
    expect(CURRENT_MODEL_PRICING_CENTS["claude-haiku-4-5-20251001"]).toEqual({ in: 100, out: 500 });
    expect(PROVIDER_MODEL_OPTIONS.openai).toHaveLength(12);
    expect(WIKI_PROVIDER_MODEL_OPTIONS.openai.map((model) => model.apiId)).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
  });
});

describe("legacy provider model migration", () => {
  it("upgrades OpenAI tiers and modes", () => {
    expect(migrateProviderModelSelection("openai", "gpt-5.5-pro", "openai-pro")).toEqual({
      model: "gpt-5.6-sol",
      mode: "openai-max",
    });
    expect(migrateProviderModelSelection("openai", "gpt-5.4-mini", "instant")).toEqual({
      model: "gpt-5.6-luna",
      mode: "instant",
    });
  });

  it("upgrades Claude tiers without changing provider records", () => {
    expect(migrateProviderModelSelection("anthropic", "claude-opus-4-8", "instant")).toEqual({
      model: "claude-opus-5",
      mode: "anthropic-adaptive-high",
    });
    expect(migrateProviderModelSelection("anthropic", "claude-haiku-4-5", "instant")).toEqual({
      model: "claude-haiku-4-5-20251001",
      mode: "instant",
    });
    expect(migrateProviderModelSelection("anthropic", "claude-sonnet-5", "instant")).toEqual({
      model: "claude-sonnet-5",
      mode: "anthropic-adaptive-high",
    });
  });
});

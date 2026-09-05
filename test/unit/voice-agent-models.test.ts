import { describe, expect, it } from "vitest";
import {
  BUNDLED_DEEPGRAM_VOICE_THINK_MODELS,
  getDeepgramVoiceAgentCompatibility,
} from "@/lib/voice-agent-models";

describe("voice agent model compatibility", () => {
  it("keeps the bundled fallback aligned with current Deepgram labels", () => {
    const ids = BUNDLED_DEEPGRAM_VOICE_THINK_MODELS.map((row) => row.model);
    expect(ids).toContain("gpt-5.6-terra");
    expect(ids).toContain("gpt-5.6-luna");
    expect(ids).toContain("claude-sonnet-5");
    expect(ids).toContain("gemini-2.0-flash-lite");
    expect(ids).not.toContain("claude-sonnet-4-20250514");
    expect(ids).not.toContain("gemini-3.1-flash-lite-preview");
  });
  it("accepts current supported GPT models", () => {
    const result = getDeepgramVoiceAgentCompatibility({
      providerId: "openai",
      providerType: "openai",
      providerLabel: "OpenAI",
      providerModel: "gpt-5.6-terra",
      selectedModel: "gpt-5.6-terra",
      selectedModelMode: "instant",
    });

    expect(result.compatible).toBe(true);
    if (result.compatible) {
      expect(result.provider).toBe("open_ai");
      expect(result.model).toBe("gpt-5.6-terra");
    }
  });

  it("rejects text-only GPT modes for realtime voice", () => {
    const result = getDeepgramVoiceAgentCompatibility({
      providerId: "openai",
      providerType: "openai",
      providerLabel: "OpenAI",
      providerModel: "gpt-5.5",
      selectedModel: "gpt-5.5",
      selectedModelMode: "openai-thinking",
    });

    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("only supports realtime/instant");
    }
  });

  it("maps Anthropic's dated Haiku app ID to Deepgram's supported ID", () => {
    const result = getDeepgramVoiceAgentCompatibility({
      providerId: "anthropic",
      providerType: "anthropic",
      providerLabel: "Anthropic",
      providerModel: "claude-haiku-4-5-20251001",
      selectedModel: "claude-haiku-4-5-20251001",
      selectedModelMode: "instant",
    });

    expect(result.compatible).toBe(true);
    if (result.compatible) {
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-haiku-4-5");
    }
  });

  it("rejects Claude Opus because Deepgram does not expose it for Voice Agent", () => {
    const result = getDeepgramVoiceAgentCompatibility({
      providerId: "anthropic",
      providerType: "anthropic",
      providerLabel: "Anthropic",
      providerModel: "claude-opus-4-8",
      selectedModel: "claude-opus-4-8",
      selectedModelMode: "instant",
    });

    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("incompatible");
      expect(result.supportedModels).toEqual(
        expect.arrayContaining(["Claude Sonnet 4.6", "Claude Haiku 4.5"])
      );
    }
  });

  it("rejects Grok because Deepgram does not expose xAI as a think provider", () => {
    const result = getDeepgramVoiceAgentCompatibility({
      providerId: "xai",
      providerType: "openai-compatible",
      providerLabel: "Grok",
      providerBaseUrl: "https://api.x.ai/v1",
      providerModel: "grok-4.20-0309-reasoning",
      selectedModel: "grok-4.20-0309-reasoning",
      selectedModelMode: "instant",
    });

    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("xAI/Grok");
    }
  });
});

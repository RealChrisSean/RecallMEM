import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Deepgram voice model discovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("intersects the live model endpoint with RecallMEM's curated catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [
        { id: "gpt-5.5", name: "GPT-5.5", provider: "open_ai" },
        { id: "gpt-5.6-luna", name: "Provider-controlled label", provider: "open_ai" },
        { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
      ],
    }), { status: 200 })));
    const { getDeepgramVoiceThinkModels } = await import("@/lib/deepgram-voice-models");

    await expect(getDeepgramVoiceThinkModels()).resolves.toEqual({
      source: "live",
      models: [{ model: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "open_ai" }],
    });
  });

  it("does not fall back to deprecated models when the live feed has no curated match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models: [{ id: "gpt-5.5", name: "GPT-5.5", provider: "open_ai" }],
    }), { status: 200 })));
    const { getDeepgramVoiceThinkModels } = await import("@/lib/deepgram-voice-models");

    await expect(getDeepgramVoiceThinkModels()).resolves.toEqual({
      source: "live",
      models: [],
    });
  });

  it("falls back to the bundled catalog when discovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { getDeepgramVoiceThinkModels } = await import("@/lib/deepgram-voice-models");
    const result = await getDeepgramVoiceThinkModels();

    expect(result.source).toBe("bundled");
    expect(result.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "gpt-5.6-terra" }),
      expect.objectContaining({ model: "claude-sonnet-5" }),
    ]));
    expect(result.models.map((model) => model.model)).not.toEqual(
      expect.arrayContaining(["gpt-5.5", "claude-sonnet-4-6", "gemini-3-flash-preview"])
    );
  });
});

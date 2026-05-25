import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getProfile: vi.fn(),
  getPinnedFacts: vi.fn(),
  getActiveFacts: vi.fn(),
  getRules: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getSetting: mocks.getSetting,
}));

vi.mock("@/lib/profile", () => ({
  getProfile: mocks.getProfile,
}));

vi.mock("@/lib/facts", () => ({
  getPinnedFacts: mocks.getPinnedFacts,
  getActiveFacts: mocks.getActiveFacts,
}));

vi.mock("@/lib/rules", () => ({
  getRules: mocks.getRules,
}));

vi.mock("@/lib/providers", () => ({
  getProvider: mocks.getProvider,
}));

import { POST } from "@/app/api/voice-agent/route";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/voice-agent", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as NextRequest;
}

describe("voice-agent route", () => {
  beforeEach(() => {
    mocks.getSetting.mockReset();
    mocks.getProfile.mockReset();
    mocks.getPinnedFacts.mockReset();
    mocks.getActiveFacts.mockReset();
    mocks.getRules.mockReset();
    mocks.getProvider.mockReset();

    mocks.getSetting.mockImplementation(async (key: string) =>
      key === "deepgram_api_key" ? "deepgram-key" : null
    );
    mocks.getProfile.mockResolvedValue(null);
    mocks.getPinnedFacts.mockResolvedValue([]);
    mocks.getActiveFacts.mockResolvedValue([]);
    mocks.getRules.mockResolvedValue("");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: "temporary-dg-token", expires_in: 300 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
  });

  it("uses the selected OpenAI model as Deepgram's think provider", async () => {
    mocks.getProvider.mockResolvedValue({
      id: "provider-openai",
      label: "OpenAI",
      type: "openai",
      model: "gpt-5.5",
      base_url: "https://api.openai.com",
      api_key: "secret",
      user_id: "local-user",
      created_at: new Date(),
    });

    const res = await POST(
      request({ providerId: "provider-openai", model: "gpt-5.5", messages: [] })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.thinkModel).toBe("gpt-5.5");
    expect(body.thinkProviderId).toBe("provider-openai");
    expect(body.thinkModelLabel).toBe("gpt-5.5 via OpenAI");
    expect(body.voiceSpeed).toBe(1);
    expect(body.settings.agent.think.provider).toEqual({
      type: "open_ai",
      model: "gpt-5.5",
    });
  });

  it("uses the selected Anthropic model as Deepgram's think provider", async () => {
    mocks.getProvider.mockResolvedValue({
      id: "provider-anthropic",
      label: "Claude",
      type: "anthropic",
      model: "claude-opus-4-7",
      base_url: "https://api.anthropic.com",
      api_key: "secret",
      user_id: "local-user",
      created_at: new Date(),
    });

    const res = await POST(
      request({
        providerId: "provider-anthropic",
        model: "claude-opus-4-7",
        messages: [],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.thinkModelLabel).toBe("claude-opus-4-7 via Anthropic");
    expect(body.settings.agent.think.provider).toEqual({
      type: "anthropic",
      model: "claude-opus-4-7",
    });
  });

  it("uses saved voice agent voice, speed, and speaking style settings", async () => {
    mocks.getSetting.mockImplementation(async (key: string) => {
      if (key === "deepgram_api_key") return "deepgram-key";
      if (key === "voice_agent_voice") return "aura-2-athena-en";
      if (key === "voice_agent_speed") return "0.85";
      if (key === "voice_agent_style") return "storytelling";
      return null;
    });
    mocks.getProvider.mockResolvedValue({
      id: "provider-openai",
      label: "OpenAI",
      type: "openai",
      model: "gpt-5.5",
      base_url: "https://api.openai.com",
      api_key: "secret",
      user_id: "local-user",
      created_at: new Date(),
    });

    const res = await POST(
      request({ providerId: "provider-openai", model: "gpt-5.5", messages: [] })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.voiceModel).toBe("aura-2-athena-en");
    expect(body.voiceSpeed).toBe(0.85);
    expect(body.voiceStyle).toBe("storytelling");
    expect(body.settings.audio).toEqual({
      input: {
        encoding: "linear16",
        sample_rate: 16000,
      },
      output: {
        encoding: "linear16",
        sample_rate: 48000,
        container: "none",
      },
    });
    expect(body.settings.agent.speak.provider).toEqual({
      type: "deepgram",
      model: "aura-2-athena-en",
      speed: 0.85,
    });
    expect(body.settings.agent.think.prompt).toContain("Speaking style: storytelling");
    expect(body.settings.agent.think.prompt).toContain(
      "Use it when the user asks about themselves"
    );
    expect(body.settings.agent.think.prompt).toContain(
      "Skip it for greetings, quick reactions, general knowledge"
    );
  });

  it("blocks local Gemma/Ollama because realtime voice needs a cloud model", async () => {
    const res = await POST(request({ model: "gemma4:26b", messages: [] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Local Gemma/Ollama is too slow");
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it("maps recognizable OpenAI-compatible Gemini providers to Deepgram Google", async () => {
    mocks.getProvider.mockResolvedValue({
      id: "provider-gemini",
      label: "Gemini",
      type: "openai-compatible",
      model: "google/gemini-2.5-flash-preview-05-20",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
      api_key: "secret",
      user_id: "local-user",
      created_at: new Date(),
    });

    const res = await POST(
      request({
        providerId: "provider-gemini",
        model: "google/gemini-2.5-flash-preview-05-20",
        messages: [],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.thinkModelLabel).toBe(
      "gemini-2.5-flash-preview-05-20 via Google"
    );
    expect(body.settings.agent.think.provider).toEqual({
      type: "google",
      model: "gemini-2.5-flash-preview-05-20",
    });
  });

  it("blocks xAI/Grok because Deepgram cannot run it as a managed think model", async () => {
    mocks.getProvider.mockResolvedValue({
      id: "provider-xai",
      label: "Grok",
      type: "openai-compatible",
      model: "grok-4.20-0309-reasoning",
      base_url: "https://api.x.ai/v1",
      api_key: "secret",
      user_id: "local-user",
      created_at: new Date(),
    });

    const res = await POST(
      request({
        providerId: "provider-xai",
        model: "grok-4.20-0309-reasoning",
        messages: [],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("does not support xAI/Grok");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  getSetting: vi.fn(),
  logUsage: vi.fn(),
}));

vi.mock("@/lib/providers", () => ({
  listProviders: mocks.listProviders,
}));

vi.mock("@/lib/settings", () => ({
  getSetting: mocks.getSetting,
}));

vi.mock("@/lib/usage", () => ({
  logUsage: mocks.logUsage,
}));

import { GET, POST } from "@/app/api/tts/route";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/tts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as NextRequest;
}

describe("tts route", () => {
  beforeEach(() => {
    mocks.listProviders.mockReset();
    mocks.getSetting.mockReset();
    mocks.logUsage.mockReset();
    vi.unstubAllGlobals();

    mocks.listProviders.mockResolvedValue([]);
    mocks.getSetting.mockResolvedValue(null);
  });

  it("prefers Deepgram for normal chat TTS when a Deepgram key exists", async () => {
    mocks.listProviders.mockResolvedValue([
      {
        id: "openai",
        type: "openai",
        api_key: "openai-key",
        base_url: "https://api.openai.com",
      },
    ]);
    mocks.getSetting.mockImplementation(async (key: string) => {
      if (key === "deepgram_api_key") return "deepgram-key";
      return null;
    });

    const res = await GET();
    const body = await res.json();

    expect(body.available.deepgram).toBe(true);
    expect(body.available.openai).toBe(true);
    expect(body.settings.provider).toBe("deepgram");
    expect(body.settings.voiceAgentVoice).toBe("aura-2-amalthea-en");
  });

  it("uses the Voice Agent Deepgram voice and speed for speaker-button TTS", async () => {
    mocks.getSetting.mockImplementation(async (key: string) => {
      if (key === "deepgram_api_key") return "deepgram-key";
      if (key === "voice_agent_voice") return "aura-2-athena-en";
      if (key === "voice_agent_speed") return "1.15";
      return null;
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("audio", {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(request({ text: "Read this back to me." }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe("https://api.deepgram.com/v1/speak");
    expect(parsed.searchParams.get("model")).toBe("aura-2-athena-en");
    expect(parsed.searchParams.get("encoding")).toBe("mp3");
    expect(parsed.searchParams.get("bit_rate")).toBe("48000");
    expect(parsed.searchParams.get("speed")).toBe("1.15");
    expect(init.headers.Authorization).toBe("Token deepgram-key");
    expect(JSON.parse(init.body).text).toBe("Read this back to me.");
    expect(mocks.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "deepgram",
        service: "tts",
        model: "aura-2-athena-en",
      })
    );
  });
});

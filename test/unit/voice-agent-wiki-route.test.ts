import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  answerWikiQuestion: vi.fn(),
}));

vi.mock("@/lib/wiki", () => ({
  answerWikiQuestion: mocks.answerWikiQuestion,
}));

import { POST } from "@/app/api/voice-agent/wiki/route";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/voice-agent/wiki", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as NextRequest;
}

describe("voice-agent wiki route", () => {
  beforeEach(() => {
    mocks.answerWikiQuestion.mockReset();
  });

  it("rejects blank queries without touching wiki retrieval", async () => {
    const res = await POST(request({ query: "   " }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      answer: "I don't have that in this brain's sources.",
      citations: [],
      notInSources: true,
    });
    expect(mocks.answerWikiQuestion).not.toHaveBeenCalled();
  });

  it("queries public wiki sources with the selected voice model", async () => {
    mocks.answerWikiQuestion.mockResolvedValue({
      answer: "Sprites can expose a public URL.",
      citations: [
        {
          marker: "C1",
          citation: "superfly/sprites-docs@abcdef src/content/docs/working-with-sprites.mdx:L110-L110",
          url: "https://github.com/superfly/sprites-docs/blob/abcdef/src/content/docs/working-with-sprites.mdx#L110-L110",
          quote: "sprite url update --auth public",
        },
      ],
      chunks: [],
      notInSources: false,
      llmUsed: true,
    });

    const res = await POST(
      request({
        query: "How do I expose a Sprite publicly?",
        brain: "sprites",
        socratic: true,
        providerId: "provider-anthropic",
        model: "claude-haiku-4-5",
        modelMode: "instant",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.answerWikiQuestion).toHaveBeenCalledWith({
      brain: "sprites",
      question: "How do I expose a Sprite publicly?",
      socratic: true,
      providerId: "provider-anthropic",
      model: "claude-haiku-4-5",
      providerModelMode: "instant",
      publicSourcesOnly: true,
    });
    expect(body).toEqual({
      answer: "Sprites can expose a public URL.",
      citations: [
        {
          marker: "C1",
          citation: "superfly/sprites-docs@abcdef src/content/docs/working-with-sprites.mdx:L110-L110",
          url: "https://github.com/superfly/sprites-docs/blob/abcdef/src/content/docs/working-with-sprites.mdx#L110-L110",
        },
      ],
      notInSources: false,
      validationFailed: false,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  chat: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: vi.fn(),
  getUserId: vi.fn().mockResolvedValue("test-user"),
  toVectorString: (embedding: number[]) => `[${embedding.join(",")}]`,
}));

vi.mock("@/lib/embeddings", () => ({
  embedWithSource: vi.fn(),
  getEmbeddingSource: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  chat: mocks.chat,
  FAST_MODEL: "test-fast-model",
}));

import { extractFactsWithSupersession } from "@/lib/facts";

describe("extractFactsWithSupersession", () => {
  const filler = " More context: the user is discussing durable personal memory extraction, not a throwaway one-word chat.";

  beforeEach(() => {
    mocks.query.mockReset();
    mocks.chat.mockReset();

    mocks.query.mockResolvedValue([]);
  });

  it("passes the conversation date into the extraction prompt", async () => {
    mocks.chat.mockResolvedValue(
      JSON.stringify({
        facts: [
          {
            text: "User said on 2026-05-23 that their job starts around 2026-06-23.",
            quote: "My job starts in 1 month.",
          },
        ],
        supersedes: [],
      })
    );

    const result = await extractFactsWithSupersession(
      `user: My job starts in 1 month.\nassistant: That's huge and exciting.${filler}`,
      { conversationDate: "2026-05-23T12:00:00.000Z" }
    );

    const prompt = mocks.chat.mock.calls[0]?.[0]?.[0]?.content;
    expect(prompt).toContain("CONVERSATION DATE:\n2026-05-23");
    expect(prompt).toContain("No quote, no memory");
    expect(result.facts).toEqual([
      {
        text: "User said on 2026-05-23 that their job starts around 2026-06-23.",
        supportingQuote: "My job starts in 1 month.",
        sourceMessageIndex: null,
      },
    ]);
  });

  it("rejects unsupported, legacy, and ungrounded facts from model output", async () => {
    mocks.query.mockResolvedValue([
      {
        id: "11111111-1111-1111-1111-111111111111",
        fact_text: "User's old job starts later.",
      },
    ]);
    mocks.chat.mockResolvedValue(
      JSON.stringify({
        facts: [
          "User lives in Los Angeles.",
          {
            text: "User has three dogs.",
            quote: "I have three dogs.",
          },
          {
            text: "User's job starts in 1 month.",
            quote: "My job starts in 1 month.",
          },
          {
            text: "User said on 2026-05-23 that their job starts around 2026-06-23.",
            quote: "My job starts in 1 month.",
          },
        ],
        supersedes: ["not-a-uuid", "11111111-1111-1111-1111-111111111111"],
      })
    );

    const result = await extractFactsWithSupersession(
      `user: My job starts in 1 month.\nassistant: Nice.${filler}`,
      { conversationDate: "2026-05-23" }
    );

    expect(result).toEqual({
      facts: [
        {
          text: "User said on 2026-05-23 that their job starts around 2026-06-23.",
          supportingQuote: "My job starts in 1 month.",
          sourceMessageIndex: null,
          supersedes: ["11111111-1111-1111-1111-111111111111"],
        },
      ],
      supersedes: ["11111111-1111-1111-1111-111111111111"],
    });
  });

  it("keeps replacement ids attached to the specific proposed fact", async () => {
    mocks.query.mockResolvedValue([
      {
        id: "11111111-1111-1111-1111-111111111111",
        fact_text: "User works at Acme.",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        fact_text: "User lives in Boston.",
      },
    ]);
    mocks.chat.mockResolvedValue(
      JSON.stringify({
        facts: [
          {
            text: "User left Acme in 2026.",
            quote: "I left Acme in 2026.",
            supersedes: [
              "11111111-1111-1111-1111-111111111111",
              "33333333-3333-3333-3333-333333333333",
            ],
          },
          {
            text: "User is learning Rust.",
            quote: "I am learning Rust.",
          },
        ],
      })
    );

    const result = await extractFactsWithSupersession(
      `user: I left Acme in 2026. I am learning Rust.\nassistant: Understood.${filler}`,
      { conversationDate: "2026-05-23" }
    );

    expect(result.facts[0]?.supersedes).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
    expect(result.facts[1]?.supersedes).toBeUndefined();
    expect(result.supersedes).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
  });

  it("returns empty results when the model does not return JSON", async () => {
    mocks.chat.mockResolvedValue("I cannot help with that.");

    const result = await extractFactsWithSupersession(
      `user: I live in Los Angeles now.\nassistant: Nice, I'll remember that.${filler}`,
      { conversationDate: "2026-05-23" }
    );

    expect(result).toEqual({ facts: [], supersedes: [] });
  });
});

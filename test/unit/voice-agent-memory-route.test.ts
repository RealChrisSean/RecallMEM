import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  searchFacts: vi.fn(),
  searchChunks: vi.fn(),
}));

vi.mock("@/lib/facts", () => ({
  searchFacts: mocks.searchFacts,
}));

vi.mock("@/lib/chunks", () => ({
  searchChunks: mocks.searchChunks,
}));

import { POST } from "@/app/api/voice-agent/memory/route";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/voice-agent/memory", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as NextRequest;
}

describe("voice-agent memory route", () => {
  beforeEach(() => {
    mocks.searchFacts.mockReset();
    mocks.searchChunks.mockReset();
  });

  it("returns an empty consistent shape for blank queries", async () => {
    const res = await POST(request({ query: "   " }));

    await expect(res.json()).resolves.toEqual({
      facts: [],
      conversations: [],
    });
    expect(mocks.searchFacts).not.toHaveBeenCalled();
    expect(mocks.searchChunks).not.toHaveBeenCalled();
  });

  it("trims queries and keeps keyword or receipt matches without vector distance", async () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    mocks.searchFacts.mockResolvedValue([
      {
        fact_text: "User is building RecallMEM.",
        created_at: now,
        valid_from: now,
        distance: null,
        match_reason: "receipt",
      },
      {
        fact_text: "User vaguely likes tools.",
        created_at: now,
        valid_from: now,
        distance: 0.9,
        match_reason: "semantic",
      },
    ]);
    mocks.searchChunks.mockResolvedValue([
      {
        chunk_text: "The exact phrase RecallMEM appeared in this transcript.",
        chat_created_at: now,
        distance: null,
        match_reason: "keyword",
      },
      {
        chunk_text: "A weak semantic hit should be filtered out.",
        chat_created_at: now,
        distance: 0.9,
        match_reason: "semantic",
      },
    ]);

    const res = await POST(request({ query: "  RecallMEM  " }));

    expect(mocks.searchFacts).toHaveBeenCalledWith("RecallMEM", 15);
    expect(mocks.searchChunks).toHaveBeenCalledWith("RecallMEM", null, 5);
    await expect(res.json()).resolves.toEqual({
      facts: ["[2026-05-23; receipt match] User is building RecallMEM."],
      conversations: [
        "[from 2026-05-23; keyword match] The exact phrase RecallMEM appeared in this transcript.",
      ],
    });
  });
});

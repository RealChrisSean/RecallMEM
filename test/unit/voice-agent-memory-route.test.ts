import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  searchFacts: vi.fn(),
  searchFactsKeyword: vi.fn(),
  searchChunks: vi.fn(),
  searchChunksKeyword: vi.fn(),
}));

vi.mock("@/lib/facts", () => ({
  searchFacts: mocks.searchFacts,
  searchFactsKeyword: mocks.searchFactsKeyword,
}));

vi.mock("@/lib/chunks", () => ({
  searchChunks: mocks.searchChunks,
  searchChunksKeyword: mocks.searchChunksKeyword,
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
    mocks.searchFactsKeyword.mockReset();
    mocks.searchChunks.mockReset();
    mocks.searchChunksKeyword.mockReset();
  });

  it("returns an empty consistent shape for blank queries", async () => {
    const res = await POST(request({ query: "   " }));

    await expect(res.json()).resolves.toEqual({
      facts: [],
      conversations: [],
    });
    expect(mocks.searchFacts).not.toHaveBeenCalled();
    expect(mocks.searchFactsKeyword).not.toHaveBeenCalled();
    expect(mocks.searchChunks).not.toHaveBeenCalled();
    expect(mocks.searchChunksKeyword).not.toHaveBeenCalled();
  });

  it("trims queries and keeps keyword or receipt matches without vector distance", async () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    mocks.searchFactsKeyword.mockResolvedValue([
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
    mocks.searchFacts.mockResolvedValue([]);
    mocks.searchChunksKeyword.mockResolvedValue([
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
    mocks.searchChunks.mockResolvedValue([]);

    const res = await POST(request({ query: "  RecallMEM  " }));

    expect(mocks.searchFactsKeyword).toHaveBeenCalledWith("RecallMEM", 10);
    expect(mocks.searchChunksKeyword).toHaveBeenCalledWith("RecallMEM", null, 3);
    await expect(res.json()).resolves.toEqual({
      facts: ["[2026-05-23; receipt match] User is building RecallMEM."],
      conversations: [
        "[from 2026-05-23; keyword match] The exact phrase RecallMEM appeared in this transcript.",
      ],
    });
  });

  it("returns fast keyword matches even when semantic search is slow", async () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    mocks.searchFactsKeyword.mockResolvedValue([
      {
        fact_text: "User likes low-latency voice.",
        created_at: now,
        valid_from: now,
        distance: null,
        match_reason: "keyword",
      },
    ]);
    mocks.searchChunksKeyword.mockResolvedValue([]);
    mocks.searchFacts.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 5000))
    );
    mocks.searchChunks.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 5000))
    );

    const started = Date.now();
    const res = await POST(request({ query: "low-latency voice" }));
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1500);
    await expect(res.json()).resolves.toEqual({
      facts: ["[2026-05-23; keyword match] User likes low-latency voice."],
      conversations: [],
    });
  });
});

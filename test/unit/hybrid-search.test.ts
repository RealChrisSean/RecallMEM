import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUserId: vi.fn(),
  embedWithSource: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  getUserId: mocks.getUserId,
  toVectorString: (embedding: number[]) => `[${embedding.join(",")}]`,
}));

vi.mock("@/lib/embeddings", () => ({
  embedWithSource: mocks.embedWithSource,
  embedBatchWithSource: vi.fn(),
  embeddingColumnForSource: (source: "openai" | "ollama") =>
    source === "openai" ? "embedding_oai" : "embedding",
  getEmbeddingSource: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  chat: vi.fn(),
  FAST_MODEL: "test-fast-model",
}));

import { searchChunks } from "@/lib/chunks";
import { searchFacts } from "@/lib/facts";
import { sqlLikePattern } from "@/lib/search";

describe("hybrid memory search", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.getUserId.mockReset();
    mocks.embedWithSource.mockReset();

    mocks.getUserId.mockResolvedValue("test-user");
    mocks.embedWithSource.mockRejectedValue(new Error("embedding service unavailable"));
  });

  it("escapes LIKE wildcards so exact search stays literal", () => {
    expect(sqlLikePattern("grok_4.20%")).toBe("%grok\\_4.20\\%%");
    expect(sqlLikePattern("path\\name")).toBe("%path\\\\name%");
  });

  it("does not let blank fact searches match every fact", async () => {
    await expect(searchFacts("   ", 5)).resolves.toEqual([]);
    expect(mocks.getUserId).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not let blank chunk searches match every transcript", async () => {
    await expect(searchChunks("\n\t", null, 5)).resolves.toEqual([]);
    expect(mocks.getUserId).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns keyword fact matches even when semantic embedding fails", async () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM s2m_user_facts f")) {
        return [
          {
            id: "fact-1",
            user_id: "test-user",
            fact_text: "User uses grok-4.20-0309-reasoning for long context.",
            category: "preference",
            source_chat_id: null,
            is_active: true,
            superseded_by: null,
            supporting_quote: "grok-4.20-0309-reasoning",
            source_message_index: 0,
            created_at: now,
            valid_from: now,
            valid_to: null,
            distance: null,
            text_rank: 0.5,
            match_reason: "receipt",
          },
        ];
      }
      return [];
    });

    const results = await searchFacts("grok-4.20-0309-reasoning", 5);

    expect(results).toHaveLength(1);
    expect(results[0].match_reason).toBe("receipt");
    expect(results[0].distance).toBeNull();
    expect(results[0].fact_text).toContain("grok-4.20-0309-reasoning");
  });

  it("returns keyword transcript chunks even when semantic embedding fails", async () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM s2m_transcript_chunks c")) {
        return [
          {
            chunk_text: "We hit an error with grok-4.20-0309-reasoning after submit.",
            chat_id: "chat-1",
            chat_created_at: now,
            distance: null,
            text_rank: 0.8,
            match_reason: "keyword",
          },
        ];
      }
      return [];
    });

    const results = await searchChunks("grok-4.20-0309-reasoning", null, 5);

    expect(results).toHaveLength(1);
    expect(results[0].match_reason).toBe("keyword");
    expect(results[0].distance).toBeNull();
    expect(results[0].chunk_text).toContain("grok-4.20-0309-reasoning");
  });

  it("trims fact queries and deduplicates keyword plus semantic matches", async () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    const factOne = {
      id: "fact-1",
      user_id: "test-user",
      fact_text: "User is building RecallMEM.",
      category: "project",
      source_chat_id: null,
      is_active: true,
      superseded_by: null,
      supporting_quote: "I'm building RecallMEM.",
      source_message_index: 0,
      created_at: now,
      valid_from: now,
      valid_to: null,
    };
    const factTwo = {
      ...factOne,
      id: "fact-2",
      fact_text: "User prefers local-first memory.",
      supporting_quote: "I prefer local-first memory.",
    };

    mocks.embedWithSource.mockResolvedValue({
      vector: [0.1, 0.2, 0.3],
      source: "ollama",
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM s2m_user_facts f")) {
        return [{ ...factOne, distance: null, text_rank: 0.9, match_reason: "keyword" }];
      }
      if (sql.includes("'semantic' AS match_reason") && sql.includes("FROM s2m_user_facts")) {
        return [
          { ...factOne, distance: 0.1, text_rank: null, match_reason: "semantic" },
          { ...factTwo, distance: 0.2, text_rank: null, match_reason: "semantic" },
        ];
      }
      return [];
    });

    const results = await searchFacts("  RecallMEM  ", 5);

    expect(mocks.embedWithSource).toHaveBeenCalledWith("RecallMEM");
    expect(mocks.query.mock.calls[0][1]).toEqual([
      "test-user",
      "RecallMEM",
      "%RecallMEM%",
      5,
    ]);
    expect(results.map((row) => row.id)).toEqual(["fact-1", "fact-2"]);
    expect(results[0].match_reason).toBe("keyword");
  });

  it("trims chunk queries, passes exclude chat IDs, and deduplicates results", async () => {
    const now = new Date("2026-05-23T00:00:00.000Z");
    const chunkOne = {
      chunk_text: "RecallMEM exact phrase appears here.",
      chat_id: "chat-1",
      chat_created_at: now,
    };
    const chunkTwo = {
      chunk_text: "Local-first memory appeared in another chat.",
      chat_id: "chat-2",
      chat_created_at: now,
    };

    mocks.embedWithSource.mockResolvedValue({
      vector: [0.1, 0.2, 0.3],
      source: "ollama",
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM s2m_transcript_chunks c") && sql.includes("needle")) {
        return [{ ...chunkOne, distance: null, text_rank: 0.9, match_reason: "keyword" }];
      }
      if (sql.includes("'semantic' AS match_reason") && sql.includes("FROM s2m_transcript_chunks")) {
        return [
          { ...chunkOne, distance: 0.1, text_rank: null, match_reason: "semantic" },
          { ...chunkTwo, distance: 0.2, text_rank: null, match_reason: "semantic" },
        ];
      }
      return [];
    });

    const results = await searchChunks("  RecallMEM  ", "chat-current", 5);

    expect(mocks.embedWithSource).toHaveBeenCalledWith("RecallMEM");
    expect(mocks.query.mock.calls[0][1]).toEqual([
      "test-user",
      "RecallMEM",
      "%RecallMEM%",
      5,
      "chat-current",
    ]);
    expect(results.map((row) => row.chat_id)).toEqual(["chat-1", "chat-2"]);
    expect(results[0].match_reason).toBe("keyword");
  });
});

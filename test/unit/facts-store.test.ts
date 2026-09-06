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
  getEmbeddingSource: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  chat: vi.fn(),
  FAST_MODEL: "test-fast-model",
}));

import { storeFacts } from "@/lib/facts";

describe("storeFacts", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.getUserId.mockReset();
    mocks.embedWithSource.mockReset();

    mocks.getUserId.mockResolvedValue("test-user");
    mocks.embedWithSource.mockResolvedValue({
      vector: [0.1, 0.2, 0.3],
      source: "ollama",
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT fact_text")) return [];
      return [];
    });
  });

  it("stores the supporting quote with evidence-backed facts", async () => {
    const inserted = await storeFacts(
      [
        {
          text: "User said they live in Example City.",
          supportingQuote: "I live in Example City now.",
          sourceMessageIndex: 3,
        },
      ],
      "11111111-1111-1111-1111-111111111111"
    );

    expect(inserted).toBe(1);

    const insertCall = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO s2m_user_facts")
    );
    expect(insertCall).toBeDefined();
    expect(String(insertCall?.[0])).toContain("supporting_quote");
    expect(String(insertCall?.[0])).toContain("source_message_index");
    expect(insertCall?.[1]).toEqual([
      "test-user",
      "User said they live in Example City.",
      "identity",
      "11111111-1111-1111-1111-111111111111",
      "I live in Example City now.",
      3,
      "[0.1,0.2,0.3]",
    ]);
  });

  it("keeps legacy string facts insertable without a supporting quote", async () => {
    const inserted = await storeFacts(
      ["User is building RecallMEM."],
      null
    );

    expect(inserted).toBe(1);

    const insertCall = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO s2m_user_facts")
    );
    expect(insertCall?.[1]).toEqual([
      "test-user",
      "User is building RecallMEM.",
      "project",
      null,
      null,
      null,
      "[0.1,0.2,0.3]",
    ]);
  });

  it("still inserts a fact when embedding generation fails", async () => {
    mocks.embedWithSource.mockRejectedValueOnce(new Error("embedding down"));

    const inserted = await storeFacts(
      [
        {
          text: "User prefers exact memory receipts.",
          supportingQuote: "I want exact memory receipts.",
        },
      ],
      null
    );

    expect(inserted).toBe(1);

    const insertCall = mocks.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO s2m_user_facts")
    );
    expect(insertCall?.[1]).toEqual([
      "test-user",
      "User prefers exact memory receipts.",
      "preference",
      null,
      "I want exact memory receipts.",
      null,
      null,
    ]);
  });

  it("skips duplicate facts that already exist in storage", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT fact_text")) {
        return [{ fact_text: "User is building RecallMEM." }];
      }
      return [];
    });

    const inserted = await storeFacts(["User is building RecallMEM."], null);

    expect(inserted).toBe(0);
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO s2m_user_facts")
      )
    ).toBe(false);
  });

  it("deduplicates repeated facts within the same store call", async () => {
    const inserted = await storeFacts(
      [
        "User is building RecallMEM.",
        "User is building RecallMEM.",
      ],
      null
    );

    expect(inserted).toBe(1);
    expect(
      mocks.query.mock.calls.filter(([sql]) =>
        String(sql).includes("INSERT INTO s2m_user_facts")
      )
    ).toHaveLength(1);
  });

  it("skips blank and garbage facts before inserting", async () => {
    const inserted = await storeFacts(
      ["", "User tested the mic."],
      null
    );

    expect(inserted).toBe(0);
    expect(
      mocks.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO s2m_user_facts")
      )
    ).toBe(false);
  });
});

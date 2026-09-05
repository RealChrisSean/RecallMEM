import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  embedWithSource: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query,
  queryOne: vi.fn(),
  getUserId: vi.fn().mockResolvedValue("test-user"),
  toVectorString: (embedding: number[]) => `[${embedding.join(",")}]`,
  getPool: () => ({
    connect: vi.fn().mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release,
    }),
  }),
}));

vi.mock("@/lib/embeddings", () => ({
  embedWithSource: mocks.embedWithSource,
  getEmbeddingSource: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  chat: vi.fn(),
  FAST_MODEL: "test-fast-model",
}));

import { storeFactProposals } from "@/lib/facts";

describe("storeFactProposals", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.clientQuery.mockReset();
    mocks.release.mockReset();
    mocks.embedWithSource.mockReset();
    mocks.query.mockResolvedValue([]);
    mocks.embedWithSource.mockRejectedValue(new Error("embeddings offline"));
  });

  it("keeps sensitive claims pending and activates lower-risk claims", async () => {
    const ids = [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ];
    let inserted = 0;
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO s2m_user_facts")) {
        return { rows: [{ id: ids[inserted++] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await storeFactProposals(
      [
        {
          text: "User's name is Test Person.",
          supportingQuote: "My name is Test Person.",
        },
        {
          text: "User is building a test project.",
          supportingQuote: "I am building a test project.",
        },
      ],
      "33333333-3333-3333-3333-333333333333"
    );

    expect(result).toEqual({ inserted: 2, active: 1, pending: 1 });
    const inserts = mocks.clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO s2m_user_facts")
    );
    expect(inserts[0][1]).toEqual([
      "test-user",
      "User's name is Test Person.",
      "identity",
      "33333333-3333-3333-3333-333333333333",
      false,
      "My name is Test Person.",
      null,
      "pending",
      false,
      null,
      "Sensitive memory requires your confirmation.",
      null,
    ]);
    expect(inserts[1][1][7]).toBe("active");
    expect(inserts[1][1][8]).toBe(true);
    expect(inserts[1][1][9]).toBe("policy");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("stores replacement links without retiring the active claim", async () => {
    const oldId = "11111111-1111-1111-1111-111111111111";
    const replacementId = "22222222-2222-2222-2222-222222222222";
    mocks.query.mockResolvedValue([{ fact_text: "User works at Acme." }]);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO s2m_user_facts")) {
        return { rows: [{ id: replacementId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await storeFactProposals(
      [
        {
          text: "User left Acme in 2026.",
          supportingQuote: "I left Acme in 2026.",
          supersedes: [oldId],
        },
      ],
      "33333333-3333-3333-3333-333333333333"
    );

    expect(result).toEqual({ inserted: 1, active: 0, pending: 1 });
    const proposal = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO s2m_fact_supersession_proposals")
    );
    expect(proposal?.[1]).toEqual([replacementId, "test-user", [oldId]]);
    expect(
      mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE s2m_user_facts"))
    ).toBe(false);
  });
});

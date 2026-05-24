import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  storeFacts: vi.fn(),
  recategorizeAllFacts: vi.fn(),
  rebuildProfile: vi.fn(),
  embedAndStoreChunks: vi.fn(),
  getUserId: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@/lib/facts", () => ({
  storeFacts: mocks.storeFacts,
  recategorizeAllFacts: mocks.recategorizeAllFacts,
}));

vi.mock("@/lib/profile", () => ({
  rebuildProfile: mocks.rebuildProfile,
}));

vi.mock("@/lib/chunks", () => ({
  embedAndStoreChunks: mocks.embedAndStoreChunks,
}));

vi.mock("@/lib/db", () => ({
  getUserId: mocks.getUserId,
  query: mocks.query,
}));

import { POST } from "@/app/api/memory/ingest/route";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/memory/ingest", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as NextRequest;
}

describe("memory ingest route", () => {
  beforeEach(() => {
    mocks.storeFacts.mockReset();
    mocks.recategorizeAllFacts.mockReset();
    mocks.rebuildProfile.mockReset();
    mocks.embedAndStoreChunks.mockReset();
    mocks.getUserId.mockReset();
    mocks.query.mockReset();

    mocks.storeFacts.mockResolvedValue(0);
    mocks.recategorizeAllFacts.mockResolvedValue(0);
    mocks.rebuildProfile.mockResolvedValue(undefined);
    mocks.embedAndStoreChunks.mockResolvedValue(1);
    mocks.getUserId.mockResolvedValue("local-user");
    mocks.query.mockResolvedValue([]);
  });

  it("requires a non-empty facts array", async () => {
    const res = await POST(request({ facts: [] }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "facts array required" });
  });

  it("stores external facts without a fake source chat id", async () => {
    mocks.storeFacts.mockResolvedValue(0);

    const res = await POST(request({ facts: ["User works on RecallMEM."], source: "notion" }));

    expect(res.status).toBe(200);
    expect(mocks.storeFacts).toHaveBeenCalledWith(["User works on RecallMEM."], null);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.embedAndStoreChunks).not.toHaveBeenCalled();
  });

  it("upserts a real deterministic chat row before embedding external chunks", async () => {
    mocks.storeFacts.mockResolvedValue(2);

    const res = await POST(
      request({
        facts: ["User works on RecallMEM.", "User wants receipts."],
        source: "notion",
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(String(sql)).toContain("INSERT INTO s2m_chats");
    expect(String(sql)).toContain("ON CONFLICT");
    expect(params[1]).toBe("local-user");
    expect(params[2]).toBe("External memory: notion");
    expect(params[3]).toBe("User works on RecallMEM.\n\nUser wants receipts.");
    expect(params[4]).toBe(2);

    const externalChatId = params[0];
    expect(typeof externalChatId).toBe("string");
    expect(externalChatId).not.toBe("notion");
    expect(externalChatId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(mocks.embedAndStoreChunks).toHaveBeenCalledWith(
      externalChatId,
      "User works on RecallMEM.\n\nUser wants receipts."
    );
  });
});

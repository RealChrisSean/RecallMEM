import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createChat: vi.fn(),
  getChat: vi.fn(),
  updateChat: vi.fn(),
  extractFactsLive: vi.fn(),
  generateTitleIfMissing: vi.fn(),
}));

vi.mock("@/lib/chats", () => ({
  createChat: mocks.createChat,
  getChat: mocks.getChat,
  updateChat: mocks.updateChat,
}));

vi.mock("@/lib/post-chat", () => ({
  extractFactsLive: mocks.extractFactsLive,
  generateTitleIfMissing: mocks.generateTitleIfMissing,
}));

import { POST } from "@/app/api/voice-agent/save/route";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/voice-agent/save", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as NextRequest;
}

describe("voice-agent save route", () => {
  beforeEach(() => {
    mocks.createChat.mockReset();
    mocks.getChat.mockReset();
    mocks.updateChat.mockReset();
    mocks.extractFactsLive.mockReset();
    mocks.generateTitleIfMissing.mockReset();

    mocks.createChat.mockResolvedValue("new-chat");
    mocks.getChat.mockResolvedValue({ id: "chat-1" });
    mocks.updateChat.mockResolvedValue(undefined);
    mocks.extractFactsLive.mockResolvedValue(undefined);
    mocks.generateTitleIfMissing.mockResolvedValue(undefined);
  });

  it("saves voice turns with the selected provider and model", async () => {
    const res = await POST(
      request({
        chatId: "chat-1",
        providerId: "provider-anthropic",
        model: "claude-opus-4-7",
        messages: [
          { role: "user", content: "Hey" },
          { role: "assistant", content: "Hey, I'm here." },
        ],
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.updateChat).toHaveBeenCalledWith(
      "chat-1",
      [
        { role: "user", content: "Hey" },
        { role: "assistant", content: "Hey, I'm here." },
      ],
      {
        providerId: "provider-anthropic",
        model: "claude-opus-4-7",
      }
    );
  });

  it("creates a chat when the supplied chat id no longer exists", async () => {
    mocks.getChat.mockResolvedValue(null);

    const res = await POST(
      request({
        chatId: "missing-chat",
        providerId: "provider-openai",
        model: "gpt-5.5",
        messages: [{ role: "user", content: "New voice chat" }],
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, chatId: "new-chat" });
    expect(mocks.createChat).toHaveBeenCalledWith("standard");
    expect(mocks.updateChat).toHaveBeenCalledWith(
      "new-chat",
      [{ role: "user", content: "New voice chat" }],
      {
        providerId: "provider-openai",
        model: "gpt-5.5",
      }
    );
  });
});

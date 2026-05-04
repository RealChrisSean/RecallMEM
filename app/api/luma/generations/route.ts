import { NextRequest } from "next/server";
import { createChat, getChat, updateChat } from "@/lib/chats";
import {
  createLumaGeneration,
  getLumaApiKey,
  insertLumaGeneration,
  lumaAssistantContent,
  lumaErrorPayload,
  lumaRowToGeneratedImage,
  normalizeLumaCreateInput,
} from "@/lib/luma";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      chatId?: string | null;
      messages?: Message[];
      aspectRatio?: string | null;
      aspect_ratio?: string | null;
      style?: string;
      outputFormat?: string | null;
      output_format?: string | null;
      webSearch?: boolean;
      web_search?: boolean;
      source?: unknown;
      imageRef?: unknown;
      image_ref?: unknown;
    };

    const apiKey = await getLumaApiKey();
    if (!apiKey) {
      return json({ error: "Add a Luma API key in Settings before generating images." }, 400);
    }

    const request = normalizeLumaCreateInput(body);

    let chatId = body.chatId || null;
    if (chatId) {
      const existing = await getChat(chatId);
      if (!existing) chatId = null;
    }
    if (!chatId) {
      chatId = await createChat("standard");
    }

    const remote = await createLumaGeneration(apiKey, request);
    const row = await insertLumaGeneration({
      chatId,
      request,
      generation: remote.generation,
      meta: remote.meta,
    });
    const image = lumaRowToGeneratedImage(row);
    const assistantMessage: Message = {
      role: "assistant",
      content: lumaAssistantContent(image),
      generatedImage: image,
    };

    if (Array.isArray(body.messages)) {
      await updateChat(chatId, [...body.messages, assistantMessage], {
        model: "uni-1",
        providerId: null,
      });
    }

    return json({ chatId, image, assistantMessage });
  } catch (err) {
    const payload = lumaErrorPayload(err);
    return json(payload, payload.status || 500);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

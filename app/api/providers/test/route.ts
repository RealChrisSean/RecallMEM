import { NextRequest } from "next/server";
import { testProvider } from "@/lib/llm";
import type { ProviderType } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      type?: ProviderType;
      base_url?: string;
      api_key?: string;
      model?: string;
    };
    if (!body.type || !body.model) {
      return new Response(
        JSON.stringify({ ok: false, error: "type and model required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const result = await testProvider({
      type: body.type,
      base_url: body.base_url,
      api_key: body.api_key,
      model: body.model,
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

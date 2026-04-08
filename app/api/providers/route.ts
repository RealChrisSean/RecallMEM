import { NextRequest } from "next/server";
import {
  listProviders,
  createProvider,
  type ProviderType,
} from "@/lib/providers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await listProviders();
    // Mask the API keys in the list response — only show the last 4 chars
    return new Response(
      JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          label: r.label,
          type: r.type,
          base_url: r.base_url,
          model: r.model,
          api_key_preview: r.api_key
            ? `…${r.api_key.slice(-4)}`
            : null,
          created_at: r.created_at,
        }))
      ),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      label?: string;
      type?: ProviderType;
      base_url?: string;
      api_key?: string;
      model?: string;
    };
    if (!body.label || !body.type || !body.model) {
      return new Response(
        JSON.stringify({ error: "label, type, model required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const id = await createProvider({
      label: body.label,
      type: body.type,
      base_url: body.base_url,
      api_key: body.api_key,
      model: body.model,
    });
    return new Response(JSON.stringify({ id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

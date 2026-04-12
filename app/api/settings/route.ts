import { NextRequest } from "next/server";
import { getSetting, setSetting, deleteSetting } from "@/lib/settings";

export const runtime = "nodejs";

// Allowlist of settings keys we expose via the API. Prevents random keys
// from being written through the public route.
const ALLOWED_KEYS = new Set(["brave_search_api_key", "tts_provider", "tts_voice", "stt_provider", "deepgram_api_key", "voice_chat_mode"]);

// GET /api/settings?key=brave_search_api_key
// Returns { configured: boolean } - we never echo the value back so a
// stolen browser tab can't read existing keys.
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key || !ALLOWED_KEYS.has(key)) {
      return json({ error: "invalid key" }, 400);
    }
    const value = await getSetting(key);
    return json({ configured: !!value });
  } catch (err) {
    return json({ error: errMsg(err) }, 500);
  }
}

// PUT /api/settings  body: { key, value }
// Empty value deletes the setting.
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; value?: string };
    if (!body.key || !ALLOWED_KEYS.has(body.key)) {
      return json({ error: "invalid key" }, 400);
    }
    if (typeof body.value !== "string") {
      return json({ error: "value required" }, 400);
    }
    if (body.value.trim() === "") {
      await deleteSetting(body.key);
    } else {
      await setSetting(body.key, body.value.trim());
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: errMsg(err) }, 500);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * GET /api/stt/config — returns STT provider config for the client.
 * If Deepgram is configured, returns the key for direct WebSocket streaming.
 * For a local app this is fine — the key stays on the user's machine.
 */
export async function GET() {
  const sttProvider = await getSetting("stt_provider");
  const deepgramKey = await getSetting("deepgram_api_key");

  if (sttProvider === "deepgram" && deepgramKey) {
    return Response.json({
      provider: "deepgram",
      key: deepgramKey,
    });
  }

  return Response.json({ provider: "whisper" });
}

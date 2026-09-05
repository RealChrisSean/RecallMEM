import { getDeepgramVoiceThinkModels } from "@/lib/deepgram-voice-models";

export const runtime = "nodejs";

export async function GET() {
  const result = await getDeepgramVoiceThinkModels();
  return Response.json(result, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}

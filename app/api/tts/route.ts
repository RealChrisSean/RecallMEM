import { NextRequest } from "next/server";
import { listProviders } from "@/lib/providers";
import { getSetting } from "@/lib/settings";
import { logUsage } from "@/lib/usage";

export const runtime = "nodejs";

const VOICES: Record<string, string[]> = {
  xai: ["eve", "ara", "rex", "sal", "leo"],
  openai: ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"],
  deepgram: [
    "aura-2-andromeda-en", "aura-2-aurora-en", "aura-2-callista-en",
    "aura-2-clio-en", "aura-2-draco-en", "aura-2-electra-en",
    "aura-2-harmonia-en", "aura-2-helios-en", "aura-2-janus-en",
    "aura-2-luna-en", "aura-2-orion-en", "aura-2-pandora-en",
    "aura-2-selene-en", "aura-2-thalia-en", "aura-2-titan-en",
    "aura-2-zeus-en",
  ],
};

/**
 * GET /api/tts — returns available TTS providers + current settings
 */
export async function GET() {
  const [providers, xaiVoiceKey, deepgramKey, ttsProvider, ttsVoice, sttProvider, voiceChatMode] = await Promise.all([
    listProviders(),
    getSetting("xai_voice_api_key"),
    getSetting("deepgram_api_key"),
    getSetting("tts_provider"),
    getSetting("tts_voice"),
    getSetting("stt_provider"),
    getSetting("voice_chat_mode"),
  ]);
  const hasOpenAI = providers.some((p) => p.type === "openai" && p.api_key);
  const hasXAI = providers.some((p) => p.type === "openai-compatible" && p.api_key && p.base_url?.includes("x.ai"));
  const hasXAIVoice = hasXAI || !!xaiVoiceKey;
  const hasDeepgram = !!deepgramKey;

  return Response.json({
    available: { xai: hasXAIVoice, openai: hasOpenAI, deepgram: hasDeepgram, browser: true },
    voices: VOICES,
    settings: {
      provider: ttsProvider || (hasXAI ? "xai" : hasOpenAI ? "openai" : "browser"),
      voice: ttsVoice || null,
      sttProvider: sttProvider || (hasDeepgram ? "deepgram" : "whisper"),
      voiceChatMode: voiceChatMode || "separate",
    },
  });
}

/**
 * POST /api/tts — generate speech from text
 */
export async function POST(req: NextRequest) {
  const { text } = (await req.json()) as { text: string };
  if (!text) return Response.json({ error: "text required" }, { status: 400 });

  // Parallel DB lookups -- cuts ~40ms off cold start
  const [providers, ttsProvider, ttsVoice, deepgramKey, xaiVoiceKeySetting] = await Promise.all([
    listProviders(),
    getSetting("tts_provider"),
    getSetting("tts_voice"),
    getSetting("deepgram_api_key"),
    getSetting("xai_voice_api_key"),
  ]);

  const xai = providers.find((p) => p.type === "openai-compatible" && p.api_key && p.base_url?.includes("x.ai"));
  const openai = providers.find((p) => p.type === "openai" && p.api_key);
  const xaiVoiceKey = xaiVoiceKeySetting || xai?.api_key;

  // Determine which provider to use (setting > auto-detect by cost)
  const provider = ttsProvider || (hasKey(xai) ? "xai" : hasKey(openai) ? "openai" : deepgramKey ? "deepgram" : "browser");

  const charCount = text.length;

  // --- Deepgram ---
  if (provider === "deepgram" && deepgramKey) {
    const voice = ttsVoice || "aura-2-aurora-en";
    const inputText = text.slice(0, 10000);
    const res = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}&encoding=mp3`, {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: inputText }),
    });

    if (res.ok) {
      logUsage({ provider: "deepgram", service: "tts", model: voice, units: inputText.length, unitType: "characters" });
      return new Response(res.body, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-cache" },
      });
    }
    console.error("[tts] Deepgram error:", res.status, await res.text());
  }

  // --- xAI Grok ---
  // xAI TTS uses /v1/tts with { text, voice, language }, NOT /v1/audio/speech
  // Voice names are capitalized: Eve, Ara, Rex, Sal, Leo
  const XAI_VOICES = ["eve", "ara", "rex", "sal", "leo"];
  if ((provider === "xai" || provider === "deepgram") && xaiVoiceKey) {
    const rawVoice = ttsVoice || "eve";
    const voice = XAI_VOICES.includes(rawVoice.toLowerCase())
      ? rawVoice.charAt(0).toUpperCase() + rawVoice.slice(1).toLowerCase()
      : "Eve";
    const inputText = text.slice(0, 15000);
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${xaiVoiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: inputText,
        voice,
        language: "en",
      }),
    });

    if (res.ok) {
      logUsage({ provider: "xai", service: "tts", model: "grok-2-tts", units: inputText.length, unitType: "characters" });
      return new Response(res.body, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-cache" },
      });
    }
    console.error("[tts] xAI error:", res.status, await res.text());
  }

  // --- OpenAI ---
  const OPENAI_VOICES = ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];
  if ((provider === "openai" || provider === "xai" || provider === "deepgram") && hasKey(openai)) {
    // Use the selected voice only if it's valid for OpenAI, otherwise default to "ash"
    const voice = (ttsVoice && OPENAI_VOICES.includes(ttsVoice)) ? ttsVoice : "ash";
    const inputText = text.slice(0, 4096);
    const baseUrl = openai!.base_url || "https://api.openai.com";
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openai!.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1-hd",
        input: inputText,
        voice: voice,
        response_format: "mp3",
      }),
    });

    if (res.ok) {
      logUsage({ provider: "openai", service: "tts", model: "tts-1-hd", units: inputText.length, unitType: "characters" });
      return new Response(res.body, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-cache" },
      });
    }
    console.error("[tts] OpenAI error:", res.status, await res.text());
  }

  // No cloud TTS available
  return Response.json({ available: false }, { status: 404 });
}

function hasKey(p: { api_key: string | null } | undefined | null): boolean {
  return !!p?.api_key;
}

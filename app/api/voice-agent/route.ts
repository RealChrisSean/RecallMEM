import { NextRequest } from "next/server";
import { getSetting } from "@/lib/settings";
import { getProfile } from "@/lib/profile";
import { getPinnedFacts, getActiveFacts } from "@/lib/facts";
import { getRules } from "@/lib/rules";
import { getProvider } from "@/lib/providers";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";

const MAX_PROFILE_CHARS = 4000;
const MAX_FACTS = 40;
const MAX_HISTORY_MESSAGES = 12;
const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const DEFAULT_VOICE_AGENT_VOICE = "aura-2-amalthea-en";
const DEFAULT_VOICE_AGENT_SPEED = 1.0;

const VOICE_AGENT_STYLE_INSTRUCTIONS: Record<string, string> = {
  natural:
    "Speaking style: natural, warm, and conversational. Sound like a helpful person, not an announcer.",
  concise:
    "Speaking style: concise and fast-moving. Keep most replies to one short sentence unless the user asks for detail.",
  coach:
    "Speaking style: encouraging coach. Be direct, practical, and supportive without becoming cheesy.",
  storytelling:
    "Speaking style: storytelling. Use vivid but compact language, natural pauses, and a little narrative shape when explaining ideas.",
  calm:
    "Speaking style: calm and grounded. Use slower pacing, reassuring phrasing, and short responses.",
  energetic:
    "Speaking style: upbeat and energetic. Keep the tempo lively while staying useful and not overwhelming.",
};

class DeepgramGrantError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "DeepgramGrantError";
  }
}

class VoiceAgentConfigError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "VoiceAgentConfigError";
  }
}

interface VoiceAgentRequest {
  chatId?: string | null;
  messages?: Message[];
  privateMode?: boolean;
  providerId?: string | null;
  model?: string | null;
}

type DeepgramThinkProvider =
  | { type: "open_ai"; model: string }
  | { type: "anthropic"; model: string }
  | { type: "google"; model: string }
  | { type: "groq"; model: string }
  | { type: "cerebras"; model: string };

interface VoiceThinkSelection {
  provider: DeepgramThinkProvider;
  providerId: string;
  model: string;
  label: string;
}

async function grantDeepgramToken(apiKey: string) {
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 300 }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new DeepgramGrantError(
      res.status,
      `Deepgram token grant failed (${res.status})${detail ? `: ${detail}` : ""}`
    );
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new Error("Deepgram token grant response did not include access_token");
  }
  return body;
}

async function getDeepgramBrowserCredential(apiKey: string) {
  try {
    const token = await grantDeepgramToken(apiKey);
    return {
      token: token.access_token,
      expiresIn: token.expires_in ?? 300,
      authProtocol: "bearer" as const,
      temporary: true,
    };
  } catch (err) {
    // Some Deepgram keys are allowed to use Voice/STT/TTS but not the auth
    // grant endpoint. The existing STT path already uses browser subprotocol
    // auth with the key directly, so fall back to that only for permission
    // errors instead of making Voice Agent unusable.
    if (err instanceof DeepgramGrantError && err.status === 403) {
      return {
        token: apiKey,
        expiresIn: null,
        authProtocol: "token" as const,
        temporary: false,
      };
    }
    throw err;
  }
}

function recentHistory(messages: Message[] | undefined) {
  return (messages || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content?.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      type: "History",
      role: m.role,
      content: m.content.slice(0, 4000),
    }));
}

function resolveVoiceAgentStyle(style: string | null) {
  return VOICE_AGENT_STYLE_INSTRUCTIONS[style || ""] || VOICE_AGENT_STYLE_INSTRUCTIONS.natural;
}

function normalizeVoiceAgentStyle(style: string | null) {
  return VOICE_AGENT_STYLE_INSTRUCTIONS[style || ""] ? style || "natural" : "natural";
}

function normalizeVoiceAgentVoice(voice: string | null) {
  const value = (voice || "").trim();
  if (!value) return DEFAULT_VOICE_AGENT_VOICE;
  if (!/^aura-2-[a-z0-9-]+$/.test(value)) return DEFAULT_VOICE_AGENT_VOICE;
  return value;
}

function normalizeVoiceAgentSpeed(speed: string | null) {
  const numeric = Number(speed);
  if (!Number.isFinite(numeric)) return DEFAULT_VOICE_AGENT_SPEED;
  return Math.min(1.5, Math.max(0.7, numeric));
}

async function buildVoicePrompt(privateMode: boolean, styleInstruction: string) {
  const customRules = await getRules();
  const now = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());

  if (privateMode) {
    return `You are RecallMEM in a live voice conversation. Keep replies short, warm, and natural.

Current time: ${now}

${styleInstruction}

Private mode is ON. Do not use stored memory, profile facts, or past conversations. Only use the current voice session and the custom rules below.

${customRules ? `<custom_rules>\n${customRules.slice(0, 2000)}\n</custom_rules>\n` : ""}

Speak like a real person. No markdown, no bullet points, no numbered lists.`;
  }

  const [profileRow, pinnedFacts, recentFacts] = await Promise.all([
    getProfile(),
    getPinnedFacts(20),
    getActiveFacts(MAX_FACTS),
  ]);

  const seen = new Set<string>();
  const facts: { text: string; date: string }[] = [];
  for (const f of pinnedFacts) {
    if (!seen.has(f.id) && facts.length < MAX_FACTS) {
      seen.add(f.id);
      facts.push({
        text: f.fact_text,
        date: (f.valid_from || f.created_at).toISOString().slice(0, 10),
      });
    }
  }
  for (const f of recentFacts) {
    if (!seen.has(f.id) && facts.length < MAX_FACTS) {
      seen.add(f.id);
      facts.push({
        text: f.fact_text,
        date: (f.valid_from || f.created_at).toISOString().slice(0, 10),
      });
    }
  }

  const profile = profileRow?.profile_summary
    ? profileRow.profile_summary.slice(0, MAX_PROFILE_CHARS)
    : null;

  return `You are RecallMEM, the user's personal AI with persistent memory, in a live voice conversation. Be concise, direct, warm, and conversational. This is spoken audio, so avoid markdown, bullets, numbered lists, tables, and long monologues.

Current time: ${now}

${styleInstruction}

${customRules ? `<custom_rules>\n${customRules.slice(0, 2000)}\n</custom_rules>\n` : ""}
${profile ? `<user_profile>\n${profile}\n</user_profile>` : "This is a new user. Learn about them naturally as you talk."}

${facts.length > 0 ? `<important_memory>\n${facts.map((f) => `[${f.date}] ${f.text}`).join("\n")}\n</important_memory>` : ""}

You also have a search_memory tool backed by RecallMEM's Postgres/pgvector database. For any substantive user turn, call search_memory with the user's latest request before answering so you can retrieve relevant facts and past conversation context. You may skip it only for tiny social turns like greetings, thanks, or "can you hear me?"

Never pretend to remember something that is not in the provided profile, facts, current conversation, or search_memory results. If memory is missing, ask a quick clarifying question.`;
}

function normalizeHostedModelName(model: string) {
  const trimmed = model.trim();
  const lastSegment = trimmed.split("/").pop();
  return lastSegment?.trim() || trimmed;
}

async function resolveVoiceThinkProvider(
  body: VoiceAgentRequest
): Promise<VoiceThinkSelection> {
  if (!body.providerId) {
    throw new VoiceAgentConfigError(
      "Voice Agent needs a cloud model. Local Gemma/Ollama is too slow for realtime voice, so pick a supported cloud model first."
    );
  }

  const provider = await getProvider(body.providerId);
  if (!provider) {
    throw new VoiceAgentConfigError(
      "The selected voice model provider was not found. Pick a cloud model again."
    );
  }

  if (provider.type === "ollama") {
    throw new VoiceAgentConfigError(
      "Voice Agent does not run with local Gemma/Ollama yet. It is too slow for realtime voice, so pick a supported cloud model first."
    );
  }

  const model = (body.model || provider.model || "").trim();
  if (!model) {
    throw new VoiceAgentConfigError("The selected voice model is missing.");
  }
  const normalizedModel = normalizeHostedModelName(model);
  const modelKey = normalizedModel.toLowerCase();
  const providerKey = `${provider.label} ${provider.base_url || ""} ${provider.model}`.toLowerCase();

  if (modelKey.startsWith("gemma")) {
    throw new VoiceAgentConfigError(
      "Voice Agent does not run with Gemma yet. Gemma is too slow for realtime voice, so pick a faster cloud voice model first."
    );
  }

  if (provider.type === "openai") {
    return {
      provider: { type: "open_ai", model: normalizedModel },
      providerId: provider.id,
      model: normalizedModel,
      label: `${normalizedModel} via OpenAI`,
    };
  }

  if (provider.type === "anthropic") {
    return {
      provider: { type: "anthropic", model: normalizedModel },
      providerId: provider.id,
      model: normalizedModel,
      label: `${normalizedModel} via Anthropic`,
    };
  }

  if (provider.type === "openai-compatible") {
    if (modelKey.includes("grok") || providerKey.includes("x.ai")) {
      throw new VoiceAgentConfigError(
        "Deepgram Voice Agent does not support xAI/Grok as the realtime think model yet. Pick GPT, Claude, Gemini, Groq, or Cerebras for voice."
      );
    }

    if (modelKey.startsWith("claude-") || providerKey.includes("anthropic")) {
      return {
        provider: { type: "anthropic", model: normalizedModel },
        providerId: provider.id,
        model: normalizedModel,
        label: `${normalizedModel} via Anthropic`,
      };
    }

    if (modelKey.startsWith("gemini-") || providerKey.includes("google")) {
      return {
        provider: { type: "google", model: normalizedModel },
        providerId: provider.id,
        model: normalizedModel,
        label: `${normalizedModel} via Google`,
      };
    }

    if (modelKey.startsWith("gpt-") || /^o\d/.test(modelKey) || providerKey.includes("openai")) {
      return {
        provider: { type: "open_ai", model: normalizedModel },
        providerId: provider.id,
        model: normalizedModel,
        label: `${normalizedModel} via OpenAI`,
      };
    }

    if (providerKey.includes("groq")) {
      return {
        provider: { type: "groq", model: normalizedModel },
        providerId: provider.id,
        model: normalizedModel,
        label: `${normalizedModel} via Groq`,
      };
    }

    if (providerKey.includes("cerebras")) {
      return {
        provider: { type: "cerebras", model: normalizedModel },
        providerId: provider.id,
        model: normalizedModel,
        label: `${normalizedModel} via Cerebras`,
      };
    }
  }

  throw new VoiceAgentConfigError(
    "Deepgram Voice Agent does not know how to run this model safely yet. Pick GPT, Claude, Gemini, Groq, or Cerebras, or use chat mode for this provider."
  );
}

async function buildConfig(body: VoiceAgentRequest) {
  const deepgramKey = await getSetting("deepgram_api_key");
  if (!deepgramKey) {
    return Response.json(
      { error: "Add your Deepgram API key in Settings before starting Voice Agent." },
      { status: 404 }
    );
  }

  const privateMode = !!body.privateMode;
  const thinkSelection = await resolveVoiceThinkProvider(body);
  const [credential, voiceSetting, speedSetting, styleSetting] = await Promise.all([
    getDeepgramBrowserCredential(deepgramKey),
    getSetting("voice_agent_voice"),
    getSetting("voice_agent_speed"),
    getSetting("voice_agent_style"),
  ]);
  const voiceModel = normalizeVoiceAgentVoice(voiceSetting);
  const voiceSpeed = normalizeVoiceAgentSpeed(speedSetting);
  const voiceStyle = normalizeVoiceAgentStyle(styleSetting);
  const prompt = await buildVoicePrompt(
    privateMode,
    resolveVoiceAgentStyle(voiceStyle)
  );

  const history = recentHistory(body.messages);
  const functions = privateMode
    ? []
    : [
        {
          name: "search_memory",
          description:
            "Call this to retrieve relevant RecallMEM profile facts, memories, and past conversation excerpts for the user's latest request before answering.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The user's latest request or a short semantic search query.",
              },
            },
            required: ["query"],
          },
        },
      ];

  const settings = {
    type: "Settings",
    tags: ["recallmem", "voice_agent"],
    experimental: false,
    mip_opt_out: true,
    flags: { history: true },
    audio: {
      input: {
        encoding: "linear16",
        sample_rate: 16000,
      },
      output: {
        encoding: "linear16",
        sample_rate: 24000,
        container: "none",
      },
    },
    agent: {
      ...(history.length > 0 ? { context: { messages: history } } : {}),
      listen: {
        provider: {
          type: "deepgram",
          model: "nova-3",
          smart_format: true,
        },
      },
      think: {
        provider: thinkSelection.provider,
        prompt,
        ...(functions.length > 0 ? { functions } : {}),
      },
      speak: {
        provider: {
          type: "deepgram",
          model: voiceModel,
          speed: voiceSpeed,
        },
      },
      greeting: "Hey, I'm here. What's up?",
    },
  };

  return Response.json(
    {
      endpoint: DEEPGRAM_AGENT_URL,
      token: credential.token,
      authProtocol: credential.authProtocol,
      expiresIn: credential.expiresIn,
      temporaryToken: credential.temporary,
      thinkModel: thinkSelection.model,
      thinkProviderId: thinkSelection.providerId,
      thinkModelLabel: thinkSelection.label,
      voiceModel,
      voiceSpeed,
      voiceStyle,
      settings,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * POST /api/voice-agent
 *
 * Returns a temporary Deepgram token plus the Voice Agent settings payload.
 * The permanent Deepgram API key stays server-side.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as VoiceAgentRequest;
    return await buildConfig(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof VoiceAgentConfigError ? err.status : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function GET() {
  try {
    return await buildConfig({});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof VoiceAgentConfigError ? err.status : 500;
    return Response.json({ error: message }, { status });
  }
}

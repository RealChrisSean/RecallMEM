import { NextRequest } from "next/server";
import { getSetting } from "@/lib/settings";
import { getProfile } from "@/lib/profile";
import { getPinnedFacts, getActiveFacts } from "@/lib/facts";
import { getRules } from "@/lib/rules";
import { getProvider } from "@/lib/providers";
import type { Message } from "@/lib/types";
import {
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
} from "@/lib/voice-audio";

export const runtime = "nodejs";

const MAX_PROFILE_CHARS = 1800;
const MAX_FACTS = 20;
const MAX_PINNED_FACTS = 10;
const MAX_FACT_CHARS = 280;
const MAX_HISTORY_MESSAGES = 4;
const MAX_HISTORY_CHARS = 700;
const MAX_CUSTOM_RULES_CHARS = 1200;
const MAX_PRONUNCIATION_CHARS = 800;
const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const VOICE_AGENT_LISTEN_MODEL = "flux-general-en";
const VOICE_AGENT_LISTEN_MODEL_LABEL = "Flux";
const VOICE_AGENT_LISTEN_PROVIDER_VERSION = "v2";
const DEFAULT_VOICE_AGENT_VOICE = "aura-2-amalthea-en";
const VOICE_AGENT_FALLBACK_VOICE = "aura-2-thalia-en";
const DEFAULT_VOICE_AGENT_SPEED = 1.0;
const FALLBACK_OPENAI_THINK_PROVIDER = {
  type: "open_ai",
  model: "gpt-5.4-mini",
} as const;
const FALLBACK_ANTHROPIC_THINK_PROVIDER = {
  type: "anthropic",
  model: "claude-4-5-haiku-latest",
} as const;

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

const DEFAULT_PRONUNCIATION_GUIDANCE = [
  "Say RecallMEM as \"recall mem\".",
  "Say pgvector as \"pee gee vector\".",
  "Say Fly.io as \"fly eye oh\".",
  "Say GPT-5.5 as \"GPT five point five\" and similar model names naturally.",
  "For exact model IDs, project names, API names, and user names, preserve the wording but speak it naturally instead of reading punctuation awkwardly.",
].join(" ");

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
  fallbackProviders: DeepgramThinkProvider[];
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

function truncateText(text: string, maxChars: number) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function compactVoiceText(text: string, maxChars: number) {
  return truncateText(text.replace(/\s+/g, " "), maxChars);
}

function recentHistory(messages: Message[] | undefined) {
  return (messages || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content?.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      type: "History",
      role: m.role,
      // Realtime voice should start fast. Older detail can come from search_memory.
      content: compactVoiceText(m.content, MAX_HISTORY_CHARS),
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
  if (!speed) return DEFAULT_VOICE_AGENT_SPEED;
  const numeric = Number(speed);
  if (!Number.isFinite(numeric)) return DEFAULT_VOICE_AGENT_SPEED;
  return Math.min(1.5, Math.max(0.7, numeric));
}

function buildPronunciationGuidance(customNotes: string | null) {
  const notes = truncateText((customNotes || "").trim(), MAX_PRONUNCIATION_CHARS);
  return notes
    ? `${DEFAULT_PRONUNCIATION_GUIDANCE}\n\nUser pronunciation notes:\n${notes}`
    : DEFAULT_PRONUNCIATION_GUIDANCE;
}

function uniqueThinkProviders(providers: DeepgramThinkProvider[]) {
  const seen = new Set<string>();
  return providers.filter((provider) => {
    const key = `${provider.type}:${provider.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fallbackThinkProviders(primary: DeepgramThinkProvider) {
  const preferred =
    primary.type === "anthropic"
      ? [FALLBACK_ANTHROPIC_THINK_PROVIDER, FALLBACK_OPENAI_THINK_PROVIDER]
      : [FALLBACK_OPENAI_THINK_PROVIDER, FALLBACK_ANTHROPIC_THINK_PROVIDER];
  return uniqueThinkProviders([primary, ...preferred]).slice(1);
}

function makeVoiceThinkSelection(
  provider: DeepgramThinkProvider,
  providerId: string,
  model: string,
  label: string
): VoiceThinkSelection {
  return {
    provider,
    fallbackProviders: fallbackThinkProviders(provider),
    providerId,
    model,
    label,
  };
}

function buildThinkChain(
  selection: VoiceThinkSelection,
  prompt: string,
  functions: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
  }[]
) {
  return [selection.provider, ...selection.fallbackProviders].map((provider) => ({
    provider,
    prompt,
    ...(functions.length > 0 ? { functions } : {}),
  }));
}

function buildSpeakChain(voiceModel: string, voiceSpeed: number) {
  const primary = {
    provider: {
      type: "deepgram" as const,
      model: voiceModel,
      speed: voiceSpeed,
    },
  };
  const fallback = {
    provider: {
      type: "deepgram" as const,
      model:
        voiceModel === VOICE_AGENT_FALLBACK_VOICE
          ? DEFAULT_VOICE_AGENT_VOICE
          : VOICE_AGENT_FALLBACK_VOICE,
    },
  };
  return [primary, fallback];
}

async function buildVoicePrompt(
  privateMode: boolean,
  styleInstruction: string,
  pronunciationGuidance: string
) {
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

Pronunciation guidance: ${pronunciationGuidance}

Private mode is ON. Do not use stored memory, profile facts, or past conversations. Only use the current voice session and the custom rules below.

${customRules ? `<custom_rules>\n${truncateText(customRules, MAX_CUSTOM_RULES_CHARS)}\n</custom_rules>\n` : ""}

Speak like a real person. No markdown, no bullet points, no numbered lists.`;
  }

  const [profileRow, pinnedFacts, recentFacts] = await Promise.all([
    getProfile(),
    getPinnedFacts(MAX_PINNED_FACTS),
    getActiveFacts(MAX_FACTS),
  ]);

  const seen = new Set<string>();
  const facts: { text: string; date: string }[] = [];
  for (const f of pinnedFacts) {
    if (!seen.has(f.id) && facts.length < MAX_FACTS) {
      seen.add(f.id);
      facts.push({
        text: compactVoiceText(f.fact_text, MAX_FACT_CHARS),
        date: (f.valid_from || f.created_at).toISOString().slice(0, 10),
      });
    }
  }
  for (const f of recentFacts) {
    if (!seen.has(f.id) && facts.length < MAX_FACTS) {
      seen.add(f.id);
      facts.push({
        text: compactVoiceText(f.fact_text, MAX_FACT_CHARS),
        date: (f.valid_from || f.created_at).toISOString().slice(0, 10),
      });
    }
  }

  const profile = profileRow?.profile_summary
    ? compactVoiceText(profileRow.profile_summary, MAX_PROFILE_CHARS)
    : null;

  return `You are RecallMEM, the user's personal AI with persistent memory, in a live voice conversation. Be concise, direct, warm, and conversational. This is spoken audio, so avoid markdown, bullets, numbered lists, tables, and long monologues.

Current time: ${now}

${styleInstruction}

Pronunciation guidance: ${pronunciationGuidance}

${customRules ? `<custom_rules>\n${truncateText(customRules, MAX_CUSTOM_RULES_CHARS)}\n</custom_rules>\n` : ""}
${profile ? `<user_profile>\n${profile}\n</user_profile>` : "This is a new user. Learn about them naturally as you talk."}

${facts.length > 0 ? `<important_memory>\n${facts.map((f) => `[${f.date}] ${f.text}`).join("\n")}\n</important_memory>` : ""}

You also have a search_memory tool backed by RecallMEM's Postgres/pgvector database. Use it when the user asks about themselves, past decisions, ongoing projects, preferences, relationships, finances, health, plans, or says something ambiguous like "that project" or "what did we decide." Skip it for greetings, quick reactions, general knowledge, and simple back-and-forth where the provided profile/facts/current conversation are enough.

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
    return makeVoiceThinkSelection(
      { type: "open_ai", model: normalizedModel },
      provider.id,
      normalizedModel,
      `${normalizedModel} via OpenAI`
    );
  }

  if (provider.type === "anthropic") {
    return makeVoiceThinkSelection(
      { type: "anthropic", model: normalizedModel },
      provider.id,
      normalizedModel,
      `${normalizedModel} via Anthropic`
    );
  }

  if (provider.type === "openai-compatible") {
    if (modelKey.includes("grok") || providerKey.includes("x.ai")) {
      throw new VoiceAgentConfigError(
        "Deepgram Voice Agent does not support xAI/Grok as the realtime think model yet. Pick GPT, Claude, Gemini, Groq, or Cerebras for voice."
      );
    }

    if (modelKey.startsWith("claude-") || providerKey.includes("anthropic")) {
      return makeVoiceThinkSelection(
        { type: "anthropic", model: normalizedModel },
        provider.id,
        normalizedModel,
        `${normalizedModel} via Anthropic`
      );
    }

    if (modelKey.startsWith("gemini-") || providerKey.includes("google")) {
      return makeVoiceThinkSelection(
        { type: "google", model: normalizedModel },
        provider.id,
        normalizedModel,
        `${normalizedModel} via Google`
      );
    }

    if (modelKey.startsWith("gpt-") || /^o\d/.test(modelKey) || providerKey.includes("openai")) {
      return makeVoiceThinkSelection(
        { type: "open_ai", model: normalizedModel },
        provider.id,
        normalizedModel,
        `${normalizedModel} via OpenAI`
      );
    }

    if (providerKey.includes("groq")) {
      return makeVoiceThinkSelection(
        { type: "groq", model: normalizedModel },
        provider.id,
        normalizedModel,
        `${normalizedModel} via Groq`
      );
    }

    if (providerKey.includes("cerebras")) {
      return makeVoiceThinkSelection(
        { type: "cerebras", model: normalizedModel },
        provider.id,
        normalizedModel,
        `${normalizedModel} via Cerebras`
      );
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
  const [credential, voiceSetting, speedSetting, styleSetting, pronunciationSetting] = await Promise.all([
    getDeepgramBrowserCredential(deepgramKey),
    getSetting("voice_agent_voice"),
    getSetting("voice_agent_speed"),
    getSetting("voice_agent_style"),
    getSetting("voice_agent_pronunciation"),
  ]);
  const voiceModel = normalizeVoiceAgentVoice(voiceSetting);
  const voiceSpeed = normalizeVoiceAgentSpeed(speedSetting);
  const voiceStyle = normalizeVoiceAgentStyle(styleSetting);
  const prompt = await buildVoicePrompt(
    privateMode,
    resolveVoiceAgentStyle(voiceStyle),
    buildPronunciationGuidance(pronunciationSetting)
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
  const thinkChain = buildThinkChain(thinkSelection, prompt, functions);
  const speakChain = buildSpeakChain(voiceModel, voiceSpeed);

  const settings = {
    type: "Settings",
    tags: ["recallmem", "voice_agent"],
    experimental: false,
    mip_opt_out: true,
    flags: { history: true },
    audio: {
      input: {
        encoding: "linear16",
        sample_rate: VOICE_INPUT_SAMPLE_RATE,
      },
      output: {
        encoding: "linear16",
        sample_rate: VOICE_OUTPUT_SAMPLE_RATE,
        container: "none",
      },
    },
    agent: {
      ...(history.length > 0 ? { context: { messages: history } } : {}),
      listen: {
        provider: {
          type: "deepgram",
          version: VOICE_AGENT_LISTEN_PROVIDER_VERSION,
          model: VOICE_AGENT_LISTEN_MODEL,
        },
      },
      think: thinkChain,
      speak: speakChain,
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
      thinkFallbackModels: thinkSelection.fallbackProviders.map(
        (provider) => `${provider.type}:${provider.model}`
      ),
      listenModel: VOICE_AGENT_LISTEN_MODEL,
      listenModelLabel: VOICE_AGENT_LISTEN_MODEL_LABEL,
      voiceModel,
      voiceFallbackModel: speakChain[1]?.provider.model || null,
      voiceSpeed,
      voiceStyle,
      voicePronunciation: pronunciationSetting || "",
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

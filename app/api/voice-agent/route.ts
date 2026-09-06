import { NextRequest } from "next/server";
import { getSetting } from "@/lib/settings";
import { getProfile } from "@/lib/profile";
import { getPinnedFacts, getActiveFacts } from "@/lib/facts";
import { getRules } from "@/lib/rules";
import { getProvider } from "@/lib/providers";
import type { Message } from "@/lib/types";
import type { ProviderModelMode } from "@/lib/llm-config";
import {
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
} from "@/lib/voice-audio";
import { getDeepgramVoiceAgentCompatibility } from "@/lib/voice-agent-models";
import { getDeepgramVoiceThinkModels } from "@/lib/deepgram-voice-models";

export const runtime = "nodejs";

const MAX_PROFILE_CHARS = 1800;
const MAX_FACTS = 20;
const MAX_PINNED_FACTS = 10;
const MAX_FACT_CHARS = 280;
const MAX_HISTORY_MESSAGES = 4;
const MAX_HISTORY_CHARS = 700;
const MAX_CUSTOM_RULES_CHARS = 1200;
const MAX_PRONUNCIATION_CHARS = 800;
const MAX_STT_KEYTERMS = 80;
const MAX_STT_KEYTERM_CHARS = 64;
const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const VOICE_AGENT_LISTEN_MODEL = "flux-general-en";
const VOICE_AGENT_LISTEN_MODEL_LABEL = "Flux";
const VOICE_AGENT_LISTEN_PROVIDER_VERSION = "v2";
const DEFAULT_VOICE_AGENT_VOICE = "aura-2-amalthea-en";
const VOICE_AGENT_FALLBACK_VOICE = "aura-2-thalia-en";
const DEFAULT_VOICE_AGENT_SPEED = 1.0;
const FALLBACK_OPENAI_THINK_PROVIDER = {
  type: "open_ai",
  model: "gpt-5.6-luna",
} as const;
const FALLBACK_ANTHROPIC_THINK_PROVIDER = {
  type: "anthropic",
  model: "claude-haiku-4-5",
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
  "Say GPT-5.6 as \"GPT five point six\" and similar model names naturally.",
  "For exact model IDs, project names, API names, and user names, preserve the wording but speak it naturally instead of reading punctuation awkwardly.",
].join(" ");

const DEFAULT_STT_KEYTERMS = [
  "RecallMEM",
  "pgvector",
  "Fly.io",
  "Deepgram",
  "Sprite",
];

const STT_KEYTERM_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
  "you",
  "your",
  "user",
  "assistant",
  "family",
  "finance",
  "health",
  "identity",
  "interests",
  "other",
  "preferences",
  "profile",
  "projects",
  "recent",
  "social",
  "current",
  "private",
  "speaking",
  "work",
]);

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
  modelMode?: ProviderModelMode | null;
  workspaceMode?: VoiceWorkspaceMode | null;
  wikiBrain?: string | null;
}

type VoiceWorkspaceMode = "chat" | "wiki" | "study";

type DeepgramThinkProvider =
  | { type: "open_ai"; model: string }
  | { type: "anthropic"; model: string }
  | { type: "google"; model: string }
  | { type: "groq"; model: string }
  | { type: "nvidia"; model: string };

interface VoiceThinkSelection {
  provider: DeepgramThinkProvider;
  fallbackProviders: DeepgramThinkProvider[];
  providerId: string;
  model: string;
  label: string;
}

interface VoicePromptContext {
  prompt: string;
  keyterms: string[];
}

function normalizeWorkspaceMode(mode: VoiceAgentRequest["workspaceMode"]): VoiceWorkspaceMode {
  return mode === "wiki" || mode === "study" ? mode : "chat";
}

function isWikiWorkspaceMode(mode: VoiceWorkspaceMode) {
  return mode === "wiki" || mode === "study";
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

function normalizeSttKeyterm(term: string) {
  const cleaned = term
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .trim();
  if (cleaned.length < 3 || cleaned.length > MAX_STT_KEYTERM_CHARS) return null;
  if (!/[A-Za-z0-9]/.test(cleaned)) return null;
  if (/^https?:\/\//i.test(cleaned) || cleaned.includes("@")) return null;
  const lower = cleaned.toLowerCase();
  if (STT_KEYTERM_STOP_WORDS.has(lower)) return null;
  if (cleaned.split(" ").length > 5) return null;
  return cleaned;
}

function addSttKeyterm(keyterms: string[], seen: Set<string>, term: string) {
  if (keyterms.length >= MAX_STT_KEYTERMS) return;
  const normalized = normalizeSttKeyterm(term);
  if (!normalized) return;
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  keyterms.push(normalized);
}

function extractSttKeytermsFromText(text: string) {
  const terms: string[] = [];
  const technicalPattern = /\b[A-Za-z][A-Za-z0-9]*(?:[._:/+#-][A-Za-z0-9]+)+\b/g;
  for (const match of text.matchAll(technicalPattern)) {
    terms.push(match[0]);
  }

  const modelPattern = /\b(?:[A-Z]{2,}[A-Za-z0-9.-]*|[A-Za-z]+-?\d[A-Za-z0-9.-]*)\b/g;
  for (const match of text.matchAll(modelPattern)) {
    terms.push(match[0]);
  }

  const titleCasePattern =
    /\b[A-Z][A-Za-z0-9]*(?:[.'-][A-Za-z0-9]+)?(?:\s+[A-Z][A-Za-z0-9]*(?:[.'-][A-Za-z0-9]+)?){0,3}\b/g;
  for (const match of text.matchAll(titleCasePattern)) {
    terms.push(match[0]);
  }

  return terms;
}

function buildSttKeyterms(sources: Array<string | null | undefined>) {
  const keyterms: string[] = [];
  const seen = new Set<string>();

  for (const term of DEFAULT_STT_KEYTERMS) {
    addSttKeyterm(keyterms, seen, term);
  }

  for (const source of sources) {
    if (!source || keyterms.length >= MAX_STT_KEYTERMS) continue;
    for (const term of extractSttKeytermsFromText(source)) {
      addSttKeyterm(keyterms, seen, term);
      if (keyterms.length >= MAX_STT_KEYTERMS) break;
    }
  }

  return keyterms;
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

async function buildVoicePromptContext(
  workspaceMode: VoiceWorkspaceMode,
  wikiBrain: string,
  privateMode: boolean,
  styleInstruction: string,
  pronunciationGuidance: string,
  keytermSources: Array<string | null | undefined>
): Promise<VoicePromptContext> {
  const now = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());

  if (isWikiWorkspaceMode(workspaceMode)) {
    const studyInstruction = workspaceMode === "study"
      ? "Study Mode is ON. After calling query_wiki, teach from the sourced answer with one short Socratic question or check-for-understanding. Do not add uncited facts."
      : "Wiki Mode is ON. Answer directly from the sourced wiki response.";
    const wikiSubject = `the selected "${wikiBrain}" wiki brain.`;

    return {
      prompt: `You are RecallMEM Wiki Voice Mode in a live voice conversation. Keep replies short, spoken, and natural.

Current time: ${now}

${styleInstruction}

Pronunciation guidance: ${pronunciationGuidance}

${studyInstruction}

The active wiki is ${wikiSubject}

You have exactly one factual tool: query_wiki. It searches the selected brain's public wiki sources only, including imported public GitHub documentation and public URLs.

Hard rule: for every user question in Wiki or Study Mode, call query_wiki before answering or asking a clarifying question. Do not answer from general knowledge first. Do not say "let me search/check the wiki"; call query_wiki silently first, then answer from the returned result.

If the user's question is short or ambiguous, rewrite it into a useful search query using the active wiki name and the user's wording. Never substitute a product or subject that the user did not name.

After query_wiki returns, use only the answer and citations returned by query_wiki. Do not use RecallMEM memory, profile facts, previous chats, custom rules, or general knowledge for factual claims.

If query_wiki says "I don't have that in this brain's sources.", say that plainly and ask what public source should be added.

When citations are returned, mention the source name briefly if useful, but do not read long URLs aloud.`,
      keyterms: buildSttKeyterms([
        ...keytermSources,
        "RecallMEM Wiki",
        wikiBrain,
        "query_wiki",
        workspaceMode === "study" ? "Study Mode" : "Wiki Mode",
      ]),
    };
  }

  const customRules = await getRules();
  if (privateMode) {
    return {
      prompt: `You are RecallMEM in a live voice conversation. Keep replies short, warm, and natural.

Current time: ${now}

${styleInstruction}

Pronunciation guidance: ${pronunciationGuidance}

Private mode is ON. Do not use stored memory, profile facts, or past conversations. Only use the current voice session and the custom rules below.

${customRules ? `<custom_rules>\n${truncateText(customRules, MAX_CUSTOM_RULES_CHARS)}\n</custom_rules>\n` : ""}

Speak like a real person. No markdown, no bullet points, no numbered lists.`,
      keyterms: buildSttKeyterms([...keytermSources, customRules]),
    };
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

  const factTexts = facts.map((fact) => fact.text);

  return {
    prompt: `You are RecallMEM, the user's personal AI with persistent memory, in a live voice conversation. Be concise, direct, warm, and conversational. This is spoken audio, so avoid markdown, bullets, numbered lists, tables, and long monologues.

Current time: ${now}

${styleInstruction}

Pronunciation guidance: ${pronunciationGuidance}

${customRules ? `<custom_rules>\n${truncateText(customRules, MAX_CUSTOM_RULES_CHARS)}\n</custom_rules>\n` : ""}
${profile ? `<user_profile>\n${profile}\n</user_profile>` : "This is a new user. Learn about them naturally as you talk."}

${facts.length > 0 ? `<important_memory>\n${facts.map((f) => `[${f.date}] ${f.text}`).join("\n")}\n</important_memory>` : ""}

You also have a search_memory tool backed by RecallMEM's Postgres/pgvector database. Use it when the user asks about themselves, past decisions, ongoing projects, preferences, relationships, finances, health, plans, or says something ambiguous like "that project" or "what did we decide." Skip it for greetings, quick reactions, general knowledge, and simple back-and-forth where the provided profile/facts/current conversation are enough.

Never pretend to remember something that is not in the provided profile, facts, current conversation, or search_memory results. If memory is missing, ask a quick clarifying question.`,
    keyterms: buildSttKeyterms([...keytermSources, customRules, profile, ...factTexts]),
  };
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
  const voiceModels = await getDeepgramVoiceThinkModels();
  const compatibility = getDeepgramVoiceAgentCompatibility({
    providerId: provider.id,
    providerType: provider.type,
    providerLabel: provider.label,
    providerBaseUrl: provider.base_url,
    providerModel: provider.model,
    selectedModel: model,
    selectedModelMode: body.modelMode,
  }, voiceModels.models);

  if (!compatibility.compatible) {
    throw new VoiceAgentConfigError(
      `${compatibility.reason} Supported voice models: ${compatibility.supportedModels.join(", ")}.`
    );
  }

  return makeVoiceThinkSelection(
    { type: compatibility.provider, model: compatibility.model },
    provider.id,
    compatibility.model,
    `${compatibility.model} via ${compatibility.providerLabel}`
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
  const workspaceMode = normalizeWorkspaceMode(body.workspaceMode);
  const wikiBrain = (body.wikiBrain || "default")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "default";
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
  const promptContext = await buildVoicePromptContext(
    workspaceMode,
    wikiBrain,
    privateMode,
    resolveVoiceAgentStyle(voiceStyle),
    buildPronunciationGuidance(pronunciationSetting),
    [
      thinkSelection.label,
      thinkSelection.model,
      voiceModel,
      pronunciationSetting,
    ]
  );

  const history = isWikiWorkspaceMode(workspaceMode) ? [] : recentHistory(body.messages);
  const functions = isWikiWorkspaceMode(workspaceMode)
    ? [
        {
          name: "query_wiki",
          description:
            "Required before every answer in Wiki or Study Mode. Search the active public wiki, then answer only from the returned source-grounded answer and citations.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The user's latest spoken question, rewritten as a concise search query for the active wiki without changing its subject.",
              },
            },
            required: ["query"],
          },
        },
      ]
    : privateMode
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
  const thinkChain = buildThinkChain(thinkSelection, promptContext.prompt, functions);
  const speakChain = buildSpeakChain(voiceModel, voiceSpeed);
  const greeting = isWikiWorkspaceMode(workspaceMode)
    ? workspaceMode === "study"
      ? "Study voice is ready. Ask me about this wiki."
      : "Wiki voice is ready. Ask me about this wiki."
    : "Hey, I'm here. What's up?";
  const listenProvider = {
    type: "deepgram",
    version: VOICE_AGENT_LISTEN_PROVIDER_VERSION,
    model: VOICE_AGENT_LISTEN_MODEL,
    ...(promptContext.keyterms.length > 0 ? { keyterms: promptContext.keyterms } : {}),
  };

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
        provider: listenProvider,
      },
      think: thinkChain,
      speak: speakChain,
      greeting,
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
      listenKeyterms: promptContext.keyterms,
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

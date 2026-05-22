import { NextRequest } from "next/server";
import { getSetting } from "@/lib/settings";
import { getProfile } from "@/lib/profile";
import { getPinnedFacts, getActiveFacts } from "@/lib/facts";
import { getRules } from "@/lib/rules";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";

const MAX_PROFILE_CHARS = 4000;
const MAX_FACTS = 40;
const MAX_HISTORY_MESSAGES = 12;
const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

class DeepgramGrantError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "DeepgramGrantError";
  }
}

interface VoiceAgentRequest {
  chatId?: string | null;
  messages?: Message[];
  privateMode?: boolean;
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

async function buildVoicePrompt(privateMode: boolean) {
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

${customRules ? `<custom_rules>\n${customRules.slice(0, 2000)}\n</custom_rules>\n` : ""}
${profile ? `<user_profile>\n${profile}\n</user_profile>` : "This is a new user. Learn about them naturally as you talk."}

${facts.length > 0 ? `<important_memory>\n${facts.map((f) => `[${f.date}] ${f.text}`).join("\n")}\n</important_memory>` : ""}

You also have a search_memory tool backed by RecallMEM's Postgres/pgvector database. For any substantive user turn, call search_memory with the user's latest request before answering so you can retrieve relevant facts and past conversation context. You may skip it only for tiny social turns like greetings, thanks, or "can you hear me?"

Never pretend to remember something that is not in the provided profile, facts, current conversation, or search_memory results. If memory is missing, ask a quick clarifying question.`;
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
  const [credential, prompt] = await Promise.all([
    getDeepgramBrowserCredential(deepgramKey),
    buildVoicePrompt(privateMode),
  ]);

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
        provider: {
          type: "open_ai",
          model: "gpt-5.5",
        },
        prompt,
        ...(functions.length > 0 ? { functions } : {}),
      },
      speak: {
        provider: {
          type: "deepgram",
          model: "aura-2-amalthea-en",
          speed: 1.0,
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
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    return await buildConfig({});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

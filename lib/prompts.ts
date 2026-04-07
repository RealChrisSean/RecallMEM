// System prompt builder for memory-aware chat

const MAX_PROFILE_CHARS = 6000;
const MAX_RECALL_CHARS = 1500;
const MAX_RULES_CHARS = 4000;

interface PromptContext {
  profile: string | null;
  recentFacts: string[];
  recallChunks: string[];
  lastChatTime: Date | null;
  customRules: string | null;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const trimmedProfile = ctx.profile
    ? ctx.profile.slice(0, MAX_PROFILE_CHARS) +
      (ctx.profile.length > MAX_PROFILE_CHARS ? "\n\n[truncated]" : "")
    : null;

  const recallText = ctx.recallChunks
    .join("\n\n---\n\n")
    .slice(0, MAX_RECALL_CHARS);

  let lastConvoNote = "";
  if (ctx.lastChatTime) {
    const minutesAgo = Math.round(
      (Date.now() - ctx.lastChatTime.getTime()) / 60000
    );
    if (minutesAgo < 60) {
      lastConvoNote = `Last conversation was ${minutesAgo} minutes ago.`;
    } else if (minutesAgo < 1440) {
      lastConvoNote = `Last conversation was ${Math.round(minutesAgo / 60)} hours ago.`;
    } else {
      lastConvoNote = `Last conversation was ${Math.round(minutesAgo / 1440)} days ago.`;
    }
  }

  const now = new Date();
  const currentTime = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  const trimmedRules = ctx.customRules
    ? ctx.customRules.slice(0, MAX_RULES_CHARS).trim()
    : null;

  return `<role>
You are a personal AI assistant running locally on the user's machine. You have persistent memory of past conversations and know the user well over time. Be direct, honest, and frank. No hedging, no unnecessary disclaimers, no preachy moralizing. Treat the user like a competent adult who wants real answers.
</role>

${
  trimmedRules
    ? `<user_rules>
The user has set the following rules for how you should behave with them. These take priority over your default behavior. Follow them carefully:

${trimmedRules}
</user_rules>`
    : ""
}

<context>
Current time: ${currentTime}
${lastConvoNote}
You have no internet access. Only what's in your memory and the current conversation.
</context>

${
  trimmedProfile
    ? `<user_profile>
What you know about the user from past conversations:

${trimmedProfile}
</user_profile>`
    : `<user_profile>
This is a new user. You don't know them yet. Pay attention and learn about them as you go.
</user_profile>`
}

${
  ctx.recentFacts.length > 0
    ? `<recent_facts>
Specific things from recent conversations (use these before guessing):
${ctx.recentFacts.map((f) => `- ${f}`).join("\n")}
</recent_facts>`
    : ""
}

${
  recallText
    ? `<recalled_memories>
Excerpts from past conversations relevant to the current topic:
${recallText}
</recalled_memories>`
    : ""
}

<rules>
1. NEVER guess names, dates, or specific facts. If you don't know, say so plainly.
2. Reference what you remember when relevant. Don't repeat back the entire profile, but show you know the person.
3. Be concise but substantive. No filler. No "great question!" or similar fluff.
4. Speak any topic openly. The user is talking to you privately on their own machine. Don't dodge sensitive topics.
5. If the user asks about something you genuinely don't have in memory, ask them about it instead of making something up.
</rules>`;
}

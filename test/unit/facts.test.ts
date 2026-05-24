import { describe, it, expect } from "vitest";
import {
  hasConcreteDate,
  hasRelativeTime,
  hasUngroundedRelativeTime,
  matchesKeyword,
  quoteAppearsInTranscript,
  validateExtractedFactCandidates,
} from "@/lib/facts";

// We can't import categorize() directly because it isn't exported, but we
// exercise it through matchesKeyword which is the underlying primitive.
// If categorize gets exported later, add direct tests.

describe("matchesKeyword (prefix word match)", () => {
  // The bug we shipped to fix: \bwork\b doesn't match "worked" or "working".
  // Prefix matching with \bwork (no trailing boundary) does.
  it("matches the exact keyword", () => {
    expect(matchesKeyword("user has a job", "job")).toBe(true);
  });

  it("matches past tense forms", () => {
    expect(matchesKeyword("user previously worked at Acme", "work")).toBe(true);
    expect(matchesKeyword("user was hired in 2024", "hire")).toBe(true);
  });

  it("matches progressive forms", () => {
    expect(matchesKeyword("user is interviewing at a startup", "interview")).toBe(true);
    expect(matchesKeyword("user is working remotely", "work")).toBe(true);
  });

  it("does not match across word boundaries (no false 'son' in 'Sonnet')", () => {
    expect(matchesKeyword("user uses Claude Sonnet", "son")).toBe(false);
  });

  it("does not match across word boundaries (no false 'work' in 'framework')", () => {
    // "framework" starts with "frame", not "work", so the prefix word match
    // (\bwork) should not hit it.
    expect(matchesKeyword("user is using a framework", "work")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(matchesKeyword("USER WORKED AT GOOGLE", "work")).toBe(true);
  });

  it("handles multi-word phrases via substring match", () => {
    expect(matchesKeyword("user's name is Chris", "name is")).toBe(true);
    // Multi-word keywords use plain includes() so an exact substring is
    // required. Already specific enough for our keyword list.
    expect(matchesKeyword("user prefers tea", "name is")).toBe(false);
  });
});

describe("FACT_CATEGORIES sanity", () => {
  it("includes the standard categories", async () => {
    const { FACT_CATEGORIES } = await import("@/lib/facts");
    expect(FACT_CATEGORIES).toContain("identity");
    expect(FACT_CATEGORIES).toContain("family");
    expect(FACT_CATEGORIES).toContain("work");
    expect(FACT_CATEGORIES).toContain("other");
  });

  it("has 'other' as the catch-all", async () => {
    const { FACT_CATEGORIES } = await import("@/lib/facts");
    expect(FACT_CATEGORIES[FACT_CATEGORIES.length - 1]).toBe("other");
  });
});

describe("evidence-backed fact extraction", () => {
  const transcript = `
user: I live in Los Angeles now.

assistant: Nice, I'll remember that.

user: I'm building RecallMEM as a local-first memory app.
`;

  it("accepts a candidate fact when its supporting quote appears in the transcript", () => {
    const facts = validateExtractedFactCandidates(
      [
        {
          text: "User said they live in Los Angeles.",
          quote: "I live in Los Angeles now.",
        },
      ],
      transcript
    );

    expect(facts).toEqual([
      {
        text: "User said they live in Los Angeles.",
        supportingQuote: "I live in Los Angeles now.",
        sourceMessageIndex: null,
      },
    ]);
  });

  it("accepts snake_case quote and camelCase source index variants", () => {
    const facts = validateExtractedFactCandidates(
      [
        {
          fact: "User is building RecallMEM as a local-first memory app.",
          supporting_quote: "I'm building RecallMEM as a local-first memory app.",
          sourceMessageIndex: 2,
        },
      ],
      transcript
    );

    expect(facts).toEqual([
      {
        text: "User is building RecallMEM as a local-first memory app.",
        supportingQuote: "I'm building RecallMEM as a local-first memory app.",
        sourceMessageIndex: 2,
      },
    ]);
  });

  it("rejects a candidate fact when the quote is not in the transcript", () => {
    const facts = validateExtractedFactCandidates(
      [
        {
          text: "User has three dogs.",
          quote: "I have three dogs.",
        },
      ],
      transcript
    );

    expect(facts).toEqual([]);
  });

  it("rejects legacy string facts because they have no evidence", () => {
    const facts = validateExtractedFactCandidates(
      ["User lives in Los Angeles."],
      transcript
    );

    expect(facts).toEqual([]);
  });

  it("matches quotes across whitespace differences", () => {
    expect(
      quoteAppearsInTranscript(
        "I'm building RecallMEM as a local-first memory app.",
        "user:\nI'm building RecallMEM as a local-first\nmemory app."
      )
    ).toBe(true);
  });

  it("matches quotes case-insensitively", () => {
    expect(
      quoteAppearsInTranscript(
        "i live in los angeles now.",
        transcript
      )
    ).toBe(true);
  });

  it("rejects very short quotes that are too easy to match accidentally", () => {
    expect(quoteAppearsInTranscript("LA", transcript)).toBe(false);
  });

  it("rejects garbage facts even when they have a real quote", () => {
    const facts = validateExtractedFactCandidates(
      [
        {
          text: "User tested the mic.",
          quote: "I live in Los Angeles now.",
        },
      ],
      transcript
    );

    expect(facts).toEqual([]);
  });
});

describe("temporal grounding for extracted facts", () => {
  const transcript = `
user: My 230k job starts in 1 month.

assistant: That's huge.
`;

  it("detects relative time phrases", () => {
    expect(hasRelativeTime("User's job starts in 1 month.")).toBe(true);
    expect(hasRelativeTime("User currently has 90k in liquidity.")).toBe(true);
    expect(hasRelativeTime("User's job starts on 2026-06-23.")).toBe(false);
  });

  it("detects concrete dates", () => {
    expect(hasConcreteDate("User said this on 2026-05-23.")).toBe(true);
    expect(hasConcreteDate("User's job starts around June 2026.")).toBe(true);
    expect(hasConcreteDate("User's job starts in 1 month.")).toBe(false);
  });

  it("flags relative time when no concrete date is present", () => {
    expect(hasUngroundedRelativeTime("User's job starts in 1 month.")).toBe(true);
    expect(
      hasUngroundedRelativeTime(
        "User said on 2026-05-23 that their job starts around 2026-06-23."
      )
    ).toBe(false);
  });

  it("allows relative time only when the fact text includes a concrete anchor", () => {
    expect(
      hasUngroundedRelativeTime("User currently has 90k in liquidity as of 2026-05-23.")
    ).toBe(false);
  });

  it("rejects candidate facts with ungrounded relative time", () => {
    const facts = validateExtractedFactCandidates(
      [
        {
          text: "User's 230k job starts in 1 month.",
          quote: "My 230k job starts in 1 month.",
        },
      ],
      transcript
    );

    expect(facts).toEqual([]);
  });

  it("accepts candidate facts that resolve relative time into concrete dates", () => {
    const facts = validateExtractedFactCandidates(
      [
        {
          text: "User said on 2026-05-23 that their 230k job starts around 2026-06-23.",
          quote: "My 230k job starts in 1 month.",
        },
      ],
      transcript
    );

    expect(facts).toEqual([
      {
        text: "User said on 2026-05-23 that their 230k job starts around 2026-06-23.",
        supportingQuote: "My 230k job starts in 1 month.",
        sourceMessageIndex: null,
      },
    ]);
  });
});

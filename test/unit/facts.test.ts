import { describe, it, expect } from "vitest";
import { matchesKeyword } from "@/lib/facts";

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

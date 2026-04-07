"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const PLACEHOLDER = `Examples of rules you might set:

- Don't gaslight me. If I'm wrong, just say so directly.
- I have dyslexia. Avoid bullet-heavy responses, prefer plain prose with one idea per paragraph.
- Don't add disclaimers like "I'm not a lawyer" or "consult a professional" unless I ask.
- When I ask for code, just give me the code. No long explanations unless I ask.
- Match my tone. If I'm casual, be casual. If I'm precise, be precise.
- Never tell me to "take a break" or "practice self-care" unless I bring it up first.
- If you don't know something, say so. Don't make things up.
- I prefer direct answers over options. Pick one and tell me why.

These rules apply to every conversation. They override the default AI behavior.`;

export default function RulesPage() {
  const [rules, setRules] = useState("");
  const [originalRules, setOriginalRules] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch("/api/rules");
      if (res.ok) {
        const data = (await res.json()) as { rules: string };
        setRules(data.rules);
        setOriginalRules(data.rules);
      }
    } catch (err) {
      console.error("Failed to load rules:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  async function save() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      if (res.ok) {
        setOriginalRules(rules);
        setSavedAt(new Date());
      }
    } catch (err) {
      console.error("Failed to save rules:", err);
    } finally {
      setIsSaving(false);
    }
  }

  const dirty = rules !== originalRules;
  const charCount = rules.length;
  const charLimit = 4000;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-zinc-500 dark:text-zinc-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              ← Back to chat
            </Link>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 ml-3">
              Rules
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {savedAt && !dirty && (
              <span className="text-xs text-green-600 dark:text-green-500">
                Saved
              </span>
            )}
            <button
              onClick={save}
              disabled={!dirty || isSaving || charCount > charLimit}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
            How the AI should behave with you
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            These rules get injected into every conversation as part of the system
            prompt. They override the default AI behavior. Think of it like a
            standing memo to the AI about how you want to be treated.
          </p>
        </div>

        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          placeholder={PLACEHOLDER}
          className="w-full min-h-[500px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700 resize-y font-mono leading-relaxed"
        />

        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {charCount > charLimit ? (
              <span className="text-red-600 dark:text-red-400">
                {charCount} / {charLimit} chars (over limit, will be truncated)
              </span>
            ) : (
              <>
                {charCount} / {charLimit} chars
              </>
            )}
          </span>
          {dirty && <span className="text-amber-600 dark:text-amber-500">Unsaved changes</span>}
        </div>

        <div className="rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          <p className="font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
            Tips:
          </p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Be specific. "Don't be preachy" is vague. "Don't tell me to consult a professional unless I ask" is actionable.</li>
            <li>Rules apply to every conversation immediately after saving.</li>
            <li>You don't need to repeat instructions in each chat -- this is the AI's permanent context for how to behave with you.</li>
            <li>4000 character limit. If you need more, prioritize the most important rules.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

const FACT_CATEGORIES = [
  "identity",
  "family",
  "work",
  "finance",
  "health",
  "interest",
  "project",
  "social",
  "preference",
  "other",
] as const;

type FactCategory = (typeof FACT_CATEGORIES)[number];

interface Fact {
  id: string;
  fact_text: string;
  category: FactCategory;
  source_chat_id: string | null;
  created_at: string;
}

interface MemoryData {
  profile: string;
  profileUpdatedAt: string | null;
  facts: Fact[];
  totalFacts: number;
}

const CATEGORY_LABELS: Record<FactCategory, string> = {
  identity: "Identity",
  family: "Family",
  work: "Work",
  finance: "Finance",
  health: "Health",
  interest: "Interests",
  project: "Projects",
  social: "Social",
  preference: "Preferences",
  other: "Other",
};

export default function MemoryPage() {
  const [data, setData] = useState<MemoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editCategory, setEditCategory] = useState<FactCategory>("other");

  const loadMemory = useCallback(async () => {
    try {
      const res = await fetch("/api/memory");
      if (res.ok) {
        const json = (await res.json()) as MemoryData;
        setData(json);
      }
    } catch (err) {
      console.error("Failed to load memory:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  function startEdit(fact: Fact) {
    setEditingId(fact.id);
    setEditText(fact.fact_text);
    setEditCategory(fact.category);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  async function saveEdit(id: string) {
    if (!editText.trim()) return;
    try {
      await fetch(`/api/memory/facts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fact_text: editText.trim(), category: editCategory }),
      });
      setEditingId(null);
      setEditText("");
      loadMemory();
    } catch (err) {
      console.error("Failed to save edit:", err);
    }
  }

  async function deleteFact(id: string) {
    if (!confirm("Delete this memory permanently? This cannot be undone.")) return;
    try {
      await fetch(`/api/memory/facts/${id}`, { method: "DELETE" });
      loadMemory();
    } catch (err) {
      console.error("Failed to delete fact:", err);
    }
  }

  async function rebuildProfile() {
    try {
      await fetch("/api/memory", { method: "POST" });
      loadMemory();
    } catch (err) {
      console.error("Failed to rebuild profile:", err);
    }
  }

  async function wipeAllMemory() {
    const confirmed = confirm(
      "Wipe ALL memory? This deletes every fact, the profile, and every transcript embedding. " +
        "Your chat history stays, but the AI will forget everything it learned about you. " +
        "Data is physically removed from the database (VACUUM FULL) and cannot be recovered."
    );
    if (!confirmed) return;
    const reallyConfirmed = confirm(
      "Last chance. Are you absolutely sure you want to wipe all memory?"
    );
    if (!reallyConfirmed) return;
    try {
      const res = await fetch("/api/memory", { method: "DELETE" });
      if (res.ok) {
        const result = (await res.json()) as {
          factsDeleted: number;
          chunksDeleted: number;
        };
        alert(
          `Wiped: ${result.factsDeleted} facts, ${result.chunksDeleted} embeddings, profile cleared.\n\n` +
            `Database has been vacuumed and checkpointed. Data is unrecoverable at the DB level.\n\n` +
            `(For full forensic protection, ensure FileVault/disk encryption is enabled.)`
        );
      }
      loadMemory();
    } catch (err) {
      console.error("Failed to wipe memory:", err);
    }
  }

  async function nukeEverything() {
    const typed = prompt(
      "DESTRUCTIVE: This deletes ALL chats, ALL facts, the profile, and ALL embeddings.\n\n" +
        "Nothing will remain. You will lose every conversation and everything the AI knows.\n\n" +
        "Type DELETE to confirm:"
    );
    if (typed !== "DELETE") return;
    try {
      const res = await fetch("/api/memory?mode=nuke", { method: "DELETE" });
      if (res.ok) {
        const result = (await res.json()) as {
          chatsDeleted: number;
          factsDeleted: number;
          chunksDeleted: number;
        };
        alert(
          `Nuked: ${result.chatsDeleted} chats, ${result.factsDeleted} facts, ${result.chunksDeleted} embeddings.\n\n` +
            `Database has been vacuumed and checkpointed. Data is unrecoverable at the DB level.`
        );
        // Redirect to home so the now-empty state shows
        window.location.href = "/";
      }
    } catch (err) {
      console.error("Failed to nuke:", err);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-zinc-500 dark:text-zinc-400">
        Loading memory...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen text-zinc-500 dark:text-zinc-400">
        Failed to load memory.
      </div>
    );
  }

  // Group facts by category
  const factsByCategory = new Map<FactCategory, Fact[]>();
  for (const cat of FACT_CATEGORIES) factsByCategory.set(cat, []);
  for (const fact of data.facts) {
    const list = factsByCategory.get(fact.category) || [];
    list.push(fact);
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
              Memory
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {data.totalFacts} {data.totalFacts === 1 ? "fact" : "facts"}
            </span>
            <button
              onClick={wipeAllMemory}
              className="text-xs px-3 py-1.5 rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              title="Delete all facts, profile, and embeddings. Chats stay."
            >
              Wipe memory
            </button>
            <button
              onClick={nukeEverything}
              className="text-xs px-3 py-1.5 rounded-md border border-red-600 dark:border-red-700 bg-red-600 dark:bg-red-700 text-white hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
              title="Delete EVERYTHING including chats. Cannot be undone."
            >
              Nuke everything
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Profile section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
              Profile
            </h2>
            <button
              onClick={rebuildProfile}
              className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
            >
              Rebuild from facts
            </button>
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            {data.profile ? (
              <pre className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
                {data.profile}
              </pre>
            ) : (
              <p className="text-sm text-zinc-400 dark:text-zinc-500 italic">
                No profile yet. Have a few conversations and the AI will build one
                automatically from extracted facts.
              </p>
            )}
            {data.profileUpdatedAt && (
              <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-3 uppercase tracking-wider">
                Updated {new Date(data.profileUpdatedAt).toLocaleString()}
              </p>
            )}
          </div>
        </section>

        {/* Facts grouped by category */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-3">
            All facts
          </h2>
          {data.facts.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
              No facts extracted yet. Have conversations and they will appear here.
            </div>
          ) : (
            <div className="space-y-6">
              {FACT_CATEGORIES.map((cat) => {
                const facts = factsByCategory.get(cat) || [];
                if (facts.length === 0) return null;
                return (
                  <div key={cat}>
                    <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                      {CATEGORY_LABELS[cat]} ({facts.length})
                    </h3>
                    <div className="space-y-2">
                      {facts.map((fact) => (
                        <div
                          key={fact.id}
                          className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3"
                        >
                          {editingId === fact.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="w-full text-sm text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded p-2 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600 resize-none"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex items-center gap-2">
                                <select
                                  value={editCategory}
                                  onChange={(e) => setEditCategory(e.target.value as FactCategory)}
                                  className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                                >
                                  {FACT_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>
                                      {CATEGORY_LABELS[c]}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => saveEdit(fact.id)}
                                  className="text-xs px-3 py-1 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="text-xs px-3 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm text-zinc-700 dark:text-zinc-300 flex-1">
                                {fact.fact_text}
                              </p>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => startEdit(fact)}
                                  className="p-1.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                  title="Edit"
                                >
                                  <PencilIcon />
                                </button>
                                <button
                                  onClick={() => deleteFact(fact.id)}
                                  className="p-1.5 rounded text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                  title="Delete"
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowLeft,
  Check,
  Pencil,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
import { Logo } from "@/components/Logo";

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
type FactStatus = "active" | "pending" | "disputed" | "retired";
type ReviewAction = "confirm" | "dispute" | "retire" | "restore";
type MemoryTab = "review" | "active" | "history";

interface Fact {
  id: string;
  fact_text: string;
  category: FactCategory;
  source_chat_id: string | null;
  supporting_quote: string | null;
  source_message_index: number | null;
  status: FactStatus;
  recall_eligible: boolean;
  origin: "model" | "user" | "legacy";
  confirmed_by: "user" | "policy" | "legacy" | null;
  review_reason: string | null;
  reviewed_at: string | null;
  valid_from: string;
  valid_to: string | null;
  updated_at: string;
  created_at: string;
  proposed_replacements: Array<{ id: string; fact_text: string }>;
}

interface MemoryCounts {
  active: number;
  pending: number;
  disputed: number;
  retired: number;
  total: number;
}

interface MemoryData {
  profile: string;
  profileUpdatedAt: string | null;
  facts: Fact[];
  totalFacts: number;
  totalClaims: number;
  counts: MemoryCounts;
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

const EMPTY_COUNTS: MemoryCounts = {
  active: 0,
  pending: 0,
  disputed: 0,
  retired: 0,
  total: 0,
};

export default function MemoryPage() {
  const [data, setData] = useState<MemoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<MemoryTab>("review");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editCategory, setEditCategory] = useState<FactCategory>("other");
  const [searchQuery, setSearchQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMemory = useCallback(async () => {
    try {
      const response = await fetch("/api/memory");
      if (!response.ok) throw new Error("Memory could not be loaded");
      const json = (await response.json()) as MemoryData;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memory could not be loaded");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const visibleFacts = useMemo(() => {
    if (!data) return [];
    const byTab = data.facts.filter((fact) => {
      if (tab === "review") return fact.status === "pending";
      if (tab === "active") return fact.status === "active";
      return fact.status === "retired" || fact.status === "disputed";
    });
    const query = searchQuery.trim().toLowerCase();
    if (!query) return byTab;
    return byTab.filter(
      (fact) =>
        fact.fact_text.toLowerCase().includes(query) ||
        fact.supporting_quote?.toLowerCase().includes(query) ||
        CATEGORY_LABELS[fact.category].toLowerCase().includes(query)
    );
  }, [data, searchQuery, tab]);

  const factsByCategory = useMemo(() => {
    const grouped = new Map<FactCategory, Fact[]>();
    for (const category of FACT_CATEGORIES) grouped.set(category, []);
    for (const fact of visibleFacts) grouped.get(fact.category)?.push(fact);
    return grouped;
  }, [visibleFacts]);

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
    setBusyId(id);
    try {
      const response = await fetch(`/api/memory/facts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fact_text: editText.trim(), category: editCategory }),
      });
      if (!response.ok) throw new Error("The memory could not be updated");
      cancelEdit();
      await loadMemory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The memory could not be updated");
    } finally {
      setBusyId(null);
    }
  }

  async function runReviewAction(id: string, action: ReviewAction) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/memory/facts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("The claim could not be updated");
      await loadMemory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The claim could not be updated");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteFact(id: string) {
    if (!confirm("Delete this claim permanently? This cannot be undone.")) return;
    setBusyId(id);
    try {
      const response = await fetch(`/api/memory/facts/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("The claim could not be deleted");
      await loadMemory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The claim could not be deleted");
    } finally {
      setBusyId(null);
    }
  }

  async function wipeAllMemory() {
    const confirmed = confirm(
      "Wipe all memory? This permanently deletes every claim, the profile, and transcript embeddings. Chat history stays."
    );
    if (!confirmed || !confirm("Last chance. Wipe all memory now?")) return;
    const response = await fetch("/api/memory", { method: "DELETE" });
    if (!response.ok) {
      setError("Memory could not be wiped");
      return;
    }
    await loadMemory();
  }

  async function nukeEverything() {
    const typed = prompt(
      "This permanently deletes all chats, claims, the profile, and embeddings. Type DELETE to confirm."
    );
    if (typed !== "DELETE") return;
    const response = await fetch("/api/memory?mode=nuke", { method: "DELETE" });
    if (!response.ok) {
      setError("Data could not be deleted");
      return;
    }
    window.location.href = "/";
  }

  if (isLoading) return <PageState>Loading memory...</PageState>;
  if (!data) return <PageState>{error || "Memory could not be loaded."}</PageState>;

  const counts = data.counts || EMPTY_COUNTS;
  const historyCount = counts.retired + counts.disputed;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Back to chat"
              title="Back to chat"
              className="grid size-9 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <ArrowLeft size={18} />
            </Link>
            <Logo size={20} className="shrink-0" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">Memory</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {counts.active} active · {counts.total} total
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 sm:flex">
            <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400" />
            User-controlled memory
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {error && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error" title="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="flex flex-col gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal">Memory claims</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              The assistant recalls active claims only.
            </p>
          </div>
          <label className="relative block w-full sm:w-72">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <span className="sr-only">Search claims</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search claims"
              className="h-10 w-full rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-700"
            />
          </label>
        </div>

        <div className="mt-5 grid grid-cols-3 rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900" role="tablist">
          <TabButton active={tab === "review"} count={counts.pending} onClick={() => setTab("review")}>Review</TabButton>
          <TabButton active={tab === "active"} count={counts.active} onClick={() => setTab("active")}>Active</TabButton>
          <TabButton active={tab === "history"} count={historyCount} onClick={() => setTab("history")}>History</TabButton>
        </div>

        {tab === "active" && data.profile && (
          <section className="mt-8 border-b border-zinc-200 pb-8 dark:border-zinc-800">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase text-zinc-600 dark:text-zinc-300">Profile</h3>
              {data.profileUpdatedAt && (
                <time className="text-xs text-zinc-400" dateTime={data.profileUpdatedAt}>
                  Updated {new Date(data.profileUpdatedAt).toLocaleDateString()}
                </time>
              )}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-zinc-700 dark:text-zinc-300">{data.profile}</pre>
          </section>
        )}

        <section className="py-8">
          {visibleFacts.length === 0 ? (
            <EmptyState tab={tab} searching={Boolean(searchQuery.trim())} />
          ) : (
            <div className="space-y-8">
              {FACT_CATEGORIES.map((category) => {
                const facts = factsByCategory.get(category) || [];
                if (facts.length === 0) return null;
                return (
                  <div key={category}>
                    <h3 className="mb-3 text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                      {CATEGORY_LABELS[category]} · {facts.length}
                    </h3>
                    <div className="space-y-3">
                      {facts.map((fact) => (
                        <ClaimCard
                          key={fact.id}
                          fact={fact}
                          tab={tab}
                          busy={busyId === fact.id}
                          editing={editingId === fact.id}
                          editText={editText}
                          editCategory={editCategory}
                          onEditText={setEditText}
                          onEditCategory={setEditCategory}
                          onStartEdit={() => startEdit(fact)}
                          onCancelEdit={cancelEdit}
                          onSaveEdit={() => void saveEdit(fact.id)}
                          onAction={(action) => void runReviewAction(fact.id, action)}
                          onDelete={() => void deleteFact(fact.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="border-t border-zinc-200 py-7 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">Danger zone</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void wipeAllMemory()} className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30">
              Wipe memory
            </button>
            <button onClick={() => void nukeEverything()} className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700">
              Delete everything
            </button>
          </div>
        </section>

        <AppFooter variant="page" />
      </main>
    </div>
  );
}

function TabButton({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-10 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium transition-colors ${active ? "bg-zinc-950 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950" : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"}`}
    >
      {children}
      <span className={`text-xs ${active ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-400"}`}>{count}</span>
    </button>
  );
}

function ClaimCard({ fact, tab, busy, editing, editText, editCategory, onEditText, onEditCategory, onStartEdit, onCancelEdit, onSaveEdit, onAction, onDelete }: {
  fact: Fact;
  tab: MemoryTab;
  busy: boolean;
  editing: boolean;
  editText: string;
  editCategory: FactCategory;
  onEditText: (value: string) => void;
  onEditCategory: (value: FactCategory) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onAction: (action: ReviewAction) => void;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={fact.status} />
            <span className="text-xs text-zinc-400">
              {fact.origin === "model" ? "AI proposed" : fact.origin === "user" ? "User edited" : "Existing memory"}
            </span>
          </div>
          {editing ? (
            <div className="space-y-3">
              <textarea
                value={editText}
                onChange={(event) => onEditText(event.target.value)}
                rows={3}
                autoFocus
                className="w-full resize-y rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-700"
              />
              <div className="flex flex-wrap items-center gap-2">
                <select value={editCategory} onChange={(event) => onEditCategory(event.target.value as FactCategory)} className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                  {FACT_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
                </select>
                <button type="button" disabled={busy || !editText.trim()} onClick={onSaveEdit} className="h-9 rounded-md bg-zinc-950 px-3 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950">Save</button>
                <button type="button" onClick={onCancelEdit} className="h-9 rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700">Cancel</button>
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium leading-6 text-zinc-900 dark:text-zinc-100">{fact.fact_text}</p>
          )}
        </div>

        {!editing && tab === "active" && (
          <button type="button" onClick={onStartEdit} title="Edit claim" aria-label="Edit claim" className="grid size-9 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white">
            <Pencil size={16} />
          </button>
        )}
      </div>

      {!editing && fact.review_reason && tab === "review" && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{fact.review_reason}</p>
      )}

      {!editing && fact.proposed_replacements.length > 0 && (
        <div className="mt-4 border-l-2 border-amber-400 pl-3">
          <p className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-300">Would replace</p>
          {fact.proposed_replacements.map((replacement) => (
            <p key={replacement.id} className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{replacement.fact_text}</p>
          ))}
        </div>
      )}

      {!editing && fact.supporting_quote && (
        <div className="mt-4 rounded-md bg-zinc-50 px-3 py-3 dark:bg-zinc-950">
          <p className="text-xs font-semibold uppercase text-zinc-500">Receipt</p>
          <blockquote className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">&ldquo;{fact.supporting_quote}&rdquo;</blockquote>
        </div>
      )}

      {!editing && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <time className="text-xs text-zinc-400" dateTime={fact.updated_at}>
            {fact.status === "retired" && fact.valid_to ? `Retired ${new Date(fact.valid_to).toLocaleDateString()}` : `Updated ${new Date(fact.updated_at).toLocaleDateString()}`}
          </time>
          <div className="flex flex-wrap items-center gap-2">
            {tab === "review" && (
              <>
                <ActionButton disabled={busy} onClick={() => onAction("dispute")} variant="secondary" icon={<X size={16} />}>Dispute</ActionButton>
                <ActionButton disabled={busy} onClick={() => onAction("confirm")} variant="confirm" icon={<Check size={16} />}>Confirm</ActionButton>
              </>
            )}
            {tab === "active" && (
              <ActionButton disabled={busy} onClick={() => onAction("retire")} variant="secondary" icon={<Archive size={16} />}>Retire</ActionButton>
            )}
            {tab === "history" && (
              <>
                <ActionButton disabled={busy} onClick={() => onAction("restore")} variant="secondary" icon={<RotateCcw size={16} />}>Restore</ActionButton>
                <button type="button" disabled={busy} onClick={onDelete} title="Delete permanently" aria-label="Delete permanently" className="grid size-9 place-items-center rounded-md text-red-500 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30">
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function ActionButton({ disabled, onClick, variant, icon, children }: { disabled: boolean; onClick: () => void; variant: "secondary" | "confirm"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium disabled:opacity-50 ${variant === "confirm" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
      {icon}{children}
    </button>
  );
}

function StatusBadge({ status }: { status: FactStatus }) {
  const classes: Record<FactStatus, string> = {
    active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    disputed: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    retired: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return <span className={`rounded px-2 py-1 text-xs font-medium capitalize ${classes[status]}`}>{status}</span>;
}

function EmptyState({ tab, searching }: { tab: MemoryTab; searching: boolean }) {
  const message = searching
    ? "No matching claims."
    : tab === "review"
      ? "Nothing needs review."
      : tab === "active"
        ? "No active claims yet."
        : "No claim history yet.";
  return <div className="py-20 text-center"><p className="text-sm text-zinc-500 dark:text-zinc-400">{message}</p></div>;
}

function PageState({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">{children}</div>;
}

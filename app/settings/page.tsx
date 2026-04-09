"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AppFooter } from "@/components/AppFooter";
import { Logo } from "@/components/Logo";
import { MODEL_OPTIONS } from "@/lib/llm-config";

export default function SettingsPage() {
  const [braveKey, setBraveKey] = useState("");
  const [braveConfigured, setBraveConfigured] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  // Installed Ollama models for the model management section
  const [installedModels, setInstalledModels] = useState<Set<string>>(new Set());
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    status: string;
    completed?: number;
    total?: number;
  } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/list");
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; models?: { name: string }[] };
      if (data.ok && data.models) {
        const names = new Set<string>();
        for (const m of data.models) {
          names.add(m.name);
          if (m.name.endsWith(":latest")) {
            names.add(m.name.replace(/:latest$/, ""));
          }
        }
        setInstalledModels(names);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  // Start a model download. Fires a background pull on the server and
  // polls for progress. The download survives page navigation because
  // the server does the actual work, not the browser.
  async function pullModel(model: string) {
    setDownloadingModel(model);
    setDownloadProgress({ status: "starting" });
    setDownloadError(null);
    try {
      const res = await fetch("/api/models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        setDownloadError(`Server returned ${res.status}`);
        return;
      }
      // Poll for progress every 500ms
      const poll = setInterval(async () => {
        try {
          const pRes = await fetch(`/api/models/pull?model=${encodeURIComponent(model)}`);
          if (!pRes.ok) return;
          const p = (await pRes.json()) as {
            status: string;
            completed?: number;
            total?: number;
            error?: string;
            done: boolean;
          };
          setDownloadProgress({
            status: p.status,
            completed: p.completed,
            total: p.total,
          });
          if (p.error) {
            setDownloadError(p.error);
            clearInterval(poll);
            setDownloadingModel(null);
          }
          if (p.done && !p.error) {
            clearInterval(poll);
            await refreshModels();
            setDownloadingModel(null);
            setDownloadProgress(null);
          }
        } catch {
          // poll failed, keep trying
        }
      }, 500);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelDownload(model: string) {
    try {
      await fetch(`/api/models/pull?model=${encodeURIComponent(model)}`, {
        method: "DELETE",
      });
      setDownloadingModel(null);
      setDownloadProgress(null);
    } catch {
      // ignore
    }
  }

  async function deleteModel(model: string) {
    if (!confirm(`Remove ${model} from your machine? This frees disk space immediately.`)) return;
    try {
      const res = await fetch("/api/models/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (res.ok) {
        await refreshModels();
      }
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  }

  // Load whether a key is currently configured (we never read the actual value)
  useEffect(() => {
    fetch("/api/settings?key=brave_search_api_key")
      .then((r) => r.json())
      .then((j: { configured?: boolean }) => setBraveConfigured(!!j.configured))
      .catch(() => setBraveConfigured(false));
  }, []);

  async function saveBraveKey() {
    if (!braveKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "brave_search_api_key", value: braveKey.trim() }),
      });
      if (res.ok) {
        setBraveConfigured(true);
        setBraveKey("");
        setSavedFlash("Saved");
        setTimeout(() => setSavedFlash(null), 2000);
      }
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }

  async function clearBraveKey() {
    if (!confirm("Remove the Brave Search API key? Web search on local models will stop working.")) return;
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "brave_search_api_key", value: "" }),
      });
      setBraveConfigured(false);
      setSavedFlash("Removed");
      setTimeout(() => setSavedFlash(null), 2000);
    } catch (err) {
      console.error("Failed to clear:", err);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              ← Back to chat
            </Link>
            <div className="flex items-center gap-2 ml-3">
              <Logo size={18} className="text-zinc-900 dark:text-zinc-100" />
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Settings
              </h1>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-600 ml-1">
                v{process.env.NEXT_PUBLIC_APP_VERSION}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Three quick-link cards in a single row (stack on small screens) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/providers"
            className="group flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-zinc-900 p-5 hover:border-emerald-300 dark:hover:border-emerald-800 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <PlugIcon />
              </div>
              <span className="text-sm font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Providers
              </span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed flex-1">
              Add a Claude or OpenAI API key. Fastest way to get chatting.
            </p>
            <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mt-4 group-hover:translate-x-0.5 transition-transform">
              Manage →
            </div>
          </Link>

          <Link
            href="/memory"
            className="group flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-zinc-900 p-5 hover:border-violet-300 dark:hover:border-violet-800 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                <BrainIcon />
              </div>
              <span className="text-sm font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Memory
              </span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed flex-1">
              View, edit, or delete every fact the AI has learned about you.
            </p>
            <div className="text-xs font-medium text-violet-700 dark:text-violet-400 mt-4 group-hover:translate-x-0.5 transition-transform">
              Open →
            </div>
          </Link>

          <Link
            href="/rules"
            className="group flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-zinc-900 p-5 hover:border-amber-300 dark:hover:border-amber-800 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <RulesIcon />
              </div>
              <span className="text-sm font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                Rules
              </span>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed flex-1">
              Custom instructions the AI follows in every chat. Global system prompt.
            </p>
            <div className="text-xs font-medium text-amber-700 dark:text-amber-400 mt-4 group-hover:translate-x-0.5 transition-transform">
              Edit →
            </div>
          </Link>
        </div>

        <section>
          <h2 className="flex items-center justify-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-3">
            <ModelsIcon />
            Manage models
          </h2>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
              Download or remove Gemma 4 chat models without leaving the app. The model you pick from the dropdown in chat needs to be installed here first.
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-500 mb-4 leading-relaxed">
              <strong>Heads up:</strong> memory extraction uses whichever model you&apos;re currently chatting with. Local models are free. Cloud providers (Claude, OpenAI) cost a few cents per turn for the extra extraction call.
            </p>

            <div className="space-y-3">
              {MODEL_OPTIONS.map((opt) => {
                const isInstalled = installedModels.has(opt.id);
                const isCurrentDownload = downloadingModel === opt.id;
                return (
                  <div
                    key={opt.id}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {opt.label}
                          </span>
                          {opt.recommended && (
                            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              ★ Recommended
                            </span>
                          )}
                          {isInstalled && (
                            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              ✓ Installed
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                          ~{opt.sizeGB} GB • {opt.description}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {isInstalled ? (
                          <button
                            onClick={() => deleteModel(opt.id)}
                            className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                          >
                            Remove
                          </button>
                        ) : isCurrentDownload && downloadProgress ? (
                          <button
                            onClick={() => cancelDownload(opt.id)}
                            className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            onClick={() => pullModel(opt.id)}
                            disabled={!!downloadingModel}
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </div>
                    {isCurrentDownload && downloadProgress && (
                      <div className="mt-3">
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">
                          {downloadProgress.status}
                          {downloadProgress.completed && downloadProgress.total ? (
                            <span>
                              {" "}
                              — {(downloadProgress.completed / 1e9).toFixed(2)} GB / {(downloadProgress.total / 1e9).toFixed(2)} GB
                            </span>
                          ) : null}
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all duration-300"
                            style={{
                              width:
                                downloadProgress.completed && downloadProgress.total
                                  ? `${Math.round((downloadProgress.completed / downloadProgress.total) * 100)}%`
                                  : "5%",
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {isCurrentDownload && downloadError && (
                      <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                        {downloadError}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section>
          <h2 className="flex items-center justify-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-3">
            <GlobeIcon />
            Web search (local models)
          </h2>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
              Local models like Gemma can&apos;t browse the web on their own, so RecallMEM uses{" "}
              <strong>Brave Search</strong> as a backend. The free tier gives you 2,000 searches per month.
            </p>

            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 mb-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                How to get a key (one time, ~5 minutes)
              </div>
              <ol className="text-sm text-zinc-700 dark:text-zinc-300 space-y-1.5 list-decimal list-inside">
                <li>
                  Sign up at{" "}
                  <a
                    href="https://brave.com/search/api"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 dark:text-blue-400 underline"
                  >
                    brave.com/search/api
                  </a>
                </li>
                <li>Pick the Free tier and grab your API key</li>
                <li>Paste it below and click Save</li>
              </ol>
            </div>

            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Brave Search API key
              {braveConfigured === true && (
                <span className="ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                  ✓ Configured
                </span>
              )}
              {braveConfigured === false && (
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  Not set
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={braveKey}
                onChange={(e) => setBraveKey(e.target.value)}
                placeholder={braveConfigured ? "•••••••• (paste a new key to replace)" : "Paste your Brave API key"}
                className="flex-1 text-sm px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
              />
              <button
                onClick={saveBraveKey}
                disabled={!braveKey.trim() || saving}
                className="px-4 py-2 text-sm font-medium rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {braveConfigured && (
                <button
                  onClick={clearBraveKey}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            {savedFlash && (
              <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                {savedFlash}
              </div>
            )}

            <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-4 leading-relaxed">
              The key is stored locally in your Postgres database. It never leaves your machine. Your message text gets sent to Brave when you have web search toggled on, but your memory, profile, facts, and past conversations stay local.
            </p>
          </div>
        </section>

        <AppFooter variant="page" />
      </div>
    </div>
  );
}

function BrainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08 2.5 2.5 0 0 0 4.91.05L12 20V4.5Z" />
      <path d="M12 4.5a2.5 2.5 0 0 1 4.96-.46 2.5 2.5 0 0 1 1.98 3 2.5 2.5 0 0 1 1.32 4.24 3 3 0 0 1-.34 5.58 2.5 2.5 0 0 1-2.96 3.08 2.5 2.5 0 0 1-4.91.05L12 20V4.5Z" />
    </svg>
  );
}

function RulesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ModelsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

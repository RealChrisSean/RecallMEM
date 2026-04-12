"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AppFooter } from "@/components/AppFooter";
import { Logo } from "@/components/Logo";
import { MODEL_OPTIONS } from "@/lib/llm-config";

export default function SettingsPage() {
  const [connectingService, setConnectingService] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    changelog: { version: string; date: string; notes: string }[];
  } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  // Check for updates on mount
  useEffect(() => {
    fetch("/api/update")
      .then((r) => r.json())
      .then((data: { currentVersion?: string; latestVersion?: string; updateAvailable?: boolean; changelog?: { version: string; date: string; notes: string }[] }) => {
        if (data.currentVersion) {
          setUpdateInfo({
            currentVersion: data.currentVersion,
            latestVersion: data.latestVersion || data.currentVersion,
            updateAvailable: !!data.updateAvailable,
            changelog: data.changelog || [],
          });
        }
      })
      .catch(() => {});
  }, []);

  async function runUpdate() {
    setUpdating(true);
    setUpdateResult(null);
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message: string; newVersion?: string };
      setUpdateResult(data.message);
      if (data.ok && data.newVersion) {
        setUpdateInfo((prev) => prev ? {
          ...prev,
          currentVersion: data.newVersion!,
          updateAvailable: false,
        } : null);
      }
    } catch (err) {
      setUpdateResult("Update failed. Try running 'npx recallmem upgrade' in your terminal.");
    } finally {
      setUpdating(false);
    }
  }
  // TTS + STT settings
  const [ttsProvider, setTtsProvider] = useState("auto");
  const [ttsVoice, setTtsVoice] = useState("");
  const [sttProvider, setSttProvider] = useState("whisper");
  const [ttsAvailable, setTtsAvailable] = useState<{ xai: boolean; openai: boolean; deepgram: boolean; browser: boolean }>({ xai: false, openai: false, deepgram: false, browser: true });
  const [ttsVoices, setTtsVoices] = useState<Record<string, string[]>>({});
  const [ttsSaved, setTtsSaved] = useState(false);
  const [deepgramKey, setDeepgramKey] = useState("");
  const [deepgramConfigured, setDeepgramConfigured] = useState(false);
  const [voiceChatMode, setVoiceChatMode] = useState("separate");

  useEffect(() => {
    fetch("/api/tts")
      .then((r) => r.json())
      .then((d: { available: { xai: boolean; openai: boolean; deepgram: boolean; browser: boolean }; voices: Record<string, string[]>; settings: { provider: string; voice: string | null; sttProvider: string; voiceChatMode?: string } }) => {
        setTtsAvailable(d.available);
        setTtsVoices(d.voices);
        setTtsProvider(d.settings.provider || "auto");
        setTtsVoice(d.settings.voice || "");
        setSttProvider(d.settings.sttProvider || "whisper");
        setVoiceChatMode(d.settings.voiceChatMode || "separate");
        setDeepgramConfigured(d.available.deepgram);
      })
      .catch(() => {});
  }, []);

  async function saveDeepgramKey() {
    if (!deepgramKey.trim()) return;
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "deepgram_api_key", value: deepgramKey.trim() }),
    });
    setDeepgramConfigured(true);
    setDeepgramKey("");
    setTtsAvailable((prev) => ({ ...prev, deepgram: true }));
  }

  async function saveVoiceSettings() {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tts_provider", value: ttsProvider === "auto" ? "" : ttsProvider }),
    });
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "tts_voice", value: ttsVoice }),
    });
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "stt_provider", value: sttProvider }),
    });
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "voice_chat_mode", value: voiceChatMode }),
    });
    setTtsSaved(true);
    setTimeout(() => setTtsSaved(false), 2000);
  }

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

  // Close modals on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConnectingService(null);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

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

        <UsageSection />

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
              <strong>Brave Search</strong> as a backend. Brave gives you $5 in free credits every month, which covers about 1,000 searches.
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

        <section>
          <h2 className="flex items-center justify-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
            Voice
          </h2>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-6">

            {/* Deepgram API key */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
                Deepgram API Key
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                Deepgram offers high-quality STT and TTS. Get a key at{" "}
                <a href="https://console.deepgram.com" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">console.deepgram.com</a>
                {" "}($200 free credits included).
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={deepgramKey}
                  onChange={(e) => setDeepgramKey(e.target.value)}
                  placeholder={deepgramConfigured ? "••••••••  (paste a new key to replace)" : "Paste your Deepgram API key"}
                  className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                />
                <button
                  onClick={saveDeepgramKey}
                  disabled={!deepgramKey.trim()}
                  className="px-4 py-2 text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-40"
                >
                  Save
                </button>
              </div>
              {deepgramConfigured && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">Deepgram key configured</p>
              )}
            </div>

            <hr className="border-zinc-200 dark:border-zinc-800" />

            {/* Text-to-Speech */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Text-to-Speech</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                Click the speaker icon on any AI response to hear it read aloud.
                {!ttsAvailable.xai && !ttsAvailable.openai && !ttsAvailable.deepgram && (
                  <span className="block mt-1 text-amber-600 dark:text-amber-400 font-medium">
                    No TTS provider detected. Add an OpenAI, xAI, or Deepgram API key to enable high-quality voices.
                  </span>
                )}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
                    Provider
                  </label>
                  <select
                    value={ttsProvider}
                    onChange={(e) => { setTtsProvider(e.target.value); setTtsVoice(""); }}
                    className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="auto">Auto (cheapest available)</option>
                    <option value="xai" disabled={!ttsAvailable.xai}>xAI Grok ($4.20/1M chars){!ttsAvailable.xai ? " -- no API key" : ""}</option>
                    <option value="deepgram" disabled={!ttsAvailable.deepgram}>Deepgram Aura-2 ($30/1M chars){!ttsAvailable.deepgram ? " -- no API key" : ""}</option>
                    <option value="openai" disabled={!ttsAvailable.openai}>OpenAI HD ($30/1M chars){!ttsAvailable.openai ? " -- no API key" : ""}</option>
                    <option value="browser">Browser built-in (free, private, robotic)</option>
                  </select>
                </div>

                {ttsProvider !== "browser" && (ttsAvailable.xai || ttsAvailable.openai || ttsAvailable.deepgram) && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
                      Voice
                    </label>
                    <select
                      value={ttsVoice}
                      onChange={(e) => setTtsVoice(e.target.value)}
                      className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="">Default</option>
                      {ttsProvider === "xai" && ttsVoices.xai?.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                      {ttsProvider === "openai" && ttsVoices.openai?.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                      {ttsProvider === "deepgram" && ttsVoices.deepgram?.map((v) => (
                        <option key={v} value={v}>{v.replace("aura-2-", "").replace("-en", "")}</option>
                      ))}
                      {ttsProvider === "auto" && (
                        <>
                          {ttsAvailable.xai && <optgroup label="xAI Grok">
                            {ttsVoices.xai?.map((v) => <option key={`xai-${v}`} value={v}>{v}</option>)}
                          </optgroup>}
                          {ttsAvailable.deepgram && <optgroup label="Deepgram">
                            {ttsVoices.deepgram?.map((v) => <option key={`dg-${v}`} value={v}>{v.replace("aura-2-", "").replace("-en", "")}</option>)}
                          </optgroup>}
                          {ttsAvailable.openai && <optgroup label="OpenAI">
                            {ttsVoices.openai?.map((v) => <option key={`oai-${v}`} value={v}>{v}</option>)}
                          </optgroup>}
                        </>
                      )}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <hr className="border-zinc-200 dark:border-zinc-800" />

            {/* Speech-to-Text */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Speech-to-Text</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                Click the mic icon to dictate messages by voice.
              </p>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
                  Provider
                </label>
                <select
                  value={sttProvider}
                  onChange={(e) => setSttProvider(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <option value="whisper">Local Whisper (free, private, requires whisper-server)</option>
                  <option value="deepgram" disabled={!ttsAvailable.deepgram}>Deepgram Nova-3 ($0.0043/min){!ttsAvailable.deepgram ? " -- add API key above" : ""}</option>
                </select>
              </div>
            </div>

            {/* Voice Chat Mode — hidden for now, needs more work */}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={saveVoiceSettings}
                className="px-4 py-2 text-sm font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
              >
                Save
              </button>
              {ttsSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-500 leading-relaxed">
              xAI Grok is the cheapest TTS at $4.20/1M chars. Deepgram gives $200 free credits for STT. The browser/Whisper options are completely free and private. Cloud providers receive your text/audio for processing.
            </p>
          </div>
        </section>

        <section className="relative">
          {/* Coming soon overlay */}
          <div className="absolute inset-0 z-10 backdrop-blur-[1px] bg-white/40 dark:bg-zinc-950/40 rounded-lg flex items-center justify-center">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-8 py-5 text-center shadow-lg">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Connectors
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Coming Soon
              </div>
            </div>
          </div>
          <section className="pointer-events-none select-none">
          <h2 className="flex items-center justify-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-3">
            <ConnectionsIcon />
            Connections
          </h2>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
              Connect external data sources so the AI knows your schedule, emails, notes, and code without you having to type it all in chat. Powered by <a href="https://www.fiveonefour.com/" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">MooseStack</a>.
            </p>
            <div className="space-y-3">
              {[
                {
                  name: "Google Calendar",
                  description: "Upcoming events, meetings, deadlines",
                  logo: <img src="https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png" alt="Google Calendar" width={28} height={28} />,
                  connected: true,
                },
                {
                  name: "Gmail",
                  description: "Email subjects, senders, content",
                  logo: <img src="https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png" alt="Gmail" width={28} height={28} />,
                  connected: true,
                },
                {
                  name: "Notion",
                  description: "Pages, docs, notes, databases",
                  logo: <svg width="28" height="28" viewBox="0 0 100 100" fill="none"><path d="M6.017 4.313l55.333-4.087c6.797-.583 8.543-.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277-1.553 6.807-6.99 7.193L24.467 99.967c-4.08.193-6.023-.39-8.16-3.113L3.3 79.94c-2.333-3.113-3.3-5.443-3.3-8.167V11.113c0-3.497 1.553-6.413 6.017-6.8z" fill="#fff"/><path fillRule="evenodd" clipRule="evenodd" d="M61.35.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723.967 5.053 3.3 8.167l12.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257-3.89c5.437-.387 6.99-2.917 6.99-7.193V20.64c0-2.21-.873-2.847-3.443-4.733L74.167 3.14C69.893.14 68.147-.357 61.35.227zM25.505 19.88c-5.78.39-7.103.477-10.397-2.14l-8.19-6.42C5.365 10.15 4.98 9.177 6.4 8.787l53.36-3.89c4.667-.387 7-.193 9.333 1.557l9.333 6.803c.58.387.967 1.36.193 1.36l-55.577 3.303-.777.58v73.153c0 2.723-1.36 4.087-3.887 4.28l-5.58.387c-3.107.193-4.28-1.167-4.28-3.693V20.267l1.007-.387z" fill="#000"/><path d="M68.063 26.88c.387 1.747 0 3.497-1.75 3.69l-2.917.58v51.593c-2.527 1.36-4.853 2.14-6.797 2.14-3.11 0-3.883-.967-6.22-3.883L33.467 50.193v28.94l6.02 1.363s0 3.497-4.857 3.497l-13.387.777c-.387-.777 0-2.723 1.357-3.11l3.497-.967V40.49l-4.857-.387c-.387-1.747.58-4.277 3.3-4.47l14.357-.967 17.86 27.373V37.293l-5.053-.58c-.387-2.14 1.167-3.693 3.11-3.887l13.357-.947z" fill="#000"/></svg>,
                  connected: true,
                },
                {
                  name: "GitHub",
                  description: "Repos, commits, PRs, stars",
                  logo: <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-zinc-900 dark:text-zinc-100"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>,
                  connected: true,
                },
                {
                  name: "Slack",
                  description: "Messages, channels, DMs",
                  auth: "oauth",
                  authLabel: "Sign in with Slack",
                  authIcon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="#E01E5A"/><path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/><path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="#36C5F0"/><path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/><path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="#2EB67D"/><path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/><path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="#ECB22E"/><path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/></svg>,
                  logo: <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/><path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/><path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/><path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/></svg>,
                  connected: false,
                },
                {
                  name: "X (Twitter)",
                  description: "Posts, bookmarks, likes, DMs",
                  auth: "oauth",
                  authLabel: "Sign in with X",
                  authIcon: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>,
                  logo: <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-zinc-900 dark:text-zinc-100"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>,
                  connected: false,
                },
                {
                  name: "LinkedIn",
                  description: "Profile, posts, connections",
                  auth: "oauth",
                  authLabel: "Sign in with LinkedIn",
                  authIcon: <svg width="18" height="18" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>,
                  logo: <svg width="28" height="28" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>,
                  connected: false,
                },
                {
                  name: "iMessage",
                  description: "Text conversations (local only)",
                  auth: "apple",
                  authLabel: "Sign in with Apple",
                  authIcon: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>,
                  logo: <svg width="28" height="28" viewBox="0 0 24 24" fill="#34C759"><path d="M12 2C6.477 2 2 5.813 2 10.5c0 2.65 1.378 5.022 3.537 6.587-.19 1.637-.793 3.237-1.537 4.413 2.002-.416 3.816-1.272 5.236-2.417.882.18 1.804.277 2.764.277C17.523 19.36 22 15.547 22 10.86 22 6.173 17.523 2 12 2z"/></svg>,
                  connected: false,
                },
                {
                  name: "Spotify",
                  description: "Listening history, playlists, mood",
                  auth: "oauth",
                  authLabel: "Sign in with Spotify",
                  authIcon: <svg width="18" height="18" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>,
                  logo: <svg width="28" height="28" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>,
                  connected: false,
                },
                {
                  name: "Apple Health",
                  description: "Sleep, steps, heart rate, workouts",
                  auth: "apple",
                  authLabel: "Sign in with Apple",
                  authIcon: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>,
                  logo: <svg width="28" height="28" viewBox="0 0 24 24" fill="#FF2D55"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>,
                  connected: false,
                },
              ].map((source) => (
                <div
                  key={source.name}
                  className={`rounded-lg border p-3 flex items-center justify-between ${
                    source.connected
                      ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">{source.logo}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {source.name}
                        </span>
                        {source.connected && (
                          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            ✓ Connected
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {source.description}
                      </div>
                    </div>
                  </div>
                  <div>
                    {source.connected ? (
                      <div className="flex items-center gap-2">
                        <button className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                          Sync now
                        </button>
                        <button className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors">
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConnectingService(source.name)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                      >
                        Connect →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-4 leading-relaxed">
              Each connector syncs your data into RecallMEM&apos;s memory so the AI knows your schedule, inbox, notes, and code. Data is processed through MooseStack&apos;s analytical pipeline and stored locally.
            </p>
          </div>
          </section>
        </section>

        {/* OAuth connect modal — only functional when connections are enabled */}
        {connectingService && (() => {
          const allSources = [
            { name: "Slack", auth: "oauth", authLabel: "Sign in with Slack", authIcon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="#E01E5A"/><path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/><path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="#36C5F0"/><path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/><path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="#2EB67D"/><path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/><path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="#ECB22E"/><path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/></svg>, brandColor: "#4A154B" },
            { name: "X (Twitter)", auth: "oauth", authLabel: "Sign in with X", authIcon: <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>, brandColor: "#000000" },
            { name: "LinkedIn", auth: "oauth", authLabel: "Sign in with LinkedIn", authIcon: <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>, brandColor: "#0A66C2" },
            { name: "iMessage", auth: "apple", authLabel: "Sign in with Apple", authIcon: <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>, brandColor: "#000000" },
            { name: "Spotify", auth: "oauth", authLabel: "Sign in with Spotify", authIcon: <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>, brandColor: "#1DB954" },
            { name: "Apple Health", auth: "apple", authLabel: "Sign in with Apple", authIcon: <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>, brandColor: "#000000" },
          ];
          const service = allSources.find((s) => s.name === connectingService);
          if (!service) return null;
          const isApple = service.auth === "apple";
          return (
            <div
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setConnectingService(null)}
              onKeyDown={(e) => { if (e.key === "Escape") setConnectingService(null); }}
            >
              <div
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2 text-center">
                  Connect {connectingService}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-6">
                  {isApple
                    ? `Sign in with your Apple ID to sync ${connectingService} data with RecallMEM.`
                    : `Authorize RecallMEM to read your ${connectingService} data. We only read, never write or modify.`}
                </p>
                <div className="space-y-3">
                  <button
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-white font-medium text-sm transition-opacity hover:opacity-90"
                    style={{ backgroundColor: service.brandColor }}
                    onClick={() => setConnectingService(null)}
                  >
                    {service.authIcon}
                    {service.authLabel}
                  </button>
                  {!isApple && (
                    <button
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                      onClick={() => setConnectingService(null)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                      Sign in with Google
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-600 text-center mt-4">
                  Read-only access. Your data is processed locally through MooseStack and stored in your database.
                </p>
                <button
                  onClick={() => setConnectingService(null)}
                  className="w-full mt-3 px-4 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}

        <section>
          <h2 className="flex items-center justify-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-3">
            <UpdateIcon />
            Updates
          </h2>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            {updateInfo ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-sm text-zinc-900 dark:text-zinc-100">
                      Current version: <strong>v{updateInfo.currentVersion}</strong>
                    </div>
                    {updateInfo.updateAvailable && (
                      <div className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                        v{updateInfo.latestVersion} available
                      </div>
                    )}
                    {!updateInfo.updateAvailable && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        You&apos;re on the latest version
                      </div>
                    )}
                  </div>
                  {updateInfo.updateAvailable ? (
                    <button
                      onClick={runUpdate}
                      disabled={updating}
                      className="px-4 py-2 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50"
                    >
                      {updating ? "Updating..." : "Update now"}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        fetch("/api/update")
                          .then((r) => r.json())
                          .then((data: { currentVersion?: string; latestVersion?: string; updateAvailable?: boolean; changelog?: { version: string; date: string; notes: string }[] }) => {
                            if (data.currentVersion) {
                              setUpdateInfo({
                                currentVersion: data.currentVersion,
                                latestVersion: data.latestVersion || data.currentVersion,
                                updateAvailable: !!data.updateAvailable,
                                changelog: data.changelog || [],
                              });
                            }
                          });
                      }}
                      className="px-4 py-2 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Check for updates
                    </button>
                  )}
                </div>
                {updateResult && (
                  <div className={`text-sm p-3 rounded-md mt-2 ${
                    updateResult.includes("failed")
                      ? "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400"
                      : "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400"
                  }`}>
                    {updateResult}
                  </div>
                )}
                {/* Changelog — what you get if you upgrade */}
                {updateInfo.changelog.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
                      What&apos;s new since v{updateInfo.currentVersion}
                    </div>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {updateInfo.changelog.map((release) => (
                        <div key={release.version} className="border-l-2 border-emerald-400 dark:border-emerald-600 pl-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">v{release.version}</span>
                            {release.date && (
                              <span className="text-xs text-zinc-400">{release.date}</span>
                            )}
                          </div>
                          {release.notes && (
                            <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 whitespace-pre-wrap leading-relaxed">
                              {release.notes}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-3">
                  Updates pull the latest code, install dependencies, and run database migrations. Your chats, memory, brains, and API keys are never affected.
                </p>
              </div>
            ) : (
              <div className="text-sm text-zinc-500">Loading...</div>
            )}
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

function UpdateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function ConnectionsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <line x1="8" y1="12" x2="16" y2="12" />
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

interface UsageBreakdown {
  provider: string;
  service: string;
  total_units: number;
  unit_type: string;
  cost_cents: number;
}

interface UsagePeriod {
  cost_cents: number;
  breakdown: UsageBreakdown[];
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0.00";
  if (cents < 1) return `$${(cents / 100).toFixed(4)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatUnits(units: number, unitType: string): string {
  if (unitType === "ms") return `${(units / 60000).toFixed(1)} min`;
  if (unitType === "characters") return `${(units / 1000).toFixed(1)}K chars`;
  if (unitType === "tokens_in" || unitType === "tokens_out") return `${(units / 1000).toFixed(1)}K tokens`;
  return String(units);
}

function UsageSection() {
  const [usage, setUsage] = useState<{ today: UsagePeriod; thisWeek: UsagePeriod; thisMonth: UsagePeriod; allTime: UsagePeriod } | null>(null);
  const [period, setPeriod] = useState<"today" | "thisWeek" | "thisMonth" | "allTime" | "custom">("thisMonth");
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [customData, setCustomData] = useState<UsagePeriod | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (period !== "custom") return;
    fetch(`/api/usage?from=${customFrom}&to=${customTo}`)
      .then((r) => r.json())
      .then(setCustomData)
      .catch(() => {});
  }, [period, customFrom, customTo]);

  const data = period === "custom" ? customData : usage?.[period];

  return (
    <section>
      <h2 className="flex items-center justify-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20V10" />
          <path d="M18 20V4" />
          <path d="M6 20v-4" />
        </svg>
        Usage &amp; Estimated Costs
      </h2>
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        {!usage ? (
          <p className="text-sm text-zinc-400">Loading...</p>
        ) : (
          <>
            {/* Period tabs */}
            <div className="flex gap-1 mb-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
              {([["today", "Today"], ["thisWeek", "Week"], ["thisMonth", "Month"], ["allTime", "All"], ["custom", "Custom"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                    period === key
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {period === "custom" && (
              <div className="flex items-center gap-2 mb-4">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100"
                />
                <span className="text-zinc-400 text-sm">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100"
                />
              </div>
            )}

            {/* Total cost */}
            <div className="text-center mb-4">
              <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                {formatCost(data?.cost_cents || 0)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">estimated spend</div>
            </div>

            {/* Breakdown */}
            {data && data.breakdown.length > 0 ? (
              <div className="space-y-2">
                {data.breakdown.map((row, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        row.service === "chat" ? "bg-blue-500" : row.service === "tts" ? "bg-purple-500" : "bg-green-500"
                      }`} />
                      <span className="font-medium text-zinc-700 dark:text-zinc-300 capitalize">{row.provider}</span>
                      <span className="text-zinc-400 text-xs">{row.service.toUpperCase()}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-zinc-500 text-xs mr-2">{formatUnits(row.total_units, row.unit_type)}</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{formatCost(Number(row.cost_cents))}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400 text-center">No usage recorded yet for this period.</p>
            )}

            <p className="text-xs text-zinc-500 mt-4 leading-relaxed">
              Costs are estimates based on published API pricing. Token counts for chat are approximated (~4 chars per token). Check your provider dashboards for exact billing.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

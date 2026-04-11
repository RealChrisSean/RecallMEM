"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AppFooter } from "@/components/AppFooter";
import { Logo } from "@/components/Logo";

type ProviderType = "ollama" | "anthropic" | "openai" | "openai-compatible";

interface ProviderListItem {
  id: string;
  label: string;
  type: ProviderType;
  base_url: string | null;
  model: string;
  api_key_preview: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<ProviderType, string> = {
  ollama: "Ollama (local)",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  "openai-compatible": "OpenAI-compatible",
};

const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  ollama: "http://localhost:11434",
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  "openai-compatible": "",
};

const PRESET_HINTS: Record<ProviderType, string> = {
  ollama: "e.g. gemma4:26b, llama3:70b",
  anthropic: "e.g. claude-opus-4-6, claude-sonnet-4-6",
  openai: "e.g. gpt-5.4, gpt-5.4-mini",
  "openai-compatible":
    "e.g. llama-3.3-70b-versatile, mixtral-8x22b, anthropic/claude-opus-4-6",
};

// Curated list of known models per provider type. The user picks the friendly
// name from the dropdown and the API model ID gets filled in automatically.
// Update this when new models are released.
interface KnownModel {
  label: string;
  apiId: string;
}

const KNOWN_MODELS: Partial<Record<ProviderType, KnownModel[]>> = {
  anthropic: [
    { label: "Claude Opus 4.6", apiId: "claude-opus-4-6" },
    { label: "Claude Sonnet 4.6", apiId: "claude-sonnet-4-6" },
    { label: "Claude Haiku 4.5", apiId: "claude-haiku-4-5-20251001" },
    { label: "Claude Opus 4.5", apiId: "claude-opus-4-5" },
    { label: "Claude Sonnet 4.5", apiId: "claude-sonnet-4-5" },
    { label: "Claude Haiku 4", apiId: "claude-haiku-4-20250514" },
  ],
  openai: [
    { label: "GPT-5.4", apiId: "gpt-5.4" },
    { label: "GPT-5.4 Pro", apiId: "gpt-5.4-pro" },
    { label: "GPT-5.4 Mini", apiId: "gpt-5.4-mini" },
    { label: "GPT-5.4 Nano", apiId: "gpt-5.4-nano" },
    { label: "GPT-5 Mini", apiId: "gpt-5-mini" },
    { label: "GPT-5 Nano", apiId: "gpt-5-nano" },
    { label: "GPT-5", apiId: "gpt-5" },
    { label: "GPT-4.1", apiId: "gpt-4.1" },
  ],
};

const KEY_HELP: Record<ProviderType, { url: string; text: string } | null> = {
  ollama: null,
  anthropic: {
    url: "https://console.anthropic.com/settings/keys",
    text: "Get an Anthropic API key →",
  },
  openai: {
    url: "https://platform.openai.com/api-keys",
    text: "Get an OpenAI API key →",
  },
  "openai-compatible": {
    url: "",
    text: "Use any OpenAI-format endpoint (Groq, Together, OpenRouter, LM Studio, vLLM, Mistral, Fireworks, xAI, etc.). Get a key from your provider's dashboard.",
  },
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ProviderType>("anthropic");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS.anthropic);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const data = (await res.json()) as ProviderListItem[];
        setProviders(data);
      }
    } catch (err) {
      console.error("Failed to load providers:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setLabel("");
    setType("anthropic");
    setBaseUrl(DEFAULT_BASE_URLS.anthropic);
    setApiKey("");
    setModel("");
    setError(null);
    setTestResult(null);
  }

  function handleTypeChange(newType: ProviderType) {
    setType(newType);
    setBaseUrl(DEFAULT_BASE_URLS[newType]);
    setTestResult(null);
    // Clear model + label so the user picks fresh from the new provider's options
    setModel("");
    setLabel("");
  }

  // When the user picks a known model from the dropdown, auto-set the label
  // to the model's friendly name
  function handleKnownModelPick(apiId: string) {
    setModel(apiId);
    setTestResult(null);
    const known = KNOWN_MODELS[type]?.find((m) => m.apiId === apiId);
    if (known) setLabel(known.label);
  }

  // When the user types a free-text model (openai-compatible / ollama),
  // mirror it as the label
  function handleModelTextChange(value: string) {
    setModel(value);
    setLabel(value);
    setTestResult(null);
  }

  async function testConnection() {
    if (!model.trim()) {
      setTestResult({ ok: false, message: "Model name is required" });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          base_url: baseUrl.trim() || null,
          api_key: apiKey.trim() || null,
          model: model.trim(),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        reply?: string;
      };
      if (data.ok) {
        setTestResult({
          ok: true,
          message: `✓ Connection works. Model replied: "${data.reply || "(empty)"}"`,
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error || "Test failed",
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !model.trim()) {
      setError("Label and model are required");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          type,
          base_url: baseUrl.trim() || null,
          api_key: apiKey.trim() || null,
          model: model.trim(),
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setError(err.error || "Failed to save");
        return;
      }
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteProvider(id: string) {
    if (!confirm("Delete this provider?")) return;
    try {
      await fetch(`/api/providers/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }

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
            <div className="flex items-center gap-2 ml-3">
              <Logo size={18} className="text-zinc-900 dark:text-zinc-100" />
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Models &amp; Providers
              </h1>
            </div>
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          >
            + Add provider
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Built-in Ollama section */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
            Local (Ollama)
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Built in. Pick from Gemma 4 31B / 26B MoE / E4B / E2B in the chat
            header. Runs on your machine, no API key needed.
          </p>
        </div>

        {/* Custom providers list */}
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-3">
            Custom providers
          </h2>
          {providers.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
              No custom providers yet. Add one to use Claude, GPT, or any
              OpenAI-compatible endpoint.
            </div>
          ) : (
            <div className="space-y-2">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {p.label}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                        {TYPE_LABELS[p.type]}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Model: <code className="font-mono">{p.model}</code>
                    </div>
                    {p.base_url && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        URL: <code className="font-mono">{p.base_url}</code>
                      </div>
                    )}
                    {p.api_key_preview && (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        Key: <code className="font-mono">{p.api_key_preview}</code>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => deleteProvider(p.id)}
                    className="text-xs px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add form */}
        {showForm && (
          <form
            onSubmit={save}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Add provider
            </h2>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Provider type
              </label>
              <select
                value={type}
                onChange={(e) => handleTypeChange(e.target.value as ProviderType)}
                className="w-full text-sm px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
                <option value="openai-compatible">
                  OpenAI-compatible (Together, Groq, OpenRouter, LM Studio…)
                </option>
                <option value="ollama">Ollama (custom URL)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Model
              </label>
              {KNOWN_MODELS[type] ? (
                <>
                  <select
                    value={model}
                    onChange={(e) => handleKnownModelPick(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
                  >
                    <option value="">— Pick a model —</option>
                    {KNOWN_MODELS[type]?.map((m) => (
                      <option key={m.apiId} value={m.apiId}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {model && (
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
                      API model ID:{" "}
                      <code className="font-mono">{model}</code>
                    </p>
                  )}
                </>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => handleModelTextChange(e.target.value)}
                  placeholder={PRESET_HINTS[type]}
                  className="w-full text-sm font-mono px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
                />
              )}
            </div>

            {(type === "openai-compatible" || type === "ollama") && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full text-sm font-mono px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
                />
              </div>
            )}

            {type !== "ollama" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    API key
                  </label>
                  {KEY_HELP[type]?.url && (
                    <a
                      href={KEY_HELP[type]?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-2"
                    >
                      {KEY_HELP[type]?.text}
                    </a>
                  )}
                </div>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    type === "anthropic"
                      ? "sk-ant-..."
                      : type === "openai"
                      ? "sk-..."
                      : "sk-... or your provider's key format"
                  }
                  className="w-full text-sm font-mono px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
                />
                {type === "openai-compatible" && KEY_HELP[type] && (
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
                    {KEY_HELP[type]?.text}
                  </p>
                )}
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">
                  Stored locally in your Postgres database. Never sent anywhere
                  except the provider you select.
                </p>
              </div>
            )}

            {/* Test result */}
            {testResult && (
              <div
                className={`text-xs px-3 py-2 rounded-md border ${
                  testResult.ok
                    ? "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300"
                    : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300"
                }`}
              >
                {testResult.message}
              </div>
            )}

            {error && (
              <div className="text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={testConnection}
                disabled={isTesting || isSaving}
                className="px-4 py-2 text-sm font-medium rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                {isTesting ? "Testing..." : "Test connection"}
              </button>
              <button
                type="submit"
                disabled={isSaving || isTesting}
                className="px-4 py-2 text-sm font-medium rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save provider"}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                className="px-4 py-2 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Privacy note */}
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          <p className="font-semibold mb-1">⚠ Privacy note</p>
          <p>
            When you use a cloud provider (Anthropic, OpenAI, etc.), your
            conversations leave your machine. Your facts, profile, and rules
            still get sent as part of the system prompt. This breaks the
            local-only privacy guarantee for those specific conversations.
            Use Ollama for anything you want to keep fully private.
          </p>
        </div>

        <AppFooter variant="page" />
      </div>
    </div>
  );
}

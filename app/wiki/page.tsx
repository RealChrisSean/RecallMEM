"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Database,
  FileUp,
  GitBranch,
  MessageCircleQuestion,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import {
  DEFAULT_PROVIDER_MODEL_MODE,
  isProviderModelMode,
  MODEL_OPTIONS,
  type ModelId,
  type ProviderModelMode,
} from "@/lib/llm-config";

const WIKI_MODEL_STORAGE_KEY = "recallmem_wiki_selected_model";

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

const WIKI_PROVIDER_MODELS: Partial<
  Record<ProviderType, { label: string; apiId: string; mode?: ProviderModelMode }[]>
> = {
  anthropic: [
    { label: "Claude Sonnet 4.6", apiId: "claude-sonnet-4-6" },
    { label: "Claude Haiku 4.5", apiId: "claude-haiku-4-5-20251001" },
  ],
  openai: [
    { label: "GPT-4o Mini", apiId: "gpt-4o-mini" },
  ],
};

interface WikiSource {
  id: string;
  title: string;
  source_kind: string;
  uri: string | null;
  source_ref: string | null;
  last_ingested_at: string;
  document_count: number;
  chunk_count: number;
}

interface WikiChunk {
  id: string;
  source_title: string;
  uri: string | null;
  source_ref: string | null;
  path: string;
  chunk_text: string;
  line_start: number;
  line_end: number;
  citation: string;
  match_reason: string;
  distance: number | null;
}

interface WikiCitation {
  marker: string;
  chunkId: string;
  lineStart: number;
  lineEnd: number;
  citation: string;
  quote: string | null;
  url: string | null;
}

interface WikiAnswer {
  answer: string;
  citations: WikiCitation[];
  chunks: WikiChunk[];
  notInSources: boolean;
  llmUsed: boolean;
  validationFailed?: boolean;
}

interface ImportResult {
  repo: string;
  ok: boolean;
  sha?: string;
  filesConsidered?: number;
  filesIngested?: number;
  changed?: number;
  unchanged?: number;
  chunks?: number;
  embedded?: number;
  error?: string;
  errors?: string[];
}

export default function WikiPage() {
  const [brain, setBrain] = useState("sprites");
  const [sources, setSources] = useState<WikiSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sourceTitle, setSourceTitle] = useState("Sprites source note");
  const [sourceUri, setSourceUri] = useState("");
  const [sourcePath, setSourcePath] = useState("notes/source.md");
  const [sourceText, setSourceText] = useState("");
  const [question, setQuestion] = useState("Why create an LLM wiki for Sprites?");
  const [socratic, setSocratic] = useState(false);
  const [answer, setAnswer] = useState<WikiAnswer | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>("gemma4:26b");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedProviderModel, setSelectedProviderModel] = useState<string | null>(null);
  const [selectedProviderModelMode, setSelectedProviderModelMode] =
    useState<ProviderModelMode>(DEFAULT_PROVIDER_MODEL_MODE);

  const chunkCount = useMemo(
    () => sources.reduce((sum, source) => sum + Number(source.chunk_count || 0), 0),
    [sources]
  );

  const loadSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const res = await fetch(`/api/wiki/sources?brain=${encodeURIComponent(brain)}`);
      const data = (await res.json()) as { sources?: WikiSource[] };
      setSources(data.sources || []);
    } finally {
      setLoadingSources(false);
    }
  }, [brain]);

  useEffect(() => {
    loadSources().catch(() => setStatus("Could not load wiki sources."));
  }, [loadSources]);

  useEffect(() => {
    const saved = localStorage.getItem(WIKI_MODEL_STORAGE_KEY);
    if (!saved) return;
    if (saved.startsWith("provider:")) {
      const [providerId, model, modelMode] = saved.slice("provider:".length).split("::");
      if (!providerId || !model) return;
      setSelectedProviderId(providerId);
      setSelectedProviderModel(model);
      setSelectedProviderModelMode(
        isProviderModelMode(modelMode) ? modelMode : DEFAULT_PROVIDER_MODEL_MODE
      );
      return;
    }
    if (saved.startsWith("ollama:")) {
      const model = saved.slice("ollama:".length);
      if (MODEL_OPTIONS.some((option) => option.id === model)) {
        setSelectedModel(model as ModelId);
        setSelectedProviderId(null);
        setSelectedProviderModel(null);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProviders() {
      try {
        const res = await fetch("/api/providers");
        if (!res.ok) throw new Error("Failed to load providers");
        const data = (await res.json()) as ProviderListItem[];
        if (!cancelled) setProviders(data);
      } catch {
        if (!cancelled) setProviders([]);
      } finally {
        if (!cancelled) setProvidersLoaded(true);
      }
    }
    loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedProviderId) {
      localStorage.setItem(
        WIKI_MODEL_STORAGE_KEY,
        `provider:${selectedProviderId}::${selectedProviderModel || ""}::${selectedProviderModelMode}`
      );
    } else {
      localStorage.setItem(WIKI_MODEL_STORAGE_KEY, `ollama:${selectedModel}`);
    }
  }, [selectedModel, selectedProviderId, selectedProviderModel, selectedProviderModelMode]);

  useEffect(() => {
    if (!providersLoaded || !selectedProviderId) return;
    if (!providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(null);
      setSelectedProviderModel(null);
      setSelectedProviderModelMode(DEFAULT_PROVIDER_MODEL_MODE);
    }
  }, [providers, providersLoaded, selectedProviderId]);

  async function seedBrief() {
    setBusy("seed");
    setStatus(null);
    try {
      const res = await fetch("/api/wiki/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brain }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Seed failed");
      setStatus(`Seeded ${data.result.title}: ${data.result.chunks} chunk(s).`);
      await loadSources();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(null);
    }
  }

  async function importSpritesRepos() {
    setBusy("github");
    setStatus("Importing public Sprites repositories...");
    setImportResults([]);
    try {
      const res = await fetch("/api/wiki/import-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brain }),
      });
      const data = (await res.json()) as { results?: ImportResult[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResults(data.results || []);
      setStatus("GitHub import finished.");
      await loadSources();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  async function ingestSource() {
    setBusy("ingest");
    setStatus(null);
    try {
      const res = await fetch("/api/wiki/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brain,
          title: sourceTitle,
          sourceKind: "manual",
          uri: sourceUri || null,
          path: sourcePath,
          text: sourceText,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Ingest failed");
      setStatus(
        `${data.result.unchanged ? "No changes in" : "Ingested"} ${data.result.path}: ${data.result.chunks} chunk(s).`
      );
      await loadSources();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setBusy(null);
    }
  }

  async function askWiki() {
    setBusy("query");
    setAnswer(null);
    setStatus(null);
    const modelSelection = selectedProviderId
      ? {
          providerId: selectedProviderId,
          model: selectedProviderModel || undefined,
          providerModelMode: selectedProviderModelMode,
        }
      : { model: selectedModel };
    try {
      const res = await fetch("/api/wiki/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brain, question, socratic, ...modelSelection }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Query failed");
      setAnswer(data as WikiAnswer);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Query failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setSourceTitle(file.name.replace(/\.[^.]+$/, "") || file.name);
    setSourcePath(file.name);
    setSourceText(text);
  }

  function handleModelChange(value: string) {
    if (value === "__add_provider__") {
      window.location.href = "/providers";
      return;
    }
    if (value.startsWith("provider:")) {
      const [providerId, model, modelMode] = value.slice("provider:".length).split("::");
      if (!providerId || !model) return;
      setSelectedProviderId(providerId);
      setSelectedProviderModel(model);
      setSelectedProviderModelMode(
        isProviderModelMode(modelMode) ? modelMode : DEFAULT_PROVIDER_MODEL_MODE
      );
      return;
    }
    if (value.startsWith("ollama:")) {
      const model = value.slice("ollama:".length);
      if (MODEL_OPTIONS.some((option) => option.id === model)) {
        setSelectedModel(model as ModelId);
        setSelectedProviderId(null);
        setSelectedProviderModel(null);
        setSelectedProviderModelMode(DEFAULT_PROVIDER_MODEL_MODE);
      }
    }
  }

  const providersByType = new Map<ProviderType, ProviderListItem>();
  for (const provider of providers) {
    if (!providersByType.has(provider.type)) providersByType.set(provider.type, provider);
  }
  const selectedModelValue = selectedProviderId
    ? `provider:${selectedProviderId}::${selectedProviderModel || ""}::${selectedProviderModelMode}`
    : `ollama:${selectedModel}`;

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={32} />
            <span className="text-sm font-semibold tracking-wide">RecallMEM Wiki</span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Database className="h-4 w-4" />
            <span>{sources.length} sources</span>
            <span>{chunkCount} chunks</span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4">
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Ask Wiki</h2>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={socratic}
                onChange={(e) => setSocratic(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <MessageCircleQuestion className="h-4 w-4" />
              Socratic
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,340px)]">
            <div>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="h-32 w-full resize-none rounded-md border border-zinc-200 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 lg:h-40"
              />
              <button
                type="button"
                onClick={askWiki}
                disabled={busy !== null || !question.trim()}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
              >
                <Search className="h-4 w-4" />
                Ask
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium uppercase text-zinc-500">
                Brain
              </label>
              <input
                value={brain}
                onChange={(e) => setBrain(e.target.value)}
                className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-700"
              />

              <label className="block text-xs font-medium uppercase text-zinc-500">
                Answer model
              </label>
              <select
                value={selectedModelValue}
                onChange={(e) => handleModelChange(e.target.value)}
                disabled={busy !== null}
                className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-700"
              >
                <optgroup label="Local">
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.id} value={`ollama:${option.id}`}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
                {(["anthropic", "openai"] as const).map((type) => {
                  const provider = providersByType.get(type);
                  const models = WIKI_PROVIDER_MODELS[type] || [];
                  if (!provider || models.length === 0) return null;
                  return (
                    <optgroup
                      key={type}
                      label={type === "anthropic" ? "Anthropic" : "OpenAI"}
                    >
                      {models.map((model) => (
                        <option
                          key={`${provider.id}-${model.apiId}-${model.mode || DEFAULT_PROVIDER_MODEL_MODE}`}
                          value={`provider:${provider.id}::${model.apiId}::${model.mode || DEFAULT_PROVIDER_MODEL_MODE}`}
                        >
                          {model.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
                {providers
                  .filter((provider) => provider.type === "openai-compatible")
                  .map((provider) => (
                    <optgroup key={provider.id} label={provider.label}>
                      <option
                        value={`provider:${provider.id}::${provider.model}::${DEFAULT_PROVIDER_MODEL_MODE}`}
                      >
                        {provider.model}
                      </option>
                    </optgroup>
                  ))}
                <optgroup label="">
                  <option value="__add_provider__">Add provider...</option>
                </optgroup>
              </select>
            </div>
          </div>
        </section>

        {(status || busy) && (
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {busy ? `${busy}...` : status}
          </div>
        )}

        {answer && (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span>{answer.llmUsed ? "LLM answer" : "grounded fallback"}</span>
              {answer.validationFailed && <span>citation validation fallback</span>}
              {answer.notInSources && <span>not in sources</span>}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-6">{answer.answer}</div>

            {answer.citations.length > 0 && (
              <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <h3 className="mb-2 text-sm font-semibold">Citations</h3>
                <div className="space-y-2">
                  {answer.citations.map((citation) => (
                    <div
                      key={`${citation.marker}-${citation.chunkId}-${citation.lineStart}-${citation.lineEnd}`}
                      className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                    >
                      <div className="font-medium">
                        {citation.url ? (
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:decoration-zinc-600 dark:hover:decoration-zinc-100"
                          >
                            [{citation.marker}] {citation.citation}
                          </a>
                        ) : (
                          <>
                            [{citation.marker}] {citation.citation}
                          </>
                        )}
                      </div>
                      {citation.quote && (
                        <div className="mt-1 text-xs text-zinc-500">{citation.quote}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-3 text-sm font-semibold">Source Setup</h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={seedBrief}
                  disabled={busy !== null}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
                >
                  <BookOpen className="h-4 w-4" />
                  Seed brief
                </button>
                <button
                  type="button"
                  onClick={importSpritesRepos}
                  disabled={busy !== null}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <GitBranch className="h-4 w-4" />
                  Import repos
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Sources</h2>
                <button
                  type="button"
                  onClick={loadSources}
                  disabled={loadingSources || busy !== null}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 disabled:opacity-50 dark:border-zinc-700"
                  title="Refresh sources"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-80 space-y-2 overflow-auto">
                {sources.length === 0 ? (
                  <div className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-700">
                    No sources yet.
                  </div>
                ) : (
                  sources.map((source) => (
                    <div
                      key={source.id}
                      className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{source.title}</div>
                          <div className="mt-1 truncate text-xs text-zinc-500">
                            {source.source_kind}
                            {source.source_ref ? ` @ ${source.source_ref.slice(0, 10)}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-zinc-500">
                          <div>{source.document_count} docs</div>
                          <div>{source.chunk_count} chunks</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Add Source</h2>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium dark:border-zinc-700">
                <FileUp className="h-4 w-4" />
                File
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                placeholder="Source title"
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <input
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                placeholder="path/origin.md"
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>
            <input
              value={sourceUri}
              onChange={(e) => setSourceUri(e.target.value)}
              placeholder="Source URL or repo"
              className="mt-2 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Paste source text here"
              className="mt-2 h-56 w-full resize-none rounded-md border border-zinc-200 bg-white p-3 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="button"
              onClick={ingestSource}
              disabled={busy !== null || !sourceText.trim()}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
            >
              <Upload className="h-4 w-4" />
              Ingest
            </button>
          </section>
        </div>

        {importResults.length > 0 && (
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold">Import Results</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {importResults.map((result) => (
                <div
                  key={result.repo}
                  className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <div className="font-medium">{result.repo}</div>
                  {result.ok ? (
                    <div className="mt-1 text-xs text-zinc-500">
                      {result.sha?.slice(0, 10)} · {result.changed} changed · {result.unchanged} unchanged · {result.chunks} chunks
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-red-600">{result.error}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

// Embedding module — supports two backends:
// 1. Ollama EmbeddingGemma (768-dim, local, free)
// 2. OpenAI text-embedding-3-small (256-dim, cloud, $0.02/1M tokens)
//
// Uses OpenAI when an OpenAI provider key exists, falls back to Ollama.

import { listProviders } from "@/lib/providers";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "embeddinggemma";

// Cache the OpenAI key check for 60s
let _oaiKeyCache: { key: string | null; time: number } = { key: null, time: 0 };

async function getOpenAIKey(): Promise<string | null> {
  if (Date.now() - _oaiKeyCache.time < 60000) return _oaiKeyCache.key;
  const providers = await listProviders();
  const openai = providers.find((p) => p.type === "openai" && p.api_key);
  _oaiKeyCache = { key: openai?.api_key || null, time: Date.now() };
  return _oaiKeyCache.key;
}

export type EmbedResult = {
  vector: number[];
  source: "openai" | "ollama";
};

export async function embed(text: string): Promise<number[]> {
  const result = await embedWithSource(text);
  return result.vector;
}

export async function embedWithSource(text: string): Promise<EmbedResult> {
  const oaiKey = await getOpenAIKey();
  if (oaiKey) return embedOpenAI(text, oaiKey);
  return embedOllama(text);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results = await embedBatchWithSource(texts);
  return results.map((r) => r.vector);
}

export async function embedBatchWithSource(texts: string[]): Promise<EmbedResult[]> {
  const oaiKey = await getOpenAIKey();
  if (oaiKey) return embedBatchOpenAI(texts, oaiKey);
  return embedBatchOllama(texts);
}

export async function getEmbeddingSource(): Promise<"openai" | "ollama"> {
  const oaiKey = await getOpenAIKey();
  return oaiKey ? "openai" : "ollama";
}

// --- OpenAI ---

async function embedOpenAI(text: string, apiKey: string): Promise<EmbedResult> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 256,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI embedding failed: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return { vector: data.data[0].embedding, source: "openai" };
}

async function embedBatchOpenAI(texts: string[], apiKey: string): Promise<EmbedResult[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
      dimensions: 256,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI embedding failed: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  // OpenAI returns in order but let's sort by index to be safe
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => ({ vector: d.embedding, source: "openai" as const }));
}

// --- Ollama ---

async function embedOllama(text: string): Promise<EmbedResult> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return { vector: data.embeddings[0], source: "ollama" };
}

async function embedBatchOllama(texts: string[]): Promise<EmbedResult[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings.map((e) => ({ vector: e, source: "ollama" }));
}

import "server-only";

import { query, queryOne, toVectorString, getBaseUserId } from "@/lib/db";
import {
  embedBatchWithSource,
  embedWithSource,
  embeddingColumnForSource,
} from "@/lib/embeddings";
import { chat, type ChatMessage } from "@/lib/llm";
import type { ProviderModelMode } from "@/lib/llm-config";
import { sqlLikePattern, type MemoryMatchReason } from "@/lib/search";
import {
  brainUserId,
  chunkSourceText,
  citationLabel,
  countLines,
  normalizeBrainName,
  sha256,
  validateWikiCitations,
  type WikiCitationProposal,
  type WikiSourceKind,
  type WikiSourceInput,
} from "@/lib/wiki-core";

export interface WikiSourceRow {
  id: string;
  user_id: string;
  brain_name: string;
  title: string;
  source_kind: string;
  uri: string | null;
  source_ref: string | null;
  content_hash: string | null;
  last_ingested_at: Date;
  created_at: Date;
  updated_at: Date;
  document_count: number;
  chunk_count: number;
}

export interface WikiSearchResult {
  id: string;
  source_id: string;
  document_id: string;
  source_title: string;
  source_kind: string;
  uri: string | null;
  source_ref: string | null;
  path: string;
  chunk_text: string;
  line_start: number;
  line_end: number;
  section_title: string | null;
  citation: string;
  distance: number | null;
  text_rank: number | null;
  match_reason: MemoryMatchReason;
}

export interface WikiIngestResult {
  sourceId: string;
  documentId: string;
  brain: string;
  title: string;
  path: string;
  unchanged: boolean;
  chunks: number;
  embedded: number;
  embeddingError?: string;
}

export interface WikiAnswerCitation {
  marker: string;
  chunkId: string;
  lineStart: number;
  lineEnd: number;
  citation: string;
  quote: string | null;
  url: string | null;
}

export interface WikiAnswer {
  answer: string;
  citations: WikiAnswerCitation[];
  chunks: WikiSearchResult[];
  notInSources: boolean;
  llmUsed: boolean;
  validationFailed?: boolean;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export { json as wikiJson };

export async function ensureWikiBrain(brain: string): Promise<string> {
  const baseUserId = await getBaseUserId();
  const normalizedBrain = normalizeBrainName(brain);
  if (normalizedBrain !== "default") {
    await query(
      `INSERT INTO s2m_brains (user_id, name, emoji)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name) DO NOTHING`,
      [baseUserId, normalizedBrain, "📚"]
    );
  }
  return brainUserId(baseUserId, normalizedBrain);
}

export async function listWikiSources(brain: string): Promise<WikiSourceRow[]> {
  const userId = await ensureWikiBrain(brain);
  const brainName = normalizeBrainName(brain);
  return query<WikiSourceRow>(
    `SELECT s.*,
            COUNT(DISTINCT d.id)::int AS document_count,
            COUNT(DISTINCT c.id)::int AS chunk_count
     FROM s2m_wiki_sources s
     LEFT JOIN s2m_wiki_documents d ON d.source_id = s.id
     LEFT JOIN s2m_wiki_chunks c ON c.source_id = s.id
     WHERE s.user_id = $1 AND s.brain_name = $2
     GROUP BY s.id
     ORDER BY s.updated_at DESC`,
    [userId, brainName]
  );
}

export async function ingestWikiSource(input: WikiSourceInput): Promise<WikiIngestResult> {
  const brainName = normalizeBrainName(input.brain);
  const userId = await ensureWikiBrain(brainName);
  const title = input.title.trim();
  const text = input.text.replace(/\r\n/g, "\n").trim();
  const sourceKind = input.sourceKind || "manual";
  const uri = input.uri?.trim() || null;
  const sourceRef = input.sourceRef?.trim() || null;
  const path = input.path?.trim() || `${title || "source"}.md`;

  if (!title) throw new Error("Source title is required");
  if (!text) throw new Error("Source text is required");

  const sourceHash = sha256(`${title}\n${uri || ""}\n${sourceRef || ""}\n${path}\n${text}`);
  const documentHash = sha256(text);

  let source = await queryOne<{ id: string; content_hash: string | null }>(
    `SELECT id, content_hash
     FROM s2m_wiki_sources
     WHERE user_id = $1
       AND brain_name = $2
       AND title = $3
       AND coalesce(uri, '') = coalesce($4, '')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, brainName, title, uri]
  );

  if (!source) {
    source = await queryOne<{ id: string; content_hash: string | null }>(
      `INSERT INTO s2m_wiki_sources (
         user_id, brain_name, title, source_kind, uri, source_ref, content_hash
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, content_hash`,
      [userId, brainName, title, sourceKind, uri, sourceRef, sourceHash]
    );
  }
  if (!source) throw new Error("Failed to create wiki source");

  const existingDocument = await queryOne<{ id: string; content_hash: string }>(
    `SELECT id, content_hash
     FROM s2m_wiki_documents
     WHERE source_id = $1 AND path = $2`,
    [source.id, path]
  );

  if (existingDocument?.content_hash === documentHash) {
    const rows = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM s2m_wiki_chunks WHERE document_id = $1`,
      [existingDocument.id]
    );
    await touchSource(source.id, sourceHash, sourceRef);
    return {
      sourceId: source.id,
      documentId: existingDocument.id,
      brain: brainName,
      title,
      path,
      unchanged: true,
      chunks: Number(rows?.count || 0),
      embedded: 0,
    };
  }

  const document = existingDocument
    ? await queryOne<{ id: string }>(
        `UPDATE s2m_wiki_documents
         SET title = $3,
             uri = $4,
             source_ref = $5,
             content_hash = $6,
             line_count = $7,
             updated_at = NOW()
         WHERE id = $1 AND source_id = $2
         RETURNING id`,
        [existingDocument.id, source.id, title, uri, sourceRef, documentHash, countLines(text)]
      )
    : await queryOne<{ id: string }>(
        `INSERT INTO s2m_wiki_documents (
           user_id, source_id, title, path, uri, source_ref, content_hash, line_count
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [userId, source.id, title, path, uri, sourceRef, documentHash, countLines(text)]
      );

  if (!document) throw new Error("Failed to create wiki document");

  await query(`DELETE FROM s2m_wiki_chunks WHERE document_id = $1`, [document.id]);

  const chunks = chunkSourceText(text);
  if (chunks.length === 0) {
    await touchSource(source.id, sourceHash, sourceRef);
    return {
      sourceId: source.id,
      documentId: document.id,
      brain: brainName,
      title,
      path,
      unchanged: false,
      chunks: 0,
      embedded: 0,
    };
  }

  let vectors: { vector: number[]; source: "openai" | "ollama" }[] = [];
  let embeddingError: string | undefined;
  try {
    vectors = await embedBatchWithSource(chunks.map((chunk) => chunk.chunkText));
  } catch (err) {
    embeddingError = err instanceof Error ? err.message : String(err);
  }

  const embedded = vectors.length === chunks.length ? chunks.length : 0;
  const embeddingColumn = embedded > 0 ? embeddingColumnForSource(vectors[0].source) : null;

  for (const chunk of chunks) {
    const citation = citationLabel({
      sourceTitle: title,
      path,
      sourceRef,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
    });

    if (embeddingColumn) {
      await query(
        `INSERT INTO s2m_wiki_chunks (
           user_id, source_id, document_id, chunk_index, chunk_text,
           line_start, line_end, section_title, citation, content_hash, ${embeddingColumn}
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)`,
        [
          userId,
          source.id,
          document.id,
          chunk.chunkIndex,
          chunk.chunkText,
          chunk.lineStart,
          chunk.lineEnd,
          chunk.sectionTitle,
          citation,
          chunk.contentHash,
          toVectorString(vectors[chunk.chunkIndex].vector),
        ]
      );
    } else {
      await query(
        `INSERT INTO s2m_wiki_chunks (
           user_id, source_id, document_id, chunk_index, chunk_text,
           line_start, line_end, section_title, citation, content_hash
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          source.id,
          document.id,
          chunk.chunkIndex,
          chunk.chunkText,
          chunk.lineStart,
          chunk.lineEnd,
          chunk.sectionTitle,
          citation,
          chunk.contentHash,
        ]
      );
    }
  }

  await touchSource(source.id, sourceHash, sourceRef);

  return {
    sourceId: source.id,
    documentId: document.id,
    brain: brainName,
    title,
    path,
    unchanged: false,
    chunks: chunks.length,
    embedded,
    embeddingError,
  };
}

async function touchSource(
  sourceId: string,
  contentHash: string,
  sourceRef: string | null
) {
  await query(
    `UPDATE s2m_wiki_sources
     SET content_hash = $2,
         source_ref = COALESCE($3, source_ref),
         last_ingested_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [sourceId, contentHash, sourceRef]
  );
}

export async function searchWikiChunks(
  brain: string,
  question: string,
  limit = 8,
  opts: { sourceKinds?: WikiSourceKind[] } = {}
): Promise<WikiSearchResult[]> {
  const needle = question.trim();
  if (!needle) return [];

  const userId = await ensureWikiBrain(brain);
  const like = sqlLikePattern(needle);
  const sourceKinds = opts.sourceKinds?.length ? opts.sourceKinds : null;

  const keywordRows = await query<WikiSearchResult>(
    `WITH needle AS (
       SELECT websearch_to_tsquery('simple', $2) AS query
     )
     SELECT c.id,
            c.source_id,
            c.document_id,
            s.title AS source_title,
            s.source_kind,
            d.uri,
            d.source_ref,
            d.path,
            c.chunk_text,
            c.line_start,
            c.line_end,
            c.section_title,
            c.citation,
            NULL::double precision AS distance,
            ts_rank_cd(to_tsvector('simple', c.chunk_text), needle.query) AS text_rank,
            'keyword' AS match_reason
     FROM s2m_wiki_chunks c
     JOIN s2m_wiki_sources s ON s.id = c.source_id
     JOIN s2m_wiki_documents d ON d.id = c.document_id,
          needle
     WHERE c.user_id = $1
       AND ($5::text[] IS NULL OR s.source_kind = ANY($5::text[]))
       AND (
         to_tsvector('simple', c.chunk_text) @@ needle.query
         OR c.chunk_text ILIKE $3 ESCAPE '\\'
         OR d.path ILIKE $3 ESCAPE '\\'
       )
     ORDER BY
       CASE WHEN c.chunk_text ILIKE $3 ESCAPE '\\' OR d.path ILIKE $3 ESCAPE '\\' THEN 0 ELSE 1 END,
       text_rank DESC,
       c.created_at DESC
     LIMIT $4`,
    [userId, needle, like, limit, sourceKinds]
  );

  let semanticRows: WikiSearchResult[] = [];
  try {
    const result = await embedWithSource(needle);
    const col = embeddingColumnForSource(result.source);
    semanticRows = await query<WikiSearchResult>(
      `SELECT c.id,
              c.source_id,
              c.document_id,
              s.title AS source_title,
              s.source_kind,
              d.uri,
              d.source_ref,
              d.path,
              c.chunk_text,
              c.line_start,
              c.line_end,
              c.section_title,
              c.citation,
              c.${col} <=> $1::vector AS distance,
              NULL::real AS text_rank,
              'semantic' AS match_reason
       FROM s2m_wiki_chunks c
       JOIN s2m_wiki_sources s ON s.id = c.source_id
       JOIN s2m_wiki_documents d ON d.id = c.document_id
       WHERE c.user_id = $2
         AND c.${col} IS NOT NULL
         AND ($4::text[] IS NULL OR s.source_kind = ANY($4::text[]))
       ORDER BY distance ASC
       LIMIT $3`,
      [toVectorString(result.vector), userId, limit, sourceKinds]
    );
  } catch {
    semanticRows = [];
  }

  const merged: WikiSearchResult[] = [];
  const seen = new Set<string>();
  for (const row of [...keywordRows, ...semanticRows]) {
    if (seen.has(row.id)) continue;
    if (
      row.match_reason === "semantic" &&
      row.distance !== null &&
      row.distance > 0.58 &&
      keywordRows.length === 0
    ) {
      continue;
    }
    seen.add(row.id);
    merged.push(row);
    if (merged.length >= limit) break;
  }
  return merged;
}

export async function answerWikiQuestion(opts: {
  brain: string;
  question: string;
  socratic?: boolean;
  providerId?: string;
  model?: string;
  providerModelMode?: ProviderModelMode;
  publicSourcesOnly?: boolean;
}): Promise<WikiAnswer> {
  const chunks = await searchWikiChunks(opts.brain, opts.question, 8, {
    sourceKinds: opts.publicSourcesOnly ? ["repo", "url"] : undefined,
  });
  if (chunks.length === 0) {
    return {
      answer: "I don't have that in this brain's sources.",
      citations: [],
      chunks: [],
      notInSources: true,
      llmUsed: false,
    };
  }

  const messages = buildWikiPrompt(opts.question, chunks, !!opts.socratic);
  try {
    const raw = await chat(messages, {
      providerId: opts.providerId,
      model: opts.model,
      providerModelMode: opts.providerModelMode,
    });
    const parsed = parseWikiAnswerJson(raw);
    if (isNotInSourcesAnswer(parsed.answer)) {
      return {
        answer: "I don't have that in this brain's sources.",
        citations: [],
        chunks,
        notInSources: true,
        llmUsed: true,
      };
    }
    const citations = validateWikiCitations(parsed.citations, chunks).map((citation) =>
      withCitationUrl(citation, chunks)
    );

    if (!parsed.answer.trim() || citations.length === 0) {
      if (isWeakSemanticOnlyMatch(chunks)) {
        return {
          answer: "I don't have that in this brain's sources.",
          citations: [],
          chunks,
          notInSources: true,
          llmUsed: true,
          validationFailed: true,
        };
      }
      return {
        ...fallbackWikiAnswer(opts.question, chunks, !!opts.socratic),
        validationFailed: true,
      };
    }

    return {
      answer: parsed.answer.trim(),
      citations,
      chunks,
      notInSources: false,
      llmUsed: true,
    };
  } catch {
    if (isWeakSemanticOnlyMatch(chunks)) {
      return {
        answer: "I don't have that in this brain's sources.",
        citations: [],
        chunks,
        notInSources: true,
        llmUsed: false,
        validationFailed: true,
      };
    }
    return fallbackWikiAnswer(opts.question, chunks, !!opts.socratic);
  }
}

function buildWikiPrompt(
  question: string,
  chunks: WikiSearchResult[],
  socratic: boolean
): ChatMessage[] {
  const sourceBlock = chunks
    .map((chunk, index) => {
      const marker = `C${index + 1}`;
      return [
        `<source marker="${marker}" chunk_id="${chunk.id}">`,
        `citation: ${chunk.citation}`,
        `lines: ${chunk.line_start}-${chunk.line_end}`,
        chunk.chunk_text,
        "</source>",
      ].join("\n");
    })
    .join("\n\n");

  const style = socratic
    ? "Use a Socratic teaching style: ask one or two probing questions before giving the source-grounded explanation. Keep every factual claim tied to cited source chunks."
    : "Answer directly and concisely.";

  return [
    {
      role: "system",
      content: [
        "You are RecallMEM Wiki Mode, a source-grounded documentation assistant.",
        "Use ONLY the supplied source chunks. Do not use general knowledge.",
        "If the sources do not answer the question, answer exactly: I don't have that in this brain's sources.",
        style,
        "Return strict JSON only, with this shape:",
        `{"answer":"...","citations":[{"marker":"C1","chunkId":"uuid","lineStart":1,"lineEnd":3,"quote":"exact text from those lines"}]}`,
        "Every citation must use a supplied chunk_id and a line range inside that chunk.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [`Question: ${question}`, "", "Sources:", sourceBlock].join("\n"),
    },
  ];
}

function parseWikiAnswerJson(raw: string): {
  answer: string;
  citations: WikiCitationProposal[];
} {
  const trimmed = raw.trim();
  if (isNotInSourcesAnswer(trimmed)) {
    return { answer: "I don't have that in this brain's sources.", citations: [] };
  }
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0] || "{}";
  const parsed = JSON.parse(jsonText) as {
    answer?: unknown;
    citations?: unknown;
  };
  const citations = Array.isArray(parsed.citations)
    ? parsed.citations
        .map((item) => normalizeCitationProposal(item))
        .filter((item): item is WikiCitationProposal => !!item)
    : [];
  return {
    answer: typeof parsed.answer === "string" ? parsed.answer : "",
    citations,
  };
}

function normalizeCitationProposal(value: unknown): WikiCitationProposal | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const chunkId = typeof obj.chunkId === "string"
    ? obj.chunkId
    : typeof obj.chunk_id === "string"
      ? obj.chunk_id
      : "";
  const lineStart = typeof obj.lineStart === "number"
    ? obj.lineStart
    : typeof obj.line_start === "number"
      ? obj.line_start
      : null;
  const lineEnd = typeof obj.lineEnd === "number"
    ? obj.lineEnd
    : typeof obj.line_end === "number"
      ? obj.line_end
      : null;
  if (!chunkId || lineStart === null || lineEnd === null) return null;
  return {
    marker: typeof obj.marker === "string" ? obj.marker : undefined,
    chunkId,
    lineStart,
    lineEnd,
    quote: typeof obj.quote === "string" ? obj.quote : undefined,
  };
}

function isNotInSourcesAnswer(answer: string): boolean {
  return answer.trim().toLowerCase().includes("don't have that in this brain's sources");
}

function isWeakSemanticOnlyMatch(chunks: WikiSearchResult[]): boolean {
  return chunks.length > 0 && chunks.every(
    (chunk) =>
      chunk.match_reason === "semantic" &&
      chunk.distance !== null &&
      chunk.distance > 0.58
  );
}

function fallbackWikiAnswer(
  question: string,
  chunks: WikiSearchResult[],
  socratic: boolean
): WikiAnswer {
  const top = chunks.slice(0, 3);
  const citations = top.map((chunk, index) => ({
    marker: `C${index + 1}`,
    chunkId: chunk.id,
    lineStart: chunk.line_start,
    lineEnd: chunk.line_end,
    citation: chunk.citation,
    quote: firstMeaningfulLine(chunk.chunk_text),
    url: citationUrlForChunk(chunk, chunk.line_start, chunk.line_end),
  }));
  const bullets = top
    .map((chunk, index) => `- ${firstMeaningfulLine(chunk.chunk_text)} [C${index + 1}]`)
    .join("\n");
  const answer = socratic
    ? [
        "Let's work from the sources first: what does the cited implementation or doc say, and what detail would change your decision?",
        "",
        bullets,
      ].join("\n")
    : [
        `I found source material related to "${question}", but the model answer could not be validated cleanly. Here are the grounded excerpts instead:`,
        "",
        bullets,
      ].join("\n");

  return {
    answer,
    citations,
    chunks,
    notInSources: false,
    llmUsed: false,
  };
}

function withCitationUrl(
  citation: Omit<WikiAnswerCitation, "url">,
  chunks: WikiSearchResult[]
): WikiAnswerCitation {
  const chunk = chunks.find((candidate) => candidate.id === citation.chunkId);
  return {
    ...citation,
    url: chunk ? citationUrlForChunk(chunk, citation.lineStart, citation.lineEnd) : null,
  };
}

function citationUrlForChunk(
  chunk: WikiSearchResult,
  lineStart: number,
  lineEnd: number
): string | null {
  if (chunk.source_kind === "repo" && chunk.uri && chunk.source_ref) {
    const githubUrl = githubLineUrl(chunk.uri, chunk.source_ref, chunk.path, lineStart, lineEnd);
    if (githubUrl) return githubUrl;
  }

  if (chunk.uri?.startsWith("http://") || chunk.uri?.startsWith("https://")) {
    return chunk.uri;
  }

  return `/api/wiki/chunks/${chunk.id}?lines=${lineStart}-${lineEnd}`;
}

function githubLineUrl(
  repoUri: string,
  sourceRef: string,
  filePath: string,
  lineStart: number,
  lineEnd: number
): string | null {
  try {
    const url = new URL(repoUri.replace(/\.git$/, ""));
    if (url.hostname !== "github.com") return null;
    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (!owner || !repo) return null;
    const encodedPath = filePath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(sourceRef)}/${encodedPath}#L${lineStart}-L${lineEnd}`;
  } catch {
    return null;
  }
}

function firstMeaningfulLine(text: string): string {
  const line = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) || text.slice(0, 180);
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

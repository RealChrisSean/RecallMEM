import { createHash } from "node:crypto";

export type WikiSourceKind = "manual" | "repo" | "url" | "file" | "seed";

export interface WikiSourceInput {
  brain: string;
  title: string;
  sourceKind?: WikiSourceKind;
  uri?: string | null;
  sourceRef?: string | null;
  path?: string | null;
  text: string;
}

export interface WikiChunkInput {
  chunkText: string;
  chunkIndex: number;
  lineStart: number;
  lineEnd: number;
  sectionTitle: string | null;
  contentHash: string;
}

export interface WikiCitationProposal {
  marker?: string;
  chunkId: string;
  lineStart: number;
  lineEnd: number;
  quote?: string;
}

export interface WikiChunkForValidation {
  id: string;
  chunk_text: string;
  line_start: number;
  line_end: number;
  citation: string;
}

export interface ValidatedWikiCitation {
  marker: string;
  chunkId: string;
  lineStart: number;
  lineEnd: number;
  citation: string;
  quote: string | null;
}

export function normalizeBrainName(value: string | null | undefined): string {
  const slug = (value || "default")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "default";
}

export function brainUserId(baseUserId: string, brain: string): string {
  const normalized = normalizeBrainName(brain);
  return normalized === "default" ? baseUserId : `${baseUserId}::${normalized}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

export function chunkSourceText(
  text: string,
  opts: { maxChars?: number } = {}
): WikiChunkInput[] {
  const maxChars = opts.maxChars || 1400;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const chunks: WikiChunkInput[] = [];
  let current: string[] = [];
  let startLine = 1;
  let sectionTitle: string | null = null;
  let currentSection: string | null = null;

  function flush(endLine: number) {
    const chunkText = current.join("\n").trim();
    if (!chunkText) {
      current = [];
      startLine = endLine + 1;
      sectionTitle = currentSection;
      return;
    }
    chunks.push({
      chunkText,
      chunkIndex: chunks.length,
      lineStart: startLine,
      lineEnd: endLine,
      sectionTitle,
      contentHash: sha256(chunkText),
    });
    current = [];
    startLine = endLine + 1;
    sectionTitle = currentSection;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      currentSection = heading[2].trim();
      if (current.length > 0) flush(lineNo - 1);
      sectionTitle = currentSection;
      startLine = lineNo;
    }

    const nextSize = current.join("\n").length + line.length + 1;
    if (current.length > 0 && nextSize > maxChars) {
      flush(lineNo - 1);
      startLine = lineNo;
      sectionTitle = currentSection;
    }
    current.push(line);

    if (line.trim() === "" && current.join("\n").length > maxChars * 0.75) {
      flush(lineNo);
    }
  }

  if (current.length > 0) flush(lines.length);
  return chunks;
}

export function citationLabel(input: {
  sourceTitle: string;
  path: string;
  sourceRef?: string | null;
  lineStart: number;
  lineEnd: number;
}): string {
  const ref = input.sourceRef ? `@${input.sourceRef.slice(0, 12)}` : "";
  return `${input.sourceTitle}${ref} ${input.path}:L${input.lineStart}-L${input.lineEnd}`;
}

export function lineSliceFromChunk(
  chunk: WikiChunkForValidation,
  lineStart: number,
  lineEnd: number
): string | null {
  if (lineStart < chunk.line_start || lineEnd > chunk.line_end || lineStart > lineEnd) {
    return null;
  }
  const lines = chunk.chunk_text.split("\n");
  const startOffset = lineStart - chunk.line_start;
  const endOffset = lineEnd - chunk.line_start + 1;
  return lines.slice(startOffset, endOffset).join("\n").trim();
}

export function validateWikiCitations(
  proposals: WikiCitationProposal[],
  chunks: WikiChunkForValidation[]
): ValidatedWikiCitation[] {
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const valid: ValidatedWikiCitation[] = [];

  for (const proposal of proposals) {
    const chunk = chunkById.get(proposal.chunkId);
    if (!chunk) continue;
    const lineText = lineSliceFromChunk(chunk, proposal.lineStart, proposal.lineEnd);
    if (!lineText) continue;

    const quote = proposal.quote?.trim() || null;
    if (quote && !lineText.includes(quote) && !chunk.chunk_text.includes(quote)) {
      continue;
    }

    valid.push({
      marker: proposal.marker || `C${valid.length + 1}`,
      chunkId: chunk.id,
      lineStart: proposal.lineStart,
      lineEnd: proposal.lineEnd,
      citation: citationLabelFromChunk(chunk, proposal.lineStart, proposal.lineEnd),
      quote,
    });
  }

  return valid;
}

function citationLabelFromChunk(
  chunk: WikiChunkForValidation,
  lineStart: number,
  lineEnd: number
): string {
  return chunk.citation.replace(/:L\d+-L\d+$/, `:L${lineStart}-L${lineEnd}`);
}

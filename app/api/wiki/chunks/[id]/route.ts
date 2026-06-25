import { NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { lineSliceFromChunk } from "@/lib/wiki-core";

export const runtime = "nodejs";

interface WikiChunkPageRow {
  id: string;
  chunk_text: string;
  line_start: number;
  line_end: number;
  citation: string;
  source_title: string;
  source_kind: string;
  uri: string | null;
  source_ref: string | null;
  path: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await queryOne<WikiChunkPageRow>(
    `SELECT c.id,
            c.chunk_text,
            c.line_start,
            c.line_end,
            c.citation,
            s.title AS source_title,
            s.source_kind,
            d.uri,
            d.source_ref,
            d.path
     FROM s2m_wiki_chunks c
     JOIN s2m_wiki_sources s ON s.id = c.source_id
     JOIN s2m_wiki_documents d ON d.id = c.document_id
     WHERE c.id = $1
     LIMIT 1`,
    [id]
  );

  if (!row) {
    return new Response("Wiki source excerpt not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(req.url);
  const lineParam = url.searchParams.get("lines");
  const match = lineParam?.match(/^(\d+)-(\d+)$/);
  const lineStart = match ? Number(match[1]) : row.line_start;
  const lineEnd = match ? Number(match[2]) : row.line_end;
  const excerpt =
    lineSliceFromChunk(row, lineStart, lineEnd) ||
    lineSliceFromChunk(row, row.line_start, row.line_end) ||
    row.chunk_text;

  return new Response(sourceHtml(row, excerpt, lineStart, lineEnd), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function sourceHtml(row: WikiChunkPageRow, excerpt: string, lineStart: number, lineEnd: number) {
  const sourceLink = row.uri?.startsWith("http")
    ? `<a href="${escapeHtml(row.uri)}">${escapeHtml(row.uri)}</a>`
    : escapeHtml(row.uri || "local source");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(row.source_title)} L${lineStart}-L${lineEnd}</title>
    <style>
      body {
        margin: 0;
        background: #fafafa;
        color: #18181b;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
        padding: 32px 20px;
      }
      .meta {
        color: #71717a;
        font-size: 13px;
        line-height: 1.6;
        overflow-wrap: anywhere;
      }
      pre {
        margin-top: 20px;
        padding: 18px;
        border: 1px solid #e4e4e7;
        border-radius: 8px;
        background: white;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(row.source_title)}</h1>
      <div class="meta">${escapeHtml(row.path)} · L${lineStart}-L${lineEnd}</div>
      <div class="meta">${sourceLink}</div>
      <pre>${escapeHtml(excerpt)}</pre>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

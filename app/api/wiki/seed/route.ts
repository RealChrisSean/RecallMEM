import { NextRequest } from "next/server";
import { ingestWikiSource } from "@/lib/wiki";

export const runtime = "nodejs";
export const maxDuration = 60;

const SPRITES_WIKI_BRIEF = `# Sprites LLM Wiki Brief

Creation of LLM wiki.

An LLM-based wiki will be created to manage documentation by ingesting primary sources from repositories and documents.

Chris Databos will create an LLM Wiki: build a Large Language Model wiki for Sprites by compiling primary source documents and repository information.

Thomas Ptacek recommended that Chris Databos create a Large Language Model Wiki by using an artificial intelligence tool to process primary sources from documentation and the repository.

The reason is that manual documentation efforts are currently insufficient for pre-release features.

The wiki should prefer primary sources, including repositories, documents, and source material that reflects pre-release behavior before normal docs catch up.
`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { brain?: string };
    const result = await ingestWikiSource({
      brain: body.brain || "sprites",
      title: "Sprites LLM Wiki Brief",
      sourceKind: "seed",
      uri: "local://sprites-llm-wiki-brief",
      sourceRef: "2026-06-24",
      path: "briefs/sprites-llm-wiki.md",
      text: SPRITES_WIKI_BRIEF,
    });
    return Response.json({ ok: true, result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

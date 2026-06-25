import { NextRequest } from "next/server";
import { ingestWikiSource, listWikiSources } from "@/lib/wiki";
import type { WikiSourceKind } from "@/lib/wiki-core";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const brain = req.nextUrl.searchParams.get("brain") || "sprites";
  const sources = await listWikiSources(brain);
  return Response.json({ sources });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      brain?: string;
      title?: string;
      sourceKind?: WikiSourceKind;
      uri?: string | null;
      sourceRef?: string | null;
      path?: string | null;
      text?: string;
    };
    const result = await ingestWikiSource({
      brain: body.brain || "sprites",
      title: body.title || "",
      sourceKind: body.sourceKind || "manual",
      uri: body.uri || null,
      sourceRef: body.sourceRef || null,
      path: body.path || null,
      text: body.text || "",
    });
    return Response.json({ ok: true, result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

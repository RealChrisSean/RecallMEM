import { NextRequest } from "next/server";
import { answerWikiQuestion } from "@/lib/wiki";
import { isProviderModelMode, type ProviderModelMode } from "@/lib/llm-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      query?: string;
      brain?: string;
      socratic?: boolean;
      providerId?: string | null;
      model?: string | null;
      modelMode?: ProviderModelMode | null;
    };
    const question = body.query?.trim();
    if (!question) {
      return Response.json(
        {
          answer: "I don't have that in this brain's sources.",
          citations: [],
          notInSources: true,
        },
        { status: 400 }
      );
    }

    const result = await answerWikiQuestion({
      brain: body.brain || "sprites",
      question,
      socratic: !!body.socratic,
      providerId: body.providerId || undefined,
      model: body.model || undefined,
      providerModelMode: isProviderModelMode(body.modelMode) ? body.modelMode : undefined,
      publicSourcesOnly: true,
    });

    return Response.json({
      answer: result.answer,
      citations: result.citations.map((citation) => ({
        marker: citation.marker,
        citation: citation.citation,
        url: citation.url,
      })),
      notInSources: result.notInSources,
      validationFailed: !!result.validationFailed,
    });
  } catch (err) {
    return Response.json(
      {
        answer: "I don't have that in this brain's sources.",
        citations: [],
        notInSources: true,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

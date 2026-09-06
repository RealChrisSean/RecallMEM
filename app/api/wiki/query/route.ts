import { NextRequest } from "next/server";
import { answerWikiQuestion } from "@/lib/wiki";
import { isProviderModelMode, type ProviderModelMode } from "@/lib/llm-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      brain?: string;
      question?: string;
      socratic?: boolean;
      providerId?: string;
      model?: string;
      providerModelMode?: ProviderModelMode;
      publicSourcesOnly?: boolean;
    };

    if (!body.question?.trim()) {
      return Response.json({ error: "question required" }, { status: 400 });
    }

    const providerModelMode = isProviderModelMode(body.providerModelMode)
      ? body.providerModelMode
      : undefined;

    const result = await answerWikiQuestion({
      brain: body.brain || "default",
      question: body.question,
      socratic: !!body.socratic,
      providerId: body.providerId,
      model: body.model,
      providerModelMode,
      publicSourcesOnly: !!body.publicSourcesOnly,
    });

    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

import { NextRequest } from "next/server";
import {
  downloadAndStoreLumaImage,
  getLumaApiKey,
  getLumaGeneration,
  getRemoteLumaGeneration,
  lumaErrorPayload,
  lumaRowToGeneratedImage,
  syncLumaMessageInChat,
  updateLumaGenerationFromRemote,
} from "@/lib/luma";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getLumaGeneration(id);
    if (!existing) {
      return json({ error: "Generation not found" }, 404);
    }

    if (
      (existing.state === "completed" && existing.local_image) ||
      existing.state === "failed"
    ) {
      return json({ image: lumaRowToGeneratedImage(existing) });
    }

    const apiKey = await getLumaApiKey();
    if (!apiKey) {
      return json({ error: "Luma API key is no longer configured." }, 400);
    }

    const remote = await getRemoteLumaGeneration(apiKey, existing.luma_generation_id);
    let row = await updateLumaGenerationFromRemote({
      id: existing.id,
      generation: remote.generation,
      meta: remote.meta,
    });

    const outputUrl = remote.generation.output[0]?.url;
    if (remote.generation.state === "completed" && outputUrl && !row.local_image) {
      row = await downloadAndStoreLumaImage({
        row,
        outputUrl,
        outputFormat: row.output_format,
      });
    }

    await syncLumaMessageInChat(row);
    return json({ image: lumaRowToGeneratedImage(row) });
  } catch (err) {
    const payload = lumaErrorPayload(err);
    return json(payload, payload.status || 500);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

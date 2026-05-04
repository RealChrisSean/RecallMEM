import { NextRequest } from "next/server";
import { getLumaGeneration } from "@/lib/luma";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = await getLumaGeneration(id);
    if (!row?.local_image) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(new Uint8Array(row.local_image), {
      headers: {
        "Content-Type": row.local_mime_type || "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(message, { status: 500 });
  }
}

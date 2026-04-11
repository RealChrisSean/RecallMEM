import { NextRequest } from "next/server";
import { getUsageSummary, getUsageForRange } from "@/lib/usage";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (from && to) {
    const data = await getUsageForRange(new Date(from), new Date(to));
    return Response.json(data);
  }

  const summary = await getUsageSummary();
  return Response.json(summary);
}

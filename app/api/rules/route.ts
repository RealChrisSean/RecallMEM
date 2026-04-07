import { getRules, saveRules } from "@/lib/rules";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rules = await getRules();
    return new Response(JSON.stringify({ rules }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { rules?: string };
    const rules = (body.rules || "").trim();
    await saveRules(rules);
    return new Response(JSON.stringify({ ok: true, rules }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

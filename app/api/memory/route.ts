import { getActiveFacts, wipeAllMemory, nukeEverything } from "@/lib/facts";
import { getProfile, rebuildProfile } from "@/lib/profile";

export const runtime = "nodejs";
export const maxDuration = 60;

// Returns the synthesized profile + all active facts (grouped by category on the client)
export async function GET() {
  try {
    const [profile, facts] = await Promise.all([
      getProfile(),
      getActiveFacts(1000),
    ]);

    return new Response(
      JSON.stringify({
        profile: profile?.profile_summary || "",
        profileUpdatedAt: profile?.updated_at || null,
        facts: facts.map((f) => ({
          id: f.id,
          fact_text: f.fact_text,
          category: f.category,
          source_chat_id: f.source_chat_id,
          created_at: f.created_at,
        })),
        totalFacts: facts.length,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// POST: rebuild profile from current facts (manual trigger)
export async function POST() {
  try {
    const profile = await rebuildProfile();
    return new Response(JSON.stringify({ profile }), {
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

// DELETE: wipe memory or nuke everything.
// Pass ?mode=nuke to also delete all chat transcripts.
// Both paths run VACUUM FULL + CHECKPOINT to make data unrecoverable at the DB level.
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");
    if (mode === "nuke") {
      const result = await nukeEverything();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const result = await wipeAllMemory();
    return new Response(JSON.stringify(result), {
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

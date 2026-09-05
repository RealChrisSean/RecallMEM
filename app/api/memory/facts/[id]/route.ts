import { NextRequest } from "next/server";
import {
  hardDeleteFact,
  updateFact,
  recategorizeAllFacts,
  reviewFact,
  type FactCategory,
  type FactReviewAction,
  FACT_CATEGORIES,
} from "@/lib/facts";
import { rebuildProfile } from "@/lib/profile";

export const runtime = "nodejs";

const REVIEW_ACTIONS: FactReviewAction[] = ["confirm", "dispute", "retire", "restore"];

// Review a claim or edit it directly, then rebuild the active profile.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      fact_text?: string;
      category?: string;
      action?: string;
    };

    if (body.action) {
      if (!REVIEW_ACTIONS.includes(body.action as FactReviewAction)) {
        return new Response(JSON.stringify({ error: "Invalid review action" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const result = await reviewFact(id, body.action as FactReviewAction);
      await rebuildProfile();
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!body.fact_text || !body.fact_text.trim()) {
      return new Response(JSON.stringify({ error: "fact_text required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const category =
      body.category && (FACT_CATEGORIES as readonly string[]).includes(body.category)
        ? (body.category as FactCategory)
        : undefined;

    await updateFact(id, body.fact_text.trim(), category);
    await recategorizeAllFacts();
    await rebuildProfile();

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "Memory not found"
      ? 404
      : message.startsWith("Cannot ")
        ? 409
        : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Permanently delete a fact and rebuild profile
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await hardDeleteFact(id);
    await recategorizeAllFacts();
    await rebuildProfile();
    return new Response(JSON.stringify({ ok: true }), {
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

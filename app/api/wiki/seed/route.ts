export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    {
      ok: false,
      error: "RecallMEM does not include a bundled wiki. Add your own source or repository.",
    },
    { status: 400 }
  );
}

// DEV-ONLY test harness for the anti-platitude insight synthesizer.
// POST { objective, context? } → ranked dense leverage theses.
// 404s in production (no auth, no credit charge — purely for prompt testing).

import { NextResponse } from "next/server";
import { synthesizeInsight } from "@/lib/objective-canvas/crucible/crucible-insight";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let body: { objective?: string; context?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const objective = typeof body.objective === "string" ? body.objective : "";
  if (!objective.trim()) {
    return NextResponse.json({ error: "objective required" }, { status: 400 });
  }
  const result = await synthesizeInsight({ objective, context: body.context });
  if (!result) {
    return NextResponse.json({ error: "synthesis failed (see server logs)" }, { status: 502 });
  }
  return NextResponse.json(result);
}

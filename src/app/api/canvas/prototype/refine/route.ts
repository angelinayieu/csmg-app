// ── POST /api/canvas/prototype/refine ─────────────────────────────
//
// The prototype feedback loop: regenerate the interactive HTML with the
// user's feedback applied (Opus + the UI agent skill), grounded in the
// current HTML + TechSpec context. Sanitized server-side. Telemetry via
// instrumentedLLMCall.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { BEST_CLAUDE_MODEL } from "@/lib/llm";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { refinePrototypeHtml } from "@/lib/objective-canvas/tech-spec/compose-prototype";
import { buildTasteDesignContext } from "@/lib/objective-canvas/tech-spec/taste-design-block";
import type { TechSpec } from "@/lib/objective-canvas/tech-spec/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  spaceId?: string;
  currentHtml?: string;
  feedback?: string;
  spec?: TechSpec | null;
}

export async function POST(req: Request) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const spaceId = typeof body.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  }
  const currentHtml = typeof body.currentHtml === "string" ? body.currentHtml : "";
  const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
  const hasSpec = !!body.spec && typeof body.spec.title === "string";
  if (!feedback || (!currentHtml.trim() && !hasSpec)) {
    return NextResponse.json(
      { error: "feedback and currentHtml or spec required" },
      { status: 400 },
    );
  }

  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const taste = await buildTasteDesignContext(auth.supabase, spaceId);

  try {
    const html = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:prototype_refine",
        modelHint: BEST_CLAUDE_MODEL,
        metadata: { mode: "refine", taste_applied: taste.hasContent },
      },
      () => refinePrototypeHtml(currentHtml, feedback, body.spec ?? null, taste),
    );
    return NextResponse.json({ html });
  } catch (err) {
    console.error("[prototype/refine] generation failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}

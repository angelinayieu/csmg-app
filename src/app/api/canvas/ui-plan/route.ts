// ── POST /api/canvas/ui-plan ──────────────────────────────────────
//
// The "Build prototype" fork step: from any selected card's source text,
// draft N distinct UI-plan variants (forced onto different design axes)
// the user can pick between before committing one to a prototype.
// Pure compute — the rail does the placement + arrow wiring on the board.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { BEST_FAST_CLAUDE_MODEL } from "@/lib/llm";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { composeUiPlans } from "@/lib/objective-canvas/tech-spec/compose-ui-plans";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  spaceId?: string;
  sourceText?: string;
  count?: number;
  temperature?: number;
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
  const sourceText = typeof body.sourceText === "string" ? body.sourceText.trim() : "";
  if (!spaceId) return NextResponse.json({ error: "Missing spaceId" }, { status: 400 });
  if (!sourceText) {
    return NextResponse.json({ error: "Missing sourceText" }, { status: 400 });
  }
  const count = Math.max(1, Math.min(5, Math.round(body.count ?? 3)));
  const temperature =
    typeof body.temperature === "number"
      ? Math.max(0, Math.min(1, body.temperature))
      : undefined;

  const { data: space } = await auth.supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await instrumentedLLMCall(
      {
        db: auth.supabase,
        userId: auth.user.id,
        spaceId,
        callSite: "objective:ui-plan-variants",
        modelHint: BEST_FAST_CLAUDE_MODEL,
        metadata: { count, temperature: temperature ?? null },
      },
      () => composeUiPlans({ sourceText, count, temperature }),
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[ui-plan] generation failed:", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}

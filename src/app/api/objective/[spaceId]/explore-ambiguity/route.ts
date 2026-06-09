// ── POST /api/objective/[spaceId]/explore-ambiguity ──────────────────
//
// The on-demand BRAINSTORM surface (the diverge half of the Crucible). Reuses
// the SAME engine (crucible-engine diverge/converge) + the same object layer —
// it is NOT a parallel system. Forked from the "Explore top" button on the
// ambiguity-heatmap / priority-map cards.
//
// Body: { action: "explore" | "get" | "swap", headline?, question?, source?,
//         objectId?, activeIndex? }
//   explore — diverge K variations → converge to principle + decisions → persist
//             a swappable BLOCK (library_objects "decision"). Charged once.
//   get     — read a persisted block (card reload).
//   swap    — set the chosen variation (free; no LLM).
//
// Returns: { objectId, block }.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { detectCreditError } from "@/lib/llm";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";
import { buildSpaceContext } from "@/lib/objective-canvas/build-space-context";
import { loadOptimizationFactors } from "@/lib/objective-canvas/load-optimization-factors";
import {
  exploreAmbiguity,
  getExplorationBlock,
  swapExplorationVariation,
} from "@/lib/objective-canvas/crucible/crucible-explore";

export const runtime = "nodejs";
export const maxDuration = 90;

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

interface Body {
  action?: "explore" | "get" | "swap";
  headline?: unknown;
  question?: unknown;
  source?: unknown;
  objectId?: unknown;
  activeIndex?: unknown;
}

export async function POST(request: Request, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;
  const action = body.action ?? "explore";

  // Ownership.
  const { data: space } = await supabase
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── get: read a persisted block ──
  if (action === "get") {
    const objectId = typeof body.objectId === "string" ? body.objectId : "";
    if (!objectId) {
      return NextResponse.json({ error: "objectId required" }, { status: 400 });
    }
    const block = await getExplorationBlock(supabase, objectId);
    return NextResponse.json({ objectId, block });
  }

  // ── swap: change the chosen variation (no LLM, no charge) ──
  if (action === "swap") {
    const objectId = typeof body.objectId === "string" ? body.objectId : "";
    const activeIndex =
      typeof body.activeIndex === "number" ? Math.floor(body.activeIndex) : -1;
    if (!objectId || activeIndex < 0) {
      return NextResponse.json(
        { error: "objectId + activeIndex required" },
        { status: 400 },
      );
    }
    const block = await swapExplorationVariation(supabase, objectId, activeIndex);
    if (!block) {
      return NextResponse.json({ error: "invalid block or index" }, { status: 400 });
    }
    return NextResponse.json({ objectId, block });
  }

  // ── explore: diverge → converge → persist ──
  const headline = typeof body.headline === "string" ? body.headline.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const source = typeof body.source === "string" ? body.source.trim() : undefined;
  if (!headline) {
    return NextResponse.json({ error: "headline required" }, { status: 400 });
  }

  // Context — same assembly the Crucible uses (objective + taste + factors).
  let objective = "";
  let preamble = "";
  let factors: Awaited<ReturnType<typeof loadOptimizationFactors>> = [];
  try {
    const [spaceCtx, f] = await Promise.all([
      buildSpaceContext(supabase, spaceId),
      loadOptimizationFactors(supabase, spaceId),
    ]);
    objective = (spaceCtx.objective ?? "").trim();
    preamble = (spaceCtx.preamble ?? "").trim();
    factors = f;
  } catch (err) {
    console.warn("[explore-ambiguity] context load failed (soft):", err);
  }

  const nowIso = new Date().toISOString();
  try {
    const result = await withCharge(
      { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
      () =>
        exploreAmbiguity(
          supabase,
          user.id,
          spaceId,
          {
            objective,
            preamble,
            factors: factors.map((f) => ({
              slug: f.slug,
              label: f.label,
              kind: f.kind,
              why: f.why,
            })),
          },
          { headline, question, source },
          nowIso,
        ),
    );
    if (result.block.variations.length === 0) {
      return NextResponse.json(
        { error: "No variations produced." },
        { status: 502 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const ce = creditErrorResponse(err);
    if (ce) return ce;
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json(
        { error: credit.message, code: "credits_exhausted" },
        { status: 402 },
      );
    }
    console.error("[/api/objective/[spaceId]/explore-ambiguity] error:", err);
    return NextResponse.json({ error: sanitizeErrorMessage(err) }, { status: 500 });
  }
}

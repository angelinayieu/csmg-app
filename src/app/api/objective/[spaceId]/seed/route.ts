// ── POST /api/objective/[spaceId]/seed ───────────────────────────────
//
// Build or read the ObjectiveSeed.
//   action "get"   — read the seed (the card face polls this).
//   action "build" — gather seed.internal from the engine outputs (sharpening +
//                    crucible) and distill seed.external. Idempotent; re-run to
//                    refresh after more reasoning lands.
//
// State at synthesis_data.objective_canvas.seed (no migration). The distill step
// is charged (canvas_op) + soft-fails so a miss never 500s the card.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { detectCreditError } from "@/lib/llm";
import { withCharge, creditErrorResponse } from "@/lib/credits/with-charge";
import { readSeed, writeSeed } from "@/lib/objective-canvas/seed/seed-store";
import { assembleSeedInternal } from "@/lib/objective-canvas/seed/assemble-seed";
import { distillExternal } from "@/lib/objective-canvas/seed/distill-external";
import { consolidateVariables, enrichLandscape } from "@/lib/objective-canvas/seed/value-engine";
import { runEvaluator } from "@/lib/objective-canvas/seed/evaluator";
import { buildSkeletonGraph } from "@/lib/objective-canvas/seed/skeleton";
import { materializeSeedGraph } from "@/lib/objective-canvas/seed/materialize-seed-graph";
import { generateAndRankIdeas } from "@/lib/objective-canvas/seed/idea-engine";
import { emptySeed, emptySeedInternal, SEED_VERSION, type ObjectiveSeed } from "@/lib/objective-canvas/seed/seed-types";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteContext { params: Promise<{ spaceId: string }> }
/** "get" reads. "build" = assemble + distill (fast). "enrich" = build + the
 *  web-grounded value engine (alternatives + analogs + variable consolidation)
 *  so the external face can say "unlike X/Y, this …" instead of a platitude. */
interface Body { action?: "get" | "build" | "enrich" | "evaluate" | "skeleton" | "ideas" | "sync_graph"; force?: boolean; objective?: string }

export async function POST(req: Request, ctx: RouteContext) {
  const { spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;
  const action = body.action ?? "get";

  const { data: space } = await supabase.from("spaces").select("id, user_id").eq("id", spaceId).maybeSingle();
  if (!space || space.user_id !== user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (action === "get") {
    const seed = await readSeed(supabase, spaceId);
    return NextResponse.json({ seed });
  }

  // ── skeleton: instant placeholder graph so the Map peek + the card's
  //    "N concepts mapped" aren't blank while the real reasoning runs. Builds
  //    ONLY if the seed has no graph yet (the real assemble overwrites it on
  //    enrich). Cheap fast-model call; soft-fails to a heuristic. ──
  if (action === "skeleton") {
    const prior = await readSeed(supabase, spaceId);
    if (prior && prior.internal.reasoningGraph.nodes.length > 0) {
      return NextResponse.json({ seed: prior }); // already have a graph — no-op
    }
    const objective = (body.objective ?? prior?.internal.sharpenedObjective ?? "").trim();
    const internalSk = prior?.internal ?? emptySeedInternal(objective);
    if (objective && !internalSk.sharpenedObjective) internalSk.sharpenedObjective = objective;
    try {
      internalSk.reasoningGraph = await withCharge(
        { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
        () => buildSkeletonGraph(objective),
      );
    } catch (err) {
      const ce = creditErrorResponse(err);
      if (ce) return ce;
      console.warn("[seed] skeleton failed (soft):", err);
    }
    const seedSk: ObjectiveSeed = {
      version: SEED_VERSION,
      external: prior?.external ?? null,
      internal: internalSk,
      status: prior?.status === "ready" ? "ready" : "seeding",
      updatedAt: new Date().toISOString(),
    };
    await writeSeed(supabase, spaceId, seedSk);
    return NextResponse.json({ seed: seedSk });
  }

  // ── evaluate: re-run the brain over the current internal (cheap refresh;
  //    e.g. the chat calls this after the founder answers, to recompute the
  //    coverage + the decisive gap). Preserves the existing external/internal. ──
  if (action === "evaluate") {
    const internalE = await assembleSeedInternal(supabase, spaceId);
    const prior = await readSeed(supabase, spaceId);
    try {
      internalE.evaluation = await withCharge(
        { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
        () => runEvaluator(internalE),
      );
    } catch (err) {
      const ce = creditErrorResponse(err);
      if (ce) return ce;
      const credit = detectCreditError(err);
      if (credit.isCredit) return NextResponse.json({ error: credit.message, code: "credits_exhausted" }, { status: 402 });
      console.warn("[seed] evaluate failed (soft):", err);
    }
    const seedE: ObjectiveSeed = {
      version: SEED_VERSION,
      external: prior?.external ?? null,
      internal: internalE,
      status: prior?.status === "ready" ? "ready" : internalE.evaluation ? "ready" : "seeding",
      updatedAt: new Date().toISOString(),
    };
    await writeSeed(supabase, spaceId, seedE);
    return NextResponse.json({ seed: seedE });
  }

  // ── sync_graph: cheap, NO-LLM refresh of the reasoning graph from the live
  //    crucible decomposition (variables/facts/constraints/solutions accumulate
  //    every round). The driver calls this each round so the KG GROWS as the
  //    operation runs — not only at the final enrich. Preserves external +
  //    evaluation + ideas; never shrinks below the current graph. ──
  if (action === "sync_graph") {
    const priorG = await readSeed(supabase, spaceId);
    const internalG = await assembleSeedInternal(supabase, spaceId);
    if (priorG?.internal?.evaluation && !internalG.evaluation) internalG.evaluation = priorG.internal.evaluation;
    if (priorG?.internal?.ideas && !internalG.ideas) internalG.ideas = priorG.internal.ideas;
    // No-shrink: keep the richer graph (early rounds may be sparser than the skeleton).
    const priorNodes = priorG?.internal?.reasoningGraph?.nodes?.length ?? 0;
    if (internalG.reasoningGraph.nodes.length < priorNodes && priorG?.internal?.reasoningGraph) {
      internalG.reasoningGraph = priorG.internal.reasoningGraph;
    }
    const seedG: ObjectiveSeed = {
      version: SEED_VERSION,
      external: priorG?.external ?? null,
      internal: internalG,
      status: priorG?.status === "ready" ? "ready" : "seeding",
      updatedAt: new Date().toISOString(),
    };
    await writeSeed(supabase, spaceId, seedG);

    // Mirror the jsonb graph into the entities/edges substrate so the
    // uncertainty model has something to read. The jsonb stays the canvas's
    // display model; `entities` carries node_signature + root_score, which is
    // what the maturity loop and the heat map actually run on.
    //
    // Fire-and-forget: it upserts idempotently by (space_id, entity_id), so a
    // failure is topped up by the next sync_graph tick. Never block or fail
    // the seed response on it.
    void materializeSeedGraph(
      supabase,
      spaceId,
      internalG.reasoningGraph,
      "objective",
    ).catch((err) => console.warn("[seed] materializeSeedGraph failed (soft):", err));

    return NextResponse.json({ seed: seedG });
  }

  // ── ideas: generate + score + rank the idea FIELD (the generative layer the
  //    reasoning pipeline lacks). Assembles current internal, runs the engine,
  //    preserves the prior external + evaluation so this never wipes them. ──
  if (action === "ideas") {
    const internalI = await assembleSeedInternal(supabase, spaceId);
    const priorI = await readSeed(supabase, spaceId);
    if (priorI?.internal?.evaluation && !internalI.evaluation) internalI.evaluation = priorI.internal.evaluation;
    if (priorI?.internal?.reasoningGraph?.nodes?.length && internalI.reasoningGraph.nodes.length === 0) internalI.reasoningGraph = priorI.internal.reasoningGraph;
    try {
      internalI.ideas = await withCharge(
        { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
        () => generateAndRankIdeas(internalI),
      );
    } catch (err) {
      const ce = creditErrorResponse(err);
      if (ce) return ce;
      const credit = detectCreditError(err);
      if (credit.isCredit) return NextResponse.json({ error: credit.message, code: "credits_exhausted" }, { status: 402 });
      console.warn("[seed] ideas failed (soft):", err);
    }
    const seedI: ObjectiveSeed = {
      version: SEED_VERSION,
      external: priorI?.external ?? null,
      internal: internalI,
      status: priorI?.status === "ready" ? "ready" : internalI.ideas ? "ready" : "seeding",
      updatedAt: new Date().toISOString(),
    };
    await writeSeed(supabase, spaceId, seedI);
    return NextResponse.json({ seed: seedI });
  }

  // ── build / enrich ──
  const nowIso = new Date().toISOString();
  const internal = await assembleSeedInternal(supabase, spaceId);
  let seed: ObjectiveSeed = {
    version: SEED_VERSION,
    external: null,
    internal,
    status: "seeding",
    updatedAt: nowIso,
  };
  // If there's nothing to distill yet, persist the seeding state + return.
  if (internal.leveragePoints.length === 0 && internal.firstPrinciples.length === 0) {
    seed = { ...emptySeed(internal.sharpenedObjective, nowIso), internal };
    await writeSeed(supabase, spaceId, seed);
    return NextResponse.json({ seed });
  }

  try {
    const external = await withCharge(
      { db: supabase, userId: user.id, operation: "canvas_op", spaceId },
      async () => {
        // enrich (web-grounded value engine) augments `internal` BEFORE distill,
        // so vsAlternatives is grounded in real competitors — not a platitude.
        if (action === "enrich") {
          const levLabels = internal.leveragePoints.map((l) => l.label);
          const [landscape, canonical] = await Promise.all([
            enrichLandscape(internal.sharpenedObjective, levLabels),
            consolidateVariables(internal.canonicalVariables),
          ]);
          internal.alternatives = landscape.alternatives;
          internal.analogousExamples = landscape.analogousExamples;
          internal.landscape = landscape.landscape;
          internal.canonicalVariables = canonical;
        }
        // The brain: coverage + decisive gap + bias-to-action. Runs before
        // distill so the external face can lead with the verdict + the gap.
        internal.evaluation = await runEvaluator(internal);
        return distillExternal(internal);
      },
    );
    seed.external = external;
    seed.status = "ready";
  } catch (err) {
    const ce = creditErrorResponse(err);
    if (ce) return ce;
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json({ error: credit.message, code: "credits_exhausted" }, { status: 402 });
    }
    console.error("[/api/objective/[spaceId]/seed] distill error:", err);
    seed.status = "error";
    seed.error = sanitizeErrorMessage(err);
  }

  seed.updatedAt = new Date().toISOString();
  await writeSeed(supabase, spaceId, seed);
  return NextResponse.json({ seed });
}

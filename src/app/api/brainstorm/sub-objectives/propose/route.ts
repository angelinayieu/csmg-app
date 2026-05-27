// ── POST /api/brainstorm/sub-objectives/propose ───────────────────
//
// Generates sub-objective proposals for an Objective Canvas. Three
// modes:
//
//   initial    — first run. If a block already exists with
//                proposals, returns the cached set (no LLM cost).
//   regenerate — wipe and regenerate. Also clears the picked sets
//                so the user starts fresh.
//   variant    — Variant Lab: APPEND a new batch with the given
//                intent. Existing proposals + their dispositions are
//                preserved. Anti-duplicate rule + lens are wired in.
//
// Body: { spaceId, mode?, intent? }
//
// When mode === "variant", intent is required.
// When mode is omitted or "initial"/"regenerate", intent defaults to
// "initial" and is mostly ignored (legacy single-batch behavior).

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { generateSubObjectiveProposals } from "@/lib/objective-canvas/generate-sub-objectives";
import {
  readObjectiveCanvasState,
  writeSubObjectiveBlock,
  allBlockProposals,
  computeLensCoverage,
  flattenBatchProposals,
  type SubObjectiveBatch,
  type SubObjectiveBlock,
  type SubObjectiveIntent,
} from "@/lib/objective-canvas/sub-objective-state";
import {
  buildRagBlock,
  type SurfaceBundle,
  type DeepBundle,
} from "@/lib/research/research-service";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import { loadRelevantCanonicalConcepts } from "@/lib/objective-canvas/canonical-concept-lookup";

export const runtime = "nodejs";
export const maxDuration = 45;

const ALLOWED_INTENTS: ReadonlyArray<SubObjectiveIntent> = [
  "initial",
  "creative",
  "concrete",
  "contrarian",
  "gap_fill",
  "ambitious",
  "wildcard",
];

interface Body {
  spaceId?: string;
  mode?: "initial" | "regenerate" | "variant";
  intent?: SubObjectiveIntent;
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  const mode: "initial" | "regenerate" | "variant" =
    body?.mode === "regenerate"
      ? "regenerate"
      : body?.mode === "variant"
        ? "variant"
        : "initial";
  const intent: SubObjectiveIntent =
    body?.intent && ALLOWED_INTENTS.includes(body.intent)
      ? body.intent
      : "initial";
  if (mode === "variant" && intent === "initial") {
    return NextResponse.json(
      { error: "variant mode requires a specific intent" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: space, error: fetchError } = await db
    .from("spaces")
    .select(
      "id, user_id, description, input_text, synthesis_data, surface_research, deep_research",
    )
    .eq("id", spaceId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: "DB error", detail: fetchError.message },
      { status: 500 },
    );
  }
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const objective: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";
  if (objective.length < 4) {
    return NextResponse.json(
      { error: "Space has no objective text yet." },
      { status: 400 },
    );
  }

  const state = readObjectiveCanvasState(space.synthesis_data);
  const existingBlock = state.sub_objectives;

  // ── Cross-space KG read — canonical concepts the user has already
  // explored that are semantically related to this objective. Loaded
  // ONCE per request so both the LLM prompt AND the response payload
  // can include them. ~300ms (one embed + 3 small queries) — cheap
  // enough to run on cache hits too so the picker badges render on
  // every load, not just fresh generations.
  //
  // Soft-fail by design — empty array on any failure, prompt + UI
  // both gracefully degrade.
  const priorConcepts = await loadRelevantCanonicalConcepts({
    db,
    userId: auth.user.id,
    queryText: objective,
    excludeSpaceId: spaceId,
    limit: 8,
  });
  // Strip cross-space evidence for the response payload — the picker
  // only needs display_name + description + space_count for badge
  // rendering. Full record stays in scope for the LLM prompt.
  const priorConceptsForResponse = priorConcepts.map((c) => ({
    id: c.id,
    canonical_code: c.canonical_code,
    display_name: c.display_name,
    description: c.description,
    domain_tags: c.domain_tags,
    space_count: c.space_count,
  }));

  // ── Mode: initial / cache short-circuit ──
  if (
    mode === "initial" &&
    existingBlock &&
    existingBlock.proposals.length > 0
  ) {
    return NextResponse.json({
      sub_objectives: existingBlock,
      prior_concepts: priorConceptsForResponse,
    });
  }

  // ── Variant mode requires an existing block to layer onto ──
  if (mode === "variant" && (!existingBlock || existingBlock.proposals.length === 0)) {
    return NextResponse.json(
      {
        error:
          "variant mode requires existing proposals — call initial first",
      },
      { status: 409 },
    );
  }

  // ── Build RAG block from research bundles (Tier 2 — research) ──
  // When research has landed, prepend a RESEARCH CONTEXT block to
  // the user prompt so the LLM grounds proposals in real sources.
  // Empty string when no research → falls through to LLM-only.
  const surface = (space.surface_research as SurfaceBundle | null) ?? null;
  const deep = (space.deep_research as DeepBundle | null) ?? null;
  const ragBlock = buildRagBlock(surface, deep, {
    maxSources: 10,
    maxCharsPerSnippet: 450,
  });

  // ── Load parent objective annotations (Variant Lab lens) ──
  // Annotations are persisted on the core goal (parent_goal_id IS
  // NULL). Step 1 fires generation right after clarify/complete, so
  // by the time the user opens the picker the lens should be ready.
  // If it isn't (race / failure), the prompt falls through to the
  // lens-less path — safe legacy behavior.
  const { data: coreRows } = await db
    .from("improvement_goals")
    .select("annotations")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const parentAnnotationsRaw =
    Array.isArray(coreRows) && coreRows.length > 0
      ? coreRows[0].annotations
      : null;
  const annotations = normalizeAnnotations(parentAnnotationsRaw);
  const lensSize = Math.min(annotations.length, 8);

  // priorConcepts was loaded at the top of the route (so cache-hit
  // returns can include them too). Reused as-is here for the LLM
  // prompt context.

  // ── Variant mode: build anti-duplicate + uncovered context ──
  let existingProposalsForPrompt:
    | ReturnType<typeof allBlockProposals>
    | undefined = undefined;
  let uncoveredLensIndices: number[] | undefined = undefined;
  if (mode === "variant" && existingBlock) {
    existingProposalsForPrompt = allBlockProposals(existingBlock);
    if (lensSize > 0) {
      const { uncovered } = computeLensCoverage(existingBlock, lensSize);
      // Only include uncovered context for gap_fill intent — other
      // intents work better without prescribed targets.
      if (intent === "gap_fill" && uncovered.length > 0) {
        uncoveredLensIndices = uncovered;
      }
    }
  }

  try {
    const {
      proposals: rawProposals,
      category: newCategory,
      temperature,
      intent: usedIntent,
    } = await generateSubObjectiveProposals({
      objective,
      clarifying: state.clarifying ?? null,
      ragBlock,
      intent,
      existingProposals: existingProposalsForPrompt,
      annotations: annotations.length > 0 ? annotations : undefined,
      uncoveredLensIndices,
      priorConcepts: priorConcepts.length > 0 ? priorConcepts : undefined,
      // Phase 11 — read HCD mode from space state and bias proposals
      // toward user-role-grounded, prototypable framings.
      hcdMode: state.hcd_mode === true,
    });

    if (mode === "variant" && existingBlock) {
      // ── Variant: APPEND a new batch, keep existing ──
      // Migrate legacy block (no batches[]) by seeding batches with
      // the existing proposals as the "initial" generation.
      const priorBatches: SubObjectiveBatch[] =
        existingBlock.batches && existingBlock.batches.length > 0
          ? existingBlock.batches
          : [
              {
                id: randomUUID(),
                generation_number: 1,
                intent: "initial",
                temperature: 0.55,
                proposals: existingBlock.proposals,
                generated_at: existingBlock.generated_at,
              },
            ];

      const newBatch: SubObjectiveBatch = {
        id: randomUUID(),
        generation_number: priorBatches.length + 1,
        intent: usedIntent,
        parent_batch_id: priorBatches[priorBatches.length - 1].id,
        temperature,
        proposals: rawProposals.map((p) => ({
          ...p,
          batch_id: undefined, // assigned below by flattenBatchProposals
        })),
        generated_at: new Date().toISOString(),
      };

      const nextBatches = [...priorBatches, newBatch];
      const flatProposals = flattenBatchProposals(nextBatches);
      // Pin batch_id on the new batch's proposals so future reads
      // can route a proposal back to its batch.
      newBatch.proposals = newBatch.proposals.map((p) => ({
        ...p,
        batch_id: newBatch.id,
      }));

      const nextBlock: SubObjectiveBlock = {
        proposals: flatProposals,
        batches: nextBatches,
        picked_proposal_ids: existingBlock.picked_proposal_ids,
        picked_goal_ids: existingBlock.picked_goal_ids,
        generated_at: existingBlock.generated_at,
        category: existingBlock.category ?? newCategory,
      };

      const nextSynth = writeSubObjectiveBlock(
        space.synthesis_data,
        nextBlock,
      );
      const writeRes = await db
        .from("spaces")
        .update({ synthesis_data: nextSynth })
        .eq("id", spaceId);
      if (writeRes.error) {
        console.warn(
          "[sub-objectives/propose] failed to persist variant batch:",
          writeRes.error.message,
        );
      }

      // ── Telemetry: variant-lab generation event. The action is
      //    'generate_batch'; proposal_id is null since this is a
      //    batch-level event. batch_intent is the user's chosen
      //    direction — the primary preference signal. ──
      void logDecision(db, {
        userId: auth.user.id,
        spaceId,
        proposalId: null,
        action: "generate_batch",
        batchIntent: usedIntent,
        metadata: {
          batch_id: newBatch.id,
          generation_number: newBatch.generation_number,
          temperature,
          prior_proposal_count: existingProposalsForPrompt?.length ?? 0,
          uncovered_lens_count: uncoveredLensIndices?.length ?? 0,
          lens_size: lensSize,
        },
      });

      return NextResponse.json({
        sub_objectives: nextBlock,
        new_batch_id: newBatch.id,
        prior_concepts: priorConceptsForResponse,
      });
    }

    // ── Initial / regenerate: WIPE batches + reset picks ──
    const newBatch: SubObjectiveBatch = {
      id: randomUUID(),
      generation_number: 1,
      intent: "initial",
      temperature,
      proposals: [],
      generated_at: new Date().toISOString(),
    };
    newBatch.proposals = rawProposals.map((p) => ({
      ...p,
      batch_id: newBatch.id,
    }));

    const block: SubObjectiveBlock = {
      proposals: newBatch.proposals,
      batches: [newBatch],
      picked_proposal_ids: [],
      picked_goal_ids: [],
      generated_at: new Date().toISOString(),
      category: newCategory,
    };

    const nextSynth = writeSubObjectiveBlock(space.synthesis_data, block);
    const writeRes = await db
      .from("spaces")
      .update({ synthesis_data: nextSynth })
      .eq("id", spaceId);
    if (writeRes.error) {
      console.warn(
        "[sub-objectives/propose] failed to persist:",
        writeRes.error.message,
      );
      // Soft-fail: still return the proposals so user can keep going.
    }

    return NextResponse.json({
      sub_objectives: block,
      prior_concepts: priorConceptsForResponse,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `propose failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

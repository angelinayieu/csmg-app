// ── POST /api/pipeline/generate-lab-options ─────────────────────────
//
// Phase 2 / Week 4 / W4.7. Wraps the runLabOptions library to:
//   1. Load the user's chosen problem framing (from the approved
//      problem_twin row for this space)
//   2. Optionally pre-load sub-problems + KG candidate entities to
//      help the LLM resolve primary_iv/primary_dv by entity_id
//   3. Run all 5 lab-design stances in parallel
//   4. Persist as twin_proposals(kind='lab_twin')
//   5. Emit the lab_proposed event so the chrome card + (future)
//      gate page light up immediately
//
// Slot in the strategy chain:
//   strategy-refresh
//     → wireTwinProposalAndMechanisms (strategy_twin row lands)
//     → [THIS ROUTE in after()]  generate-lab-options
//     → twin_proposals(kind='lab_twin', user_status='proposed' for divergent
//       OR 'approved' for fallback path)
//     → lab_proposed event → chrome card
//     → user picks via /app/space/[id]/lab/pick → /lab/select
//     → lab_scaffolds bridge materializes the canonical row
//     → existing wizard + subject pipeline keeps working unchanged
//
// Path-aware user_status (mirrors W2.1 framing pattern):
//   • DIVERGENT path (lab options came from ≥1 real stance — at
//     least one stance produced a non-fallback option): insert as
//     'proposed'. The chrome card stays visible with "Review N labs →"
//     CTA. User picks via gate page.
//   • FALLBACK path (fallback_used=true, all 5 stances declined or
//     failed): insert as 'approved' and auto-emit lab_approved.
//     There's nothing meaningful to pick between; the single
//     observational option is a placeholder.
//
// Body:
//   {
//     space_id: string (required)
//     run_id?: string (optional — SSE run context for events)
//     dry_run?: boolean (default false — when true, run the library
//                       without persisting or emitting)
//     subject_access_hint?: string (passthrough to Pragmatist stance)
//     model?: string
//   }
//
// Auth: owner-only via safeAuth + verifySpaceOwnership. Returns 404
// on cross-space access attempts.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import { runLabOptions } from "@/lib/pipeline/lab-options";
import { persistLabScaffold } from "@/lib/pipeline/lab-scaffold-bridge";
import type {
  LabApprovedEvent,
  LabProposedEvent,
} from "@/types/pipeline-events";
import type { LabPayload } from "@/types/lab-options";

export const maxDuration = 60;
export const runtime = "nodejs";

interface GenerateLabOptionsRequest {
  space_id: string;
  run_id?: string | null;
  dry_run?: boolean;
  subject_access_hint?: string;
  model?: string;
}

interface ProblemTwinFramePayload {
  options: Array<{
    framing_id?: string;
    chosen_approach?: string;
    load_bearing_assumption?: string;
    sub_objectives?: string[];
  }>;
  chosen_rank: number;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<GenerateLabOptionsRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json(
      { error: "space_id is required" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const dryRun = body?.dry_run === true;
  const runId =
    typeof body?.run_id === "string" && body.run_id.length > 0
      ? body.run_id
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const startedAt = Date.now();

  try {
    // ── Resolve inputText from spaces.* (mirrors frame-panel route) ──
    const { data: spaceRow } = await db
      .from("spaces")
      .select("id, name, primary_goal, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();

    if (!spaceRow) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    let inputText = "";
    const synth = (spaceRow as { synthesis_data?: Record<string, unknown> | null })
      .synthesis_data;
    if (synth && typeof synth === "object") {
      const s = synth as Record<string, unknown>;
      if (typeof s.initial_prompt === "string") inputText = s.initial_prompt;
      else if (typeof s.intake_summary === "string") inputText = s.intake_summary;
    }
    if (!inputText) {
      const name = (spaceRow as { name?: string }).name;
      const goal = (spaceRow as { primary_goal?: string }).primary_goal;
      inputText = [name, goal].filter(Boolean).join(" — ");
    }
    if (!inputText || inputText.length < 6) {
      return NextResponse.json(
        { error: "Could not resolve input_text for lab options" },
        { status: 400 },
      );
    }

    // ── Load approved problem_twin for framing context ──────────────
    //
    // The lab MUST test the chosen problem framing, not the user's
    // stated goal. Without an approved problem_twin, we still proceed
    // (the stances handle empty chosenFramingContext) but it'll
    // produce weaker labs — the prompt explicitly says so.
    let chosenFramingContext = "";
    let subProblems: string[] = [];
    try {
      const { data: framingRow } = await db
        .from("twin_proposals")
        .select("frame_payload")
        .eq("space_id", spaceId)
        .eq("user_id", user.id)
        .eq("kind", "problem_twin")
        .eq("user_status", "approved")
        .order("approved_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (framingRow) {
        const fp = (framingRow as { frame_payload: ProblemTwinFramePayload | null })
          .frame_payload;
        if (fp && Array.isArray(fp.options)) {
          const chosenIdx = Math.max(0, (fp.chosen_rank ?? 1) - 1);
          const chosen = fp.options[chosenIdx];
          if (chosen) {
            const parts: string[] = [];
            if (chosen.chosen_approach) {
              parts.push(`Chosen approach: ${chosen.chosen_approach}`);
            }
            if (chosen.load_bearing_assumption) {
              parts.push(
                `Load-bearing assumption: ${chosen.load_bearing_assumption}`,
              );
            }
            chosenFramingContext = parts.join("\n\n");
            subProblems = Array.isArray(chosen.sub_objectives)
              ? chosen.sub_objectives.filter(
                  (s): s is string => typeof s === "string",
                )
              : [];
          }
        }
      }
    } catch (framingErr) {
      console.warn(
        "[generate-lab-options] problem_twin load soft-failed:",
        framingErr instanceof Error ? framingErr.message : framingErr,
      );
    }

    // ── Load candidate entities for IV/DV resolution ────────────────
    //
    // Surface the highest-importance entities so the LLM can pick
    // them by name/entity_id rather than inventing new ones. Capped
    // at 12 to keep the prompt budget controlled. The proto-entities
    // materialized at framing-approval time (Week 3) naturally land
    // in this list because they carry importance='primary'/'secondary'.
    let candidateEntities: Array<{ entity_id: string; name: string }> = [];
    try {
      const { data: entityRows } = await db
        .from("entities")
        .select("id, name, importance")
        .eq("space_id", spaceId)
        .in("importance", ["primary", "secondary"])
        .order("importance", { ascending: true }) // primary before secondary
        .limit(12);
      if (Array.isArray(entityRows)) {
        candidateEntities = (
          entityRows as Array<{ id: string; name: string }>
        ).map((e) => ({ entity_id: e.id, name: e.name }));
      }
    } catch (entitiesErr) {
      console.warn(
        "[generate-lab-options] entity load soft-failed:",
        entitiesErr instanceof Error ? entitiesErr.message : entitiesErr,
      );
    }

    // ── Run the 5-stance library ─────────────────────────────────────
    const result = await runLabOptions({
      inputText,
      chosenFramingContext,
      subProblems,
      candidateEntities,
      subjectAccessHint: body?.subject_access_hint,
      model: body?.model,
    });

    if (dryRun) {
      return NextResponse.json({
        space_id: spaceId,
        dry_run: true,
        payload: result.payload,
        chosen_lens: result.chosenLens,
        stats: result.stats,
        duration_ms: Date.now() - startedAt,
      });
    }

    // ── Path-aware user_status ───────────────────────────────────────
    //
    // Mirrors the framing approach. When the lib used its fallback
    // (all stances declined or failed), there's nothing meaningful
    // to pick between — auto-approve + auto-emit lab_approved. When
    // ≥1 real stance produced an option, leave as 'proposed' so the
    // user reviews via the gate page.
    const usedFallback = result.stats.fallback_used;
    const realOptionCount = result.payload.options.length;
    const userStatus: "proposed" | "approved" = usedFallback
      ? "approved"
      : "proposed";

    // ── Supersede prior pending lab_twin rows ────────────────────────
    // Mirrors the wireTwinProposalAndMechanisms supersede sweep but
    // scoped to kind='lab_twin'. Uses the
    // idx_twin_proposals_pending_by_kind partial index for O(log n).
    const { error: supersedeErr } = await db
      .from("twin_proposals")
      .update({ user_status: "superseded" })
      .eq("space_id", spaceId)
      .eq("kind", "lab_twin")
      .eq("user_status", "proposed");
    if (supersedeErr) {
      console.warn(
        "[generate-lab-options] supersede-prior-lab-twin failed (proceeding with insert):",
        supersedeErr.message ?? supersedeErr,
      );
    }

    // ── Insert the lab_twin row ──────────────────────────────────────
    const { data: inserted, error: insertErr } = await db
      .from("twin_proposals")
      .insert({
        space_id: spaceId,
        user_id: user.id,
        kind: "lab_twin",
        lab_payload: result.payload,
        mechanism_ids: [],
        user_status: userStatus,
        ...(userStatus === "approved"
          ? { approved_at: new Date().toISOString() }
          : {}),
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        {
          error: "Failed to insert lab_twin row",
          detail: insertErr?.message ?? "(unknown)",
        },
        { status: 500 },
      );
    }
    const proposalId = (inserted as { id: string }).id;

    // ── Emit lab_proposed (always) ───────────────────────────────────
    const chosenOption = result.payload.options[0]!;
    const proposedEvent: LabProposedEvent = {
      type: "lab_proposed",
      proposalId,
      spaceId,
      optionCount: realOptionCount,
      chosenRank: result.payload.chosen_rank,
      chosenApproach: chosenOption.chosen_approach,
      chosenLens: result.chosenLens,
      confidence: chosenOption.confidence,
    };
    await emitStructuralEvent(db, runId, proposedEvent).catch((emitErr) => {
      console.warn(
        "[generate-lab-options] lab_proposed emit failed (non-fatal):",
        emitErr instanceof Error ? emitErr.message : emitErr,
      );
    });

    // ── Emit lab_approved ONLY for the fallback path ────────────────
    // The divergent path waits for /lab/select to flip status — that
    // route emits lab_approved with approvalMode='user'.
    if (userStatus === "approved") {
      const approvedEvent: LabApprovedEvent = {
        type: "lab_approved",
        proposalId,
        spaceId,
        approvalMode: "auto",
        chosenApproach: chosenOption.chosen_approach,
        flaggedAppsCount: 0, // No prior lab → no apps to flag
      };
      await emitStructuralEvent(db, runId, approvedEvent).catch((emitErr) => {
        console.warn(
          "[generate-lab-options] lab_approved emit (auto path) failed:",
          emitErr instanceof Error ? emitErr.message : emitErr,
        );
      });
    }

    // Sprint W4.11 — lab_scaffolds materialization bridge for the
    // fallback path. The divergent path flips status via /lab/select
    // which also fires the bridge. For the fallback auto-approve
    // here, fire the bridge directly so the existing canvas-lab-
    // proposal-chip + LabProposalWizard pipeline gets its
    // status='proposed' lab_scaffolds row to act on. Soft-fail.
    let labScaffoldId: string | null = null;
    if (userStatus === "approved") {
      const bridgeResult = await persistLabScaffold(db, {
        spaceId,
        userId: user.id,
        twinProposalId: proposalId,
        chosenOption,
        pipelineRunId: runId,
      });
      labScaffoldId = bridgeResult.scaffoldId;
      if (bridgeResult.errors.length > 0) {
        console.warn(
          "[generate-lab-options] lab_scaffolds bridge errors (auto path):",
          bridgeResult.errors,
        );
      }
    }

    return NextResponse.json({
      space_id: spaceId,
      proposal_id: proposalId,
      user_status: userStatus,
      payload: result.payload,
      chosen_lens: result.chosenLens,
      stats: result.stats,
      duration_ms: Date.now() - startedAt,
      lab_scaffold_id: labScaffoldId,
    });
  } catch (err) {
    console.error("[generate-lab-options] failed:", err);
    return NextResponse.json(
      {
        error: `Lab options generation failed: ${sanitizeErrorMessage(err)}`,
      },
      { status: 500 },
    );
  }
}

// ── GET — read-only: fetch the latest lab_twin for a space ─────────
//
// Used by the (future) lab-proposal-gate chrome card to fetch the
// preview payload + by the gate page's server component. Mirrors
// frame-panel/route.ts:GET and twin-proposals/latest/route.ts.

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json(
      { error: "space_id is required" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("twin_proposals")
    .select(
      "id, kind, user_status, lab_payload, generated_at, approved_at",
    )
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .eq("kind", "lab_twin")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(
      "[generate-lab-options GET] query failed:",
      error.message ?? error,
    );
    return NextResponse.json({ proposal: null });
  }

  // Type passthrough — caller knows lab_payload is LabPayload | null.
  const result = data as {
    id: string;
    kind: string;
    user_status: string;
    lab_payload: LabPayload | null;
    generated_at: string;
    approved_at: string | null;
  } | null;

  return NextResponse.json({ proposal: result });
}

// ── POST /api/pipeline/frame-panel ───────────────────────────────────
//
// Runs the 3-lens framing panel (piece 2 of the 2026-04-23 review)
// against a space's intake input and persists the merged SituationFrame
// to spaces.situation_frame (migration 20260528_situation_frame.sql).
//
// Slot in intake/bootstrap:
//   rigor-intake → classify-data-presence → [THIS] frame-panel
//     → frame-extractor (consumes situation_frame) → decompose, ...
//
// Soft-fail throughout: if the panel errors or all lenses degrade to
// empty, spaces.situation_frame stays null and frame-extractor falls
// back to the legacy (type, domain, data_presence) axis selection. No
// regression vs pre-migration.
//
// Inputs:
//   - space_id (required)
//   - input_text (optional, defaults to space's initial_prompt)
//   - run_id (optional, for event bus correlation — panel is non-
//     structural today so no event is emitted)
//   - dry_run (optional): classify without persisting
//   - model (optional): override reasoning model

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { runFramingPanel } from "@/lib/pipeline/framing-panel";
import type { DataPresenceTags } from "@/lib/prompts/data-presence-classifier";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import type {
  FramingProposedEvent,
  FramingApprovedEvent,
} from "@/types/pipeline-events";
import type { SituationFrame } from "@/types/situation-frame";

export const maxDuration = 60;
export const runtime = "nodejs";

interface FramePanelRequest {
  space_id: string;
  input_text?: string;
  run_id?: string | null;
  dry_run?: boolean;
  model?: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<FramePanelRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const dryRun = body?.dry_run === true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const startedAt = Date.now();

  try {
    // ── Resolve input_text and auxiliary signals ──────────────────────
    //
    // Caller may pass input_text for re-framing with edited intake.
    // Otherwise derive from stored space state, preferring
    // synthesis_data.initial_prompt > intake_summary > name+goal. Also
    // read data_presence + rigor_summary if present so the lenses can
    // calibrate (e.g. the operator lens honors has_telemetry).
    let inputText =
      typeof body?.input_text === "string" ? body.input_text.trim() : "";
    let rigorSummary: string | undefined;
    let dataPresence: DataPresenceTags | null = null;

    const { data: spaceRow } = await db
      .from("spaces")
      .select(
        "name, primary_goal, synthesis_data, data_presence, reasoning_settings",
      )
      .eq("id", spaceId)
      .maybeSingle();

    if (!spaceRow) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    const synth = (spaceRow as { synthesis_data?: Record<string, unknown> | null })
      .synthesis_data;
    if (synth && typeof synth === "object") {
      const s = synth as Record<string, unknown>;
      if (!inputText) {
        if (typeof s.initial_prompt === "string") inputText = s.initial_prompt;
        else if (typeof s.intake_summary === "string") inputText = s.intake_summary;
      }
      if (typeof s.rigor_summary === "string") rigorSummary = s.rigor_summary;
    }
    if (!inputText) {
      const name = (spaceRow as { name?: string }).name;
      const goal = (spaceRow as { primary_goal?: string }).primary_goal;
      inputText = [name, goal].filter(Boolean).join(" — ");
    }

    // data_presence column is a JSONB { ...DataPresenceTags, classified_at, ... }
    const dpRaw = (spaceRow as { data_presence?: unknown }).data_presence;
    if (dpRaw && typeof dpRaw === "object") {
      const dp = dpRaw as Record<string, unknown>;
      dataPresence = {
        has_telemetry: Boolean(dp.has_telemetry),
        has_historical_output: Boolean(dp.has_historical_output),
        has_baseline: Boolean(dp.has_baseline),
        has_spec: Boolean(dp.has_spec),
        has_just_idea: Boolean(dp.has_just_idea),
        data_presence_score:
          typeof dp.data_presence_score === "number" ? dp.data_presence_score : 0,
        evidence_excerpts: Array.isArray(dp.evidence_excerpts)
          ? (dp.evidence_excerpts as unknown[]).filter(
              (s): s is string => typeof s === "string",
            )
          : [],
      };
    }

    if (!inputText || inputText.length < 6) {
      return NextResponse.json(
        { error: "Could not resolve input_text for framing panel" },
        { status: 400 },
      );
    }

    // ── User-selected lenses (migration 20260606) ─────────────────────
    //
    // When the user customized lenses in the intake settings panel,
    // honor that selection — skip the lenses they didn't pick. This
    // saves ~500 tokens per skipped lens AND respects the user's
    // explicit "I don't want the historian lens for this prompt"
    // preference. Falls back to all 5 canonical lenses when the
    // column is null (legacy rows or default).
    let userSelectedLenses:
      | readonly (
          | "systems_analyst"
          | "skeptic"
          | "operator"
          | "engineer"
          | "historian"
        )[]
      | undefined = undefined;
    const rsRaw = (spaceRow as { reasoning_settings?: unknown })
      .reasoning_settings;
    if (rsRaw && typeof rsRaw === "object") {
      const rs = rsRaw as { lenses?: unknown };
      if (Array.isArray(rs.lenses) && rs.lenses.length > 0) {
        const valid = (rs.lenses as unknown[]).filter(
          (
            l,
          ): l is
            | "systems_analyst"
            | "skeptic"
            | "operator"
            | "engineer"
            | "historian" =>
            typeof l === "string" &&
            [
              "systems_analyst",
              "skeptic",
              "operator",
              "engineer",
              "historian",
            ].includes(l),
        );
        if (valid.length > 0) userSelectedLenses = valid;
      }
    }

    // ── Run the panel ─────────────────────────────────────────────────
    const result = await runFramingPanel({
      inputText,
      dataPresence,
      rigorSummary,
      model: body?.model,
      // When user selection narrowed the lens set, only call those
      // LLM endpoints. Saves cost AND honors user customization.
      ...(userSelectedLenses ? { lenses: userSelectedLenses } : {}),
    });

    if (dryRun) {
      return NextResponse.json({
        space_id: spaceId,
        dry_run: true,
        frame: result.frame,
        stats: result.stats,
        duration_ms: Date.now() - startedAt,
      });
    }

    // ── Persist to spaces.situation_frame ─────────────────────────────
    //
    // Soft-fail: a failed UPDATE leaves the column null and frame-
    // extractor treats null as legacy behavior. We still return the
    // frame so the caller can surface it / retry if desired.
    const { error: updateErr } = await db
      .from("spaces")
      .update({ situation_frame: result.frame })
      .eq("id", spaceId);

    if (updateErr) {
      console.warn("[frame-panel] persist failed (non-fatal):", updateErr);
    }

    // ── Problem-framing diverge-converge (Phase 1, smallest first step) ─
    //
    // Inserts a twin_proposals(kind='problem_twin') row carrying the
    // merged SituationFrame as a single "option" in frame_payload, then
    // emits framing_proposed + framing_approved (auto-approve). The
    // emission is bracketed by try/catch so a schema mismatch or RLS
    // hiccup NEVER breaks the legacy spaces.situation_frame contract —
    // every downstream stage (decompose, frame-extractor, propose-plan)
    // continues reading from the column, unchanged.
    //
    // Why insert + emit even though there's only ONE candidate today:
    //   • Validates the schema + event contract end-to-end so the gate
    //     page (future) lands on a working substrate.
    //   • Accumulates audit trail (one row per framing pass) the user
    //     can later inspect — even without a UI, the data is right.
    //   • Lets the painter add `framing_proposed` / `framing_approved`
    //     handlers in parallel work without blocking on the divergence
    //     extension to the lens output schema.
    //
    // When the lens output schema is extended to emit per-lens whole
    // framings (instead of just cell slices), the persistence below
    // grows from optionCount: 1 to optionCount: N and the auto-approve
    // is replaced by a real user pick. No further wiring needed here.
    if (!updateErr && body?.run_id) {
      await persistAndEmitProblemTwin({
        db,
        spaceId,
        userId: user.id,
        runId: body.run_id,
        frame: result.frame as SituationFrame,
      }).catch((emitErr) => {
        console.warn(
          "[frame-panel] problem-twin persist+emit failed (non-fatal):",
          emitErr instanceof Error ? emitErr.message : emitErr,
        );
      });
    }

    return NextResponse.json({
      space_id: spaceId,
      run_id: body?.run_id ?? null,
      frame: result.frame,
      stats: result.stats,
      persisted: !updateErr,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[frame-panel] failed:", err);
    return NextResponse.json(
      { error: `Framing panel failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── GET — read-only: fetch current frame for a space ─────────────────

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("spaces")
    .select("id, situation_frame")
    .eq("id", spaceId)
    .maybeSingle();

  if (error) {
    console.error("[frame-panel GET] query failed:", error);
    return NextResponse.json({ error: "Failed to load frame" }, { status: 500 });
  }

  return NextResponse.json({
    space_id: spaceId,
    situation_frame:
      (data as { situation_frame?: unknown } | null)?.situation_frame ?? null,
  });
}

// ── Problem-framing persistence helper ────────────────────────────────
//
// Inserts a twin_proposals(kind='problem_twin') row + emits the two
// framing events. Side-effect only — caller wraps in try/catch so a
// failure here never breaks the legacy spaces.situation_frame contract.
//
// Frame payload shape mirrors the strategy_twin justification convention
// (options[] + chosen_rank + rejected_options[]) so the same
// select_alternative re-rank pattern works when the gate page lands.
// v0 packs the merged SituationFrame into a single option; when the
// 5-lens panel is extended to emit per-lens whole framings,
// options[] grows to N and chosen_rank becomes user-driven.
//
// Supersede: marks any prior pending problem_twin rows for this space
// as 'superseded' before inserting, so the painter always sees ONE
// actionable framing per space.

async function persistAndEmitProblemTwin(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  userId: string;
  runId: string;
  frame: SituationFrame;
}): Promise<void> {
  const { db, spaceId, userId, runId, frame } = args;

  // ── 1. Build frame_payload from per-lens candidate framings ──────────
  //
  // Two paths depending on what the lens panel produced:
  //
  //   A. PER-LENS FRAMINGS PATH (the divergent path) — frame.candidate_
  //      framings has ≥1 entries. Each entry becomes one option[] entry.
  //      chosen_rank=1 lands on the highest-confidence framing (the
  //      consensus pass already sorted them confidence-desc). This is
  //      the real Phase 1 diverge-converge output.
  //
  //   B. MERGED-FRAME FALLBACK (legacy / no lens emitted a framing) —
  //      build a single synthetic option from the merged SituationFrame.
  //      Same shape as path A so downstream consumers (chrome card, gate
  //      page) don't branch. Triggers when ALL lenses returned
  //      candidate_whole_framing: null, or when an old lens response
  //      lacked the field entirely.
  //
  // The `smallest_first_step` sentinel below flags WHICH path produced
  // the row, so future analytics + the gate page UI can disambiguate
  // "real divergence" from "fallback" cases without re-deriving.

  const framings = frame.candidate_framings ?? [];
  const usedDivergentPath = framings.length > 0;

  const options = usedDivergentPath
    ? framings.map((f) => ({
        framing_id: f.framing_id,
        framing_title: f.framing_title,
        chosen_approach: f.chosen_approach,
        load_bearing_assumption: f.load_bearing_assumption,
        proposed_axes: frame.axes,
        supporting_lenses: [f.lens_id],
        why_this_framing: f.chosen_approach,
        when_it_wins: f.when_it_wins,
        when_it_fails: f.when_it_fails,
        sub_objectives: f.sub_problems,
        confidence: f.confidence,
      }))
    : [
        // ── Fallback synthetic option ──
        (() => {
          const dominantSeverity =
            frame.divergences.find((d) => d.severity === "block")?.severity ??
            frame.divergences.find((d) => d.severity === "surface")?.severity ??
            "note";
          const lbaSorted = [...frame.load_bearing_assumptions].sort(
            (a, b) => (b.named_by?.length ?? 0) - (a.named_by?.length ?? 0),
          );
          const fallbackLBA =
            lbaSorted[0]?.assumption ??
            `Gate status: ${frame.gate_status}. No single load-bearing assumption surfaced.`;
          return {
            framing_id: `merged_v1_${dominantSeverity}`,
            framing_title: `Merged framing (${frame.lenses_used.length} lenses)`,
            chosen_approach: `${frame.lenses_used.length}-lens framing (${frame.gate_status}, ${frame.axes.length} axes)`,
            load_bearing_assumption: fallbackLBA,
            proposed_axes: frame.axes,
            supporting_lenses: frame.lenses_used,
            why_this_framing:
              "Auto-derived from the consensus merge — no lens emitted a competing whole framing for this run.",
            when_it_wins:
              "All lenses agreed on the major cells — divergences are surface-level or notes only.",
            when_it_fails:
              "Block-severity divergences exist; the merged frame may be hiding incompatible framings.",
            sub_objectives: [] as string[],
            confidence: frame.framing_confidence,
          };
        })(),
      ];

  // chosen_approach for the FramingProposedEvent — rank-1 option's
  // chosen_approach. This is what the chrome card surfaces on the
  // proposal/approved transition.
  const chosenApproach = options[0]!.chosen_approach;

  // Supporting lenses for the FramingProposedEvent — when the
  // divergent path fires, rank-1's single-lens attribution is the
  // honest one. Fallback path surfaces all lenses since they all
  // contributed to the merge.
  const supportingLensesForEvent = usedDivergentPath
    ? options[0]!.supporting_lenses
    : frame.lenses_used;

  const framePayload = {
    options,
    chosen_rank: 1,
    rejected_options: [] as Array<unknown>,
    framed_at: frame.framed_at,
    /** Sentinel: false when this row came from the divergent path
     *  (≥1 per-lens whole framings), true when it came from the
     *  fallback merged-frame path. Lets the gate page distinguish
     *  "real divergence the user can re-rank" from "synthetic
     *  single option, picker is moot." */
    smallest_first_step: !usedDivergentPath,
  };

  // ── 2. Supersede prior pending problem_twin rows for this space ──────
  // Mirrors the wireTwinProposalAndMechanisms supersede sweep but
  // scoped to kind='problem_twin'. Uses the new
  // idx_twin_proposals_pending_by_kind partial index for O(log n).
  const { error: supersedeErr } = await db
    .from("twin_proposals")
    .update({ user_status: "superseded" })
    .eq("space_id", spaceId)
    .eq("kind", "problem_twin")
    .eq("user_status", "proposed");

  if (supersedeErr) {
    console.warn(
      "[frame-panel] supersede-prior-problem-twin failed (proceeding with insert):",
      supersedeErr.message ?? supersedeErr,
    );
  }

  // ── 3. Insert the new problem_twin row ───────────────────────────────
  // justification is left null (problem_twins live in frame_payload),
  // mechanism_ids is empty (no mechanism commitments at framing time).
  //
  // Sprint W2.1 — path-aware user_status:
  //
  //   • DIVERGENT path (usedDivergentPath = true, ≥1 lens emitted a
  //     candidate_whole_framing → options[] has N entries the user
  //     can meaningfully pick between): insert as 'proposed'. The
  //     chrome card stays visible 30s with the "Review N framings →"
  //     CTA. User picks via the gate page (/app/space/[id]/framing)
  //     which calls /api/spaces/[id]/framing/approve to flip status.
  //
  //   • FALLBACK path (usedDivergentPath = false, single synthetic
  //     option from merged frame — picker is moot): keep
  //     user_status='approved' so nothing changes vs today. The
  //     chrome card briefly flips proposed → approved → auto-dismiss.
  //     This preserves backwards-compatible behavior for runs where
  //     no lens emitted a competing whole framing (legacy responses,
  //     all lenses declined, prompts where stance divergence is
  //     genuinely low).
  //
  // spaces.situation_frame is still written either way (line above),
  // so all downstream consumers (frame-extractor, decompose,
  // propose-plan) continue to operate unchanged.
  const userStatus: "proposed" | "approved" = usedDivergentPath
    ? "proposed"
    : "approved";
  const { data: inserted, error: insertErr } = await db
    .from("twin_proposals")
    .insert({
      space_id: spaceId,
      user_id: userId,
      kind: "problem_twin",
      frame_payload: framePayload,
      mechanism_ids: [],
      user_status: userStatus,
      ...(userStatus === "approved"
        ? { approved_at: new Date().toISOString() }
        : {}),
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    throw new Error(
      `twin_proposals insert failed: ${insertErr?.message ?? "(unknown)"}`,
    );
  }

  const proposalId = (inserted as { id: string }).id;

  // ── 4. Emit framing_proposed → framing_approved ──────────────────────
  // Persist-then-emit (per event-bus contract — soft-fails internally
  // if the run row vanished). Two emits not one so the painter can
  // animate the proposal card landing + then flipping to approved.
  const proposedEvent: FramingProposedEvent = {
    type: "framing_proposed",
    proposalId,
    spaceId,
    optionCount: framePayload.options.length,
    chosenRank: framePayload.chosen_rank,
    chosenApproach,
    supportingLenses: supportingLensesForEvent,
    framingConfidence: frame.framing_confidence,
  };
  await emitStructuralEvent(db, runId, proposedEvent);

  // Sprint W2.1 — only auto-emit framing_approved when the row was
  // inserted as 'approved' (fallback path). For the divergent path,
  // the user has to pick via /api/spaces/[id]/framing/approve — that
  // route emits framing_approved with approvalMode: "user".
  //
  // Effect on chrome card UX:
  //   • Fallback: chrome card animates proposed → approved → dismiss
  //     (same as today's behavior)
  //   • Divergent: chrome card stays visible with the "Review N framings →"
  //     CTA for 30s; on click, gate page handles approval
  if (userStatus === "approved") {
    const approvedEvent: FramingApprovedEvent = {
      type: "framing_approved",
      proposalId,
      spaceId,
      approvalMode: "auto",
      chosenApproach,
    };
    await emitStructuralEvent(db, runId, approvedEvent);
  }
}

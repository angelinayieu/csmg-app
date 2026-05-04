// ── POST /api/pipeline/analyze-situation ─────────────────────────────
//
// Generates the SituationBaseline for a space — the user's CURRENT
// state, mapped before any landscape generation runs. Slotted in the
// intake auto-chain BETWEEN classify-data-presence (which decides the
// twin_mode tier) and frame-extractor (which picks axes). The result
// gives the canvas a top-of-flow "here's what you're working with"
// card and gives downstream stages an explicit `unknowns` list to
// scope research against.
//
// Branching:
//   - twin_mode = "structural" (vague intake, just an idea) → SKIP.
//     Persist `skipped_reason: "twin_mode_structural"` so callers can
//     distinguish "analyzer didn't run" from "analyzer ran and found
//     nothing." Frame-extractor reads situation_baseline === null and
//     proceeds with the legacy flow.
//   - twin_mode = "observational" or "simulation" → RUN. Pulls any
//     ingested_files for this space, builds the asset summaries, and
//     calls the LLM analyzer.
//   - twin_mode = null (classifier hasn't run yet) → SKIP with
//     `skipped_reason: "no_assets_no_richness"`. Won't normally happen
//     in the auto-chain (classify-data-presence runs first), but the
//     route is safe to call independently.
//
// Soft-fails throughout: if the LLM call fails, we persist a
// skipped_reason: "analyzer_failed" baseline so the canvas can still
// render an empty-state situation card without blocking the pipeline.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  buildSituationAnalyzerPrompt,
  validateSituationBaseline,
  SITUATION_ANALYZER_SYSTEM,
  SITUATION_ANALYZER_SCHEMA,
} from "@/lib/prompts/situation-analyzer";
import {
  extractEntitiesFromAsset,
  persistPreExtractedEntities,
} from "@/lib/pipeline/asset-preextractor";
import {
  emitStructuralEvent,
} from "@/lib/events/structural-event-bus";
import type {
  SituationBaseline,
  SituationSkippedReason,
} from "@/types/situation";
import type { AssetClass } from "@/types/asset";
import type { DataPresenceTags } from "@/lib/prompts/data-presence-classifier";

export const maxDuration = 45;
export const runtime = "nodejs";

interface AnalyzeSituationRequest {
  space_id: string;
  input_text?: string;
  run_id?: string | null;
  /** Force a re-analysis even when twin_mode would normally skip
   *  (e.g., user explicitly clicks "build my baseline"). */
  force?: boolean;
  /** Override the model — useful for upgrading to a larger model
   *  when assets are large. */
  model?: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<AnalyzeSituationRequest>>(request);
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

  const force = body?.force === true;
  const runId = typeof body?.run_id === "string" ? body.run_id : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // ── Pull space context ───────────────────────────────────────────
    const { data: spaceRow } = await db
      .from("spaces")
      .select(
        "name, primary_goal, twin_mode, data_presence, synthesis_data, situation_baseline, reasoning_settings",
      )
      .eq("id", spaceId)
      .single();

    // Diagnostic — a baseline silently failing to generate during intake
    // was invisible in logs because every branch soft-fails. This single
    // line tells you on every call: did we enter, what does the row look
    // like, and which gate are we headed into.
    console.log(
      `[analyze-situation] entered space=${spaceId} run=${runId ?? "-"} ` +
        `force=${force} twin_mode=${spaceRow?.twin_mode ?? "null"} ` +
        `has_baseline=${spaceRow?.situation_baseline ? "yes" : "no"}`,
    );

    if (!spaceRow) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    const twinMode = spaceRow.twin_mode as
      | "structural"
      | "observational"
      | "simulation"
      | null;

    // ── Resolve input text ───────────────────────────────────────────
    let inputText =
      typeof body?.input_text === "string" ? body.input_text.trim() : "";
    if (!inputText) {
      const synth = spaceRow.synthesis_data as
        | { initial_prompt?: string }
        | null;
      inputText =
        (synth?.initial_prompt ??
          spaceRow.primary_goal ??
          spaceRow.name ??
          "")
          .toString()
          .trim();
    }

    // ── Pull associated assets ───────────────────────────────────────
    const { data: assetRows } = await db
      .from("ingested_files")
      .select(
        "id, source_name, asset_class, normalized_text, source_type, mime_type",
      )
      .eq("space_id", spaceId)
      .order("created_at", { ascending: true });

    const assets = ((assetRows ?? []) as Array<{
      id: string;
      source_name: string;
      asset_class: AssetClass | null;
      normalized_text: string | null;
      source_type: string | null;
      mime_type: string | null;
    }>).map((row) => ({
      id: row.id,
      sourceName: row.source_name ?? "untitled",
      assetClass: (row.asset_class ?? "internal_doc") as AssetClass,
      contentSnippet: (row.normalized_text ?? "").slice(0, 1500),
    }));

    // ── Reasoning settings — buildBaselineFirst override ────────────
    // When the user toggled "Build baseline first" in the intake
    // settings panel, honor that even on vague intakes (twin_mode =
    // "structural" with no assets). Treats the explicit toggle as
    // equivalent to the body's `force` flag.
    let buildBaselineFirstFromSettings = false;
    const rsRaw = (spaceRow as { reasoning_settings?: unknown })
      .reasoning_settings;
    if (rsRaw && typeof rsRaw === "object") {
      const rs = rsRaw as { buildBaselineFirst?: unknown };
      buildBaselineFirstFromSettings = rs.buildBaselineFirst === true;
    }
    const effectiveForce = force || buildBaselineFirstFromSettings;

    // ── Branching gate ──────────────────────────────────────────────
    // Skip when:
    //   1. twin_mode = "structural" (idea-only) AND no assets attached
    //      AND not forced AND user didn't toggle "Build baseline first"
    //   2. twin_mode null AND no assets AND same conditions
    //
    // We DON'T skip when assets are attached even on structural mode —
    // the user uploaded something, they expect us to read it.
    if (!effectiveForce) {
      const skipReason = decideSkipReason(twinMode, assets.length);
      if (skipReason) {
        const baseline: SituationBaseline = {
          inputs: [],
          process: { steps: [], constraints: [] },
          outputs: { current: [], target: [], gap: [] },
          knowns: [],
          unknowns: [],
          uncertainty_score: 0,
          analyzed_at: new Date().toISOString(),
          skipped_reason: skipReason,
        };
        await persist(db, spaceId, baseline);
        await emit(db, runId, spaceId, baseline, assets.length);
        return NextResponse.json({
          ok: true,
          skipped: true,
          skipped_reason: skipReason,
          baseline,
        });
      }
    }

    if (!inputText && assets.length === 0) {
      // Persist a skipped baseline so the drawer can transition out of
      // "No baseline yet" and tell the user exactly what's missing.
      // Returning a bare 400 here used to make the Re-run button look
      // dead — the spaces row stayed null and the drawer kept rendering
      // NoDataState with no explanation.
      const baseline: SituationBaseline = {
        inputs: [],
        process: { steps: [], constraints: [] },
        outputs: { current: [], target: [], gap: [] },
        knowns: [],
        unknowns: [],
        uncertainty_score: 0,
        analyzed_at: new Date().toISOString(),
        skipped_reason: "no_input_no_assets",
      };
      await persist(db, spaceId, baseline);
      await emit(db, runId, spaceId, baseline, 0);
      return NextResponse.json({
        ok: true,
        skipped: true,
        skipped_reason: "no_input_no_assets",
        baseline,
      });
    }

    // ── Pre-extract entities from each asset ────────────────────────
    //
    // Walk each asset and run the entity-only LLM extractor so the
    // KG already contains user-provided structure when decompose
    // fires downstream. Sequential because we're inside a single
    // route call already; parallel would multiply token cost.
    //
    // Soft-fail per asset: a 5xx on one asset doesn't block the
    // others or the situation analyzer call below. The asset row's
    // preextracted_entity_ids stays empty in that case.
    const preExtractCounts: Array<{ sourceName: string; count: number }> = [];
    for (const asset of assets) {
      try {
        const extracted = await extractEntitiesFromAsset({
          assetId: asset.id,
          sourceName: asset.sourceName,
          assetClass: asset.assetClass,
          contentSnippet: asset.contentSnippet,
          intakeText: inputText,
        });
        if (extracted.length > 0) {
          await persistPreExtractedEntities(db, {
            spaceId,
            userId: user.id,
            assetId: asset.id,
            extracted,
          });
        }
        preExtractCounts.push({
          sourceName: asset.sourceName,
          count: extracted.length,
        });
      } catch (err) {
        console.warn(
          `[analyze-situation] pre-extraction failed for asset ${asset.id}:`,
          err,
        );
        preExtractCounts.push({
          sourceName: asset.sourceName,
          count: 0,
        });
      }
    }

    // ── Run the LLM ──────────────────────────────────────────────────
    const prompt = buildSituationAnalyzerPrompt({
      inputText: inputText || "(no intake text — analyzing assets only)",
      assets,
      dataPresence: (spaceRow.data_presence as DataPresenceTags | null) ?? null,
      twinMode,
    });

    let analyzed: ReturnType<typeof validateSituationBaseline> | null = null;
    try {
      const raw = await llmJSON<unknown>({
        system: SITUATION_ANALYZER_SYSTEM,
        user: prompt,
        responseSchema: SITUATION_ANALYZER_SCHEMA,
        temperature: 0.2,
        maxTokens: 2500,
        model: body?.model,
      });
      analyzed = validateSituationBaseline(raw);
    } catch (err) {
      console.warn("[analyze-situation] LLM call failed:", err);
    }

    if (!analyzed) {
      // Persist a soft-failed baseline so callers can still distinguish
      // "didn't try" from "tried and failed."
      const failed: SituationBaseline = {
        inputs: [],
        process: { steps: [], constraints: [] },
        outputs: { current: [], target: [], gap: [] },
        knowns: [],
        unknowns: ["Analyzer failed; baseline could not be built."],
        uncertainty_score: 1,
        analyzed_at: new Date().toISOString(),
        skipped_reason: "analyzer_failed",
      };
      await persist(db, spaceId, failed);
      await emit(db, runId, spaceId, failed, assets.length);
      return NextResponse.json({
        ok: true,
        skipped: true,
        skipped_reason: "analyzer_failed",
        baseline: failed,
      });
    }

    const baseline: SituationBaseline = {
      ...analyzed,
      analyzed_at: new Date().toISOString(),
      skipped_reason: null,
    };

    await persist(db, spaceId, baseline);
    await emit(db, runId, spaceId, baseline, assets.length);

    return NextResponse.json({
      ok: true,
      baseline,
      // Per-asset pre-extraction summary so UI can surface
      // "Asset X: 4 entities seeded" in the drawer / toast.
      preExtraction: preExtractCounts,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `analyze-situation failed: ${sanitizeErrorMessage(err)}`,
      },
      { status: 500 },
    );
  }
}

function decideSkipReason(
  twinMode: "structural" | "observational" | "simulation" | null,
  assetCount: number,
): SituationSkippedReason | null {
  // User uploaded assets — never skip; they expect us to read them.
  if (assetCount > 0) return null;
  // Vague intake, no assets — skip.
  if (twinMode === "structural") return "twin_mode_structural";
  if (twinMode === null) return "no_assets_no_richness";
  // Has data, no assets — analyze the prose; don't skip.
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function persist(db: any, spaceId: string, baseline: SituationBaseline) {
  try {
    await db
      .from("spaces")
      .update({ situation_baseline: baseline })
      .eq("id", spaceId);
  } catch (err) {
    console.warn("[analyze-situation] persist failed (non-fatal):", err);
  }

  // Phase 4-wire-3 — mirror baseline.unknowns into
  // synthesis_data.open_questions so they appear in the same queue
  // the user already answers in the synthesis drawer. This unifies
  // the two question systems (pre-flight clarifier + post-decompose
  // synthesis questions) into a single answerable surface.
  //
  // Rules:
  //   - Skip when baseline was skipped (skipped_reason !== null).
  //   - Skip empty / whitespace unknowns.
  //   - Dedup against existing open_questions by case-insensitive
  //     question-text match — so re-runs of analyze-situation don't
  //     stack duplicates and pre-flight answers stick around.
  //   - New rows land with no `user_answer` set (the user hasn't
  //     answered yet), priority="high" (analyzer-detected gaps are
  //     worth the user's time), and a why_it_matters that flags the
  //     analyzer as the source.
  try {
    const unknowns = Array.isArray(baseline.unknowns)
      ? baseline.unknowns
          .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
          .map((u) => u.trim())
      : [];
    if (unknowns.length === 0 || baseline.skipped_reason) return;

    const { data: spaceRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();

    const synth =
      (spaceRow?.synthesis_data as Record<string, unknown> | null) ?? {};
    const existing = Array.isArray(synth.open_questions)
      ? (synth.open_questions as Array<{
          question?: unknown;
          [k: string]: unknown;
        }>)
      : [];
    const existingTexts = new Set(
      existing
        .map((q) =>
          typeof q?.question === "string" ? q.question.trim().toLowerCase() : "",
        )
        .filter((s) => s.length > 0),
    );

    const additions = unknowns
      .filter((u) => !existingTexts.has(u.toLowerCase()))
      .map((u) => ({
        question: u,
        why_it_matters:
          "Detected as a gap by the situation analyzer — answering it tightens the landscape and the strategy.",
        priority: "high" as const,
      }));

    if (additions.length === 0) return;

    await db
      .from("spaces")
      .update({
        synthesis_data: {
          ...synth,
          open_questions: [...existing, ...additions],
        },
      })
      .eq("id", spaceId);
  } catch (err) {
    console.warn(
      "[analyze-situation] mirror-unknowns-to-open-questions failed (non-fatal):",
      err,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function emit(
  db: any,
  runId: string | null,
  spaceId: string,
  baseline: SituationBaseline,
  assetCount: number,
) {
  if (!runId) return;
  try {
    await emitStructuralEvent(db, runId, {
      type: "situation_analyzed",
      spaceId,
      uncertaintyScore: baseline.uncertainty_score,
      inputsCount: baseline.inputs.length,
      processStepsCount: baseline.process.steps.length,
      outputsCurrentCount: baseline.outputs.current.length,
      outputsTargetCount: baseline.outputs.target.length,
      knownsCount: baseline.knowns.length,
      unknownsCount: baseline.unknowns.length,
      assetCount,
      skippedReason: baseline.skipped_reason,
    });
  } catch (err) {
    console.warn("[analyze-situation] emit failed (non-fatal):", err);
  }
}

// ── POST /api/brainstorm/space/analysis/run ───────────────────────
//
// Fires a single Tier 2 / Tier 3 operation by key. Result findings
// are merged into the cached cross_room_analysis bag, replacing any
// prior findings from the same analysis_key while preserving the
// rest (including the user's dispositions).
//
// Body: { spaceId, operationKey, mode?: "default" | "force" }
//
// "force" re-runs even if cached findings from this operation_key
// exist against the same state_hash.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { loadCrossRoomState } from "@/lib/objective-canvas/analyses/cross-room-state";
import {
  getAnalysis,
  mergeFindings,
  runOperation,
} from "@/lib/objective-canvas/analyses";
import type {
  AnalysisFinding,
  CrossRoomAnalysisState,
} from "@/lib/objective-canvas/analyses/types";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  spaceId?: string;
  operationKey?: string;
  mode?: "default" | "force";
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const operationKey =
    typeof body?.operationKey === "string" ? body.operationKey : "";
  if (!spaceId || !operationKey) {
    return NextResponse.json(
      { error: "spaceId + operationKey required" },
      { status: 400 },
    );
  }
  const force = body?.mode === "force";

  const mod = getAnalysis(operationKey);
  if (!mod) {
    return NextResponse.json(
      { error: `Unknown operation: ${operationKey}` },
      { status: 404 },
    );
  }
  if (mod.trigger !== "on_demand") {
    return NextResponse.json(
      { error: `Operation ${operationKey} is auto-only — use /scan` },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: ownerRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!ownerRow || ownerRow.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let loaded;
  try {
    // userId enables preference-aware analyses (recommend-next-move
    // reads user_intent_preferences to weight by revealed pattern).
    loaded = await loadCrossRoomState({ db, spaceId, userId: auth.user.id });
  } catch (err) {
    return NextResponse.json(
      { error: "load failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  const cached: CrossRoomAnalysisState | null =
    (loaded.synthesisData?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;

  // Cache short-circuit: same key + same state_hash + not force.
  if (!force && cached && cached.state_hash === loaded.state_hash) {
    const existingForKey = cached.findings.filter(
      (f) => f.analysis_key === operationKey,
    );
    if (existingForKey.length > 0) {
      return NextResponse.json({
        analysis: cached,
        findings_added: existingForKey,
        cached: true,
      });
    }
  }

  // Telemetry-wrap the operation run. Every Tier-2 / Tier-3 analysis
  // call routes through here, so this one wrap covers them all —
  // recommend_next_move, distill_concepts, cross_room_contradictions,
  // and any future on-demand modules. call_site uses the operation
  // key directly (1:1 with the analysis module). artifact_kind is
  // "analysis_finding"; artifact_id is the space-scoped operation
  // key so feedback lands on the correct (op × space) row.
  let freshFindings: AnalysisFinding[];
  try {
    freshFindings = await instrumentedLLMCall(
      {
        db,
        userId: auth.user.id,
        spaceId,
        callSite: `analysis:${operationKey}`,
        modelHint: "gpt-4o",
        artifactKind: "analysis_finding",
        artifactId: `${spaceId}::${operationKey}`,
        metadata: {
          room_count: loaded.state.rooms.length,
          item_count: loaded.state.items.length,
          force_regen: force,
        },
      },
      () => runOperation(operationKey, loaded.state),
    );
  } catch (err) {
    return NextResponse.json(
      { error: "operation failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Drop prior findings for this key, keep everything else.
  const prior = (cached?.findings ?? []).filter(
    (f) => f.analysis_key !== operationKey,
  );
  const merged = mergeFindings(prior, freshFindings);

  const next: CrossRoomAnalysisState = {
    state_hash: loaded.state_hash,
    scanned_at: cached?.scanned_at ?? new Date().toISOString(),
    findings: merged,
  };

  const nextSynth = {
    ...((loaded.synthesisData as Record<string, unknown>) ?? {}),
    cross_room_analysis: next,
  };
  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    console.warn(
      "[analysis/run] persist failed (non-fatal):",
      writeRes.error.message,
    );
  }

  // ── Notebook visibility for the macro rollup operations ──
  // The autopilot runner fires distill_concepts + distill_macro_problems
  // automatically after the scan; without this, those operations are
  // silent in the chat. distill_concepts → `theme_distilled` (its
  // canonical semantic); distill_macro_problems → `macro_rolled_up`
  // (the dedicated action added in 20260909_narration_actions.sql per
  // INTAKE_TO_BRIEF_SURFACING_PLAN.md §4). Each carries a
  // RichNarrationMeta blob with title + body + facts so the chat
  // reads natively when the notebook redesign lands. Soft-fail.
  if (
    operationKey === "distill_concepts" ||
    operationKey === "distill_macro_problems"
  ) {
    const isMacro = operationKey === "distill_macro_problems";
    const opLabel = isMacro ? "macro sub-problems" : "themes";
    const verb = isMacro ? "Rolled up" : "Distilled";
    const action = isMacro ? "macro_rolled_up" : "theme_distilled";
    const titleSample =
      typeof freshFindings[0]?.title === "string"
        ? (freshFindings[0].title as string)
        : "";
    void logDecision(db, {
      userId: auth.user.id,
      spaceId,
      subObjectiveId: null,
      action,
      metadata: {
        operation_key: operationKey,
        finding_count: freshFindings.length,
        narration_title: `${verb} ${freshFindings.length} ${opLabel}`,
        narration_body:
          freshFindings.length === 0
            ? `The ${opLabel} pass ran but found no patterns this time.`
            : titleSample
              ? `${verb} ${freshFindings.length} ${opLabel} from across your rooms. Headline: ${titleSample.slice(0, 140)}.`
              : `${verb} ${freshFindings.length} ${opLabel} from across your rooms.`,
        narration_facts: [
          {
            label: opLabel,
            value: String(freshFindings.length),
            tone: "neutral",
          },
        ],
        narration_tags: ["#macro", `#${operationKey}`],
      },
    });
  }

  return NextResponse.json({
    analysis: next,
    findings_added: freshFindings,
  });
}

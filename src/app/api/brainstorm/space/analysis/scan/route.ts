// ── POST /api/brainstorm/space/analysis/scan ──────────────────────
//
// Runs all Tier 1 analyses across the space's rooms, returning a
// CrossRoomAnalysisState. Idempotent on state_hash — returns cached
// when the underlying state hasn't changed. mode=force re-runs
// regardless.
//
// Body: { spaceId, mode?: "default" | "force" }

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { loadCrossRoomState } from "@/lib/objective-canvas/analyses/cross-room-state";
import { runScan, mergeFindings } from "@/lib/objective-canvas/analyses";
import type {
  AnalysisFinding,
  CrossRoomAnalysisState,
} from "@/lib/objective-canvas/analyses/types";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import { narrateScanComplete } from "@/lib/objective-canvas/compose-rich-narration";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  spaceId?: string;
  mode?: "default" | "force";
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
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership check.
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
    // Pass userId so user_intent_preferences populates on state — the
    // recommend-next-move analysis (and any future preference-aware
    // ones) get the user's revealed pattern without an extra query.
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

  if (
    !force &&
    cached &&
    cached.state_hash === loaded.state_hash &&
    Array.isArray(cached.findings)
  ) {
    return NextResponse.json({
      analysis: cached,
      cached: true,
    });
  }

  // Run all Tier 1 analyses.
  let freshTier1: AnalysisFinding[];
  try {
    freshTier1 = await runScan(loaded.state);
  } catch (err) {
    return NextResponse.json(
      { error: "scan failed", detail: sanitizeErrorMessage(err) },
      { status: 500 },
    );
  }

  // Merge with prior findings to preserve user disposition + cached
  // Tier 2 results.
  const merged = mergeFindings(cached?.findings ?? [], freshTier1);

  const next: CrossRoomAnalysisState = {
    state_hash: loaded.state_hash,
    scanned_at: new Date().toISOString(),
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
      "[analysis/scan] persist failed (non-fatal):",
      writeRes.error.message,
    );
  }

  // Notebook visibility — closes the autopilot's silent ending.
  // Count net-new findings vs the prior cached state so the row can
  // render "swept canvas · 2 new patterns" only when something changed.
  const priorFindingIds = new Set(
    (cached?.findings ?? []).map((f) => f.id),
  );
  const newFindings = merged.filter((f) => !priorFindingIds.has(f.id));
  const newFindingCount = newFindings.length;
  // v3 — rich narration: surfaces a body summarizing what the scan
  // found, plus the top new finding's title for the user to read
  // without expanding.
  const narration = narrateScanComplete({
    findingCount: merged.length,
    newFindingCount,
    topFindings: newFindings.slice(0, 1).map((f) => ({
      title:
        typeof (f as { title?: unknown }).title === "string"
          ? ((f as { title: string }).title as string)
          : ((f as { headline?: string }).headline ?? ""),
      severity:
        typeof (f as { severity?: unknown }).severity === "string"
          ? ((f as { severity: string }).severity as string)
          : undefined,
    })),
  });
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId: null,
    action: "scan_complete",
    metadata: {
      finding_count: merged.length,
      new_finding_count: newFindingCount,
      ...narration,
    },
  });

  return NextResponse.json({ analysis: next });
}

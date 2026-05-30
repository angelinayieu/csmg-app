// ── POST /api/brainstorm/space/[spaceId]/autopilot/log ────────────
//
// Client-side step-status logger for the canvas autopilot. Closes
// the "autopilot runs but the notebook stays silent" gap documented
// in AUTOPILOT_NOTEBOOK_FIX_PLAN.md §Symptom→Root-cause: stages that
// time out, throw, or skip silently (refine after no_variations, soft-
// failed enrichment, soft-failed analysis scan, etc.) leave zero
// notebook rows, so the user watches the autopilot chip spin without
// any record of what actually ran.
//
// Each call appends one sub_objective_decisions row with action
// 'autopilot_iteration' + metadata { stage, status, ... }. The action
// already exists in the CHECK constraint (since Phase 9, last re-
// asserted 20260906_deliverable_visibility.sql) so no migration is
// needed — we reuse it with finer-grained metadata.
//
// Soft-fail throughout: telemetry must NEVER block the runner. Body
// validation rejects unknown stages/statuses so a typo can't pollute
// the timeline.
//
// Body:
//   stage:           "expand" | "score" | "refine" | "enrich_chains"
//                  | "mechanism_spec" | "scan" | "macro_rollup"
//                  | "brief_polish" | "annotate"
//   status:          "skipped" | "failed"
//   subObjectiveId?: string  (room scope; omit for canvas-scoped events)
//   entityId?:       string  (the feature the step targeted)
//   reason?:         string  (free-form: "timeout", "http_500",
//                              "no_variations", "cancelled", ...)

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

const ALLOWED_STAGES = [
  "expand",
  "score",
  "refine",
  "enrich_chains",
  "mechanism_spec",
  "scan",
  "macro_rollup",
  "brief_polish",
  "annotate",
] as const;
type Stage = (typeof ALLOWED_STAGES)[number];

const ALLOWED_STATUSES = ["skipped", "failed"] as const;
type Status = (typeof ALLOWED_STATUSES)[number];

interface Body {
  stage?: string;
  status?: string;
  subObjectiveId?: string;
  entityId?: string;
  reason?: string;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const stageRaw = typeof body?.stage === "string" ? body.stage : "";
  const statusRaw = typeof body?.status === "string" ? body.status : "";
  const stage: Stage | null = (ALLOWED_STAGES as readonly string[]).includes(
    stageRaw,
  )
    ? (stageRaw as Stage)
    : null;
  const status: Status | null = (
    ALLOWED_STATUSES as readonly string[]
  ).includes(statusRaw)
    ? (statusRaw as Status)
    : null;
  if (!stage || !status) {
    return NextResponse.json(
      { error: "stage + status required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership — the spaceId is in the URL so an attacker can't log
  // into someone else's space.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const subObjectiveId =
    typeof body?.subObjectiveId === "string" && body.subObjectiveId.length > 0
      ? body.subObjectiveId
      : null;
  const entityId =
    typeof body?.entityId === "string" && body.entityId.length > 0
      ? body.entityId
      : null;
  const reason =
    typeof body?.reason === "string" && body.reason.length > 0
      ? body.reason.slice(0, 200)
      : null;

  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId,
    action: "autopilot_iteration",
    metadata: {
      stage,
      status,
      ...(entityId ? { entity_id: entityId } : {}),
      ...(reason ? { reason } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

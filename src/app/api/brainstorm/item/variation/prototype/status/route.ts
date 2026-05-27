// ── PATCH /api/brainstorm/item/variation/prototype/status ─────────
//
// Updates a single prototype brief's lifecycle state. Optional
// result_summary captured when status="concluded".
//
// Body: { entityId, briefId, status, result_summary? }
//   status ∈ "planned" | "running" | "concluded" | "abandoned" | null
//   result_summary — optional, only meaningful with concluded

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

type ExperimentStatus =
  | "planned"
  | "running"
  | "concluded"
  | "abandoned"
  | null;

interface Body {
  entityId?: string;
  briefId?: string;
  status?: ExperimentStatus;
  result_summary?: string;
}

const ALLOWED: ReadonlyArray<ExperimentStatus> = [
  "planned",
  "running",
  "concluded",
  "abandoned",
  null,
];

export async function PATCH(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  const briefId = typeof body?.briefId === "string" ? body.briefId : "";
  if (!entityId || !briefId) {
    return NextResponse.json(
      { error: "entityId + briefId required" },
      { status: 400 },
    );
  }
  const status: ExperimentStatus =
    body?.status === null || ALLOWED.includes(body?.status ?? null)
      ? (body?.status ?? null)
      : null;
  const resultSummary =
    typeof body?.result_summary === "string"
      ? body.result_summary.trim().slice(0, 1200)
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: entity } = await db
    .from("entities")
    .select("id, space_id, parent_sub_objective_id, name, expanded_detail")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }

  const { data: ownerRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!ownerRow || ownerRow.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const detail = entity.expanded_detail as ExpandedItemDetail | null;
  if (!detail || !Array.isArray(detail.prototype_briefs)) {
    return NextResponse.json(
      { error: "no prototype_briefs on this entity" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  let found = false;
  let priorStatus: ExperimentStatus = null;
  let variationId: string | null = null;
  const nextBriefs = detail.prototype_briefs.map((b) => {
    if (b.id !== briefId) return b;
    found = true;
    priorStatus = (b.status ?? null) as ExperimentStatus;
    variationId = typeof b.variation_id === "string" ? b.variation_id : null;
    return {
      ...b,
      status,
      status_updated_at: now,
      // Only persist result_summary when status=concluded AND text
      // was provided. Empty string clears any prior summary.
      ...(status === "concluded" && resultSummary !== null
        ? { result_summary: resultSummary }
        : {}),
    };
  });
  if (!found) {
    return NextResponse.json({ error: "brief not found" }, { status: 404 });
  }

  const nextDetail: ExpandedItemDetail = {
    ...detail,
    prototype_briefs: nextBriefs,
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  // Phase 10a — log the lifecycle transition for the Lab Notebook.
  // Only log when status actually changed (avoid noise from idempotent calls).
  if (priorStatus !== status) {
    void logDecision(db, {
      userId: auth.user.id,
      spaceId: entity.space_id,
      subObjectiveId:
        typeof entity.parent_sub_objective_id === "string"
          ? entity.parent_sub_objective_id
          : null,
      proposalId: variationId,
      action: "prototype_status_changed",
      metadata: {
        entity_type: "prototype_brief",
        entity_id: entityId,
        entity_name: typeof entity.name === "string" ? entity.name : null,
        brief_id: briefId,
        prototype_status: status,
        prior_prototype_status: priorStatus,
        ...(status === "concluded" && resultSummary
          ? { result_summary: resultSummary }
          : {}),
      },
    });
  }

  return NextResponse.json({
    brief_id: briefId,
    status,
    status_updated_at: now,
  });
}

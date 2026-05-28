// ── GET /api/brainstorm/sub-objectives/[id]/decisions ─────────────
//
// Phase 9 — Lab Notebook feed. Reads sub_objective_decisions
// scoped to ONE room (via sub_objective_id column, added in
// migration 20260828_lab_notebook_phase9), enriches each row with
// display strings the panel needs (variation names, entity names),
// and returns a cursor-paginated page.
//
// Query params:
//   cursor?: string   ISO timestamp; results returned are STRICTLY
//                     older than this. Omit for first page.
//   limit?: number    default 30, max 100
//   actions?: string  comma-separated action filter, e.g.
//                     "elect,reject,rd_iterate"
//
// Returns NotebookEventPage. Soft-fails on row enrichment — if an
// entity has been deleted, the event still surfaces with the
// entity_name field omitted (the UI handles it).
//
// Why a GET — the notebook is read-only by design. Mutations
// happen through the existing write routes (disposition, refine,
// score, approve, compose) which all log into the table.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type {
  NotebookEvent,
  NotebookEventPage,
} from "@/lib/objective-canvas/notebook-events";
import type { DecisionAction } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

const ALLOWED_ACTIONS: ReadonlyArray<DecisionAction> = [
  "elect",
  "reject",
  "defer",
  "clear",
  "generate_batch",
  "confirm",
  "rd_iterate",
  "score",
  "approve_bet",
  "compose",
  "autopilot_run",
  "autopilot_iteration",
  // Phase 10a — system events + cross-room curation.
  "room_generated",
  "item_expanded",
  "expansion_spawned",
  "prototype_status_changed",
  "finding_acknowledged",
  "finding_dismissed",
  "finding_resolved",
  "theme_distilled",
  "concept_branched",
  "constraints_set",
  "stage_transitioned",
  // Phase 11.4
  "chains_enriched",
  // Phase 11.6
  "baseline_set",
  // Phase 11.A — objective layering events
  "layers_generated",
  "layers_regenerated",
  "layer_position_set",
];

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface DecisionRow {
  id: string;
  user_id: string;
  space_id: string;
  sub_objective_id: string | null;
  proposal_id: string | null;
  action: string;
  batch_intent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { id: subObjectiveId } = await ctx.params;
  if (!subObjectiveId) {
    return NextResponse.json(
      { error: "sub-objective id required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership: ensure the sub-objective belongs to the current user.
  const { data: sub } = await db
    .from("improvement_goals")
    .select("id, user_id, space_id")
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (!sub || sub.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");
  const actionsRaw = url.searchParams.get("actions");
  const limit = Math.min(
    Math.max(1, limitRaw ? parseInt(limitRaw, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  // Parse + validate the actions filter — drop unknown values silently.
  const actionsFilter: DecisionAction[] | null = actionsRaw
    ? actionsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is DecisionAction =>
          (ALLOWED_ACTIONS as ReadonlyArray<string>).includes(s),
        )
    : null;

  // Query — scoped to this sub-objective, newest first, cursor-paginated.
  // We over-fetch by 1 to detect end-of-list cheaply.
  let query = db
    .from("sub_objective_decisions")
    .select(
      "id, user_id, space_id, sub_objective_id, proposal_id, action, batch_intent, metadata, created_at",
      { count: "exact" },
    )
    .eq("sub_objective_id", subObjectiveId)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    query = query.lt("created_at", cursor);
  }
  if (actionsFilter && actionsFilter.length > 0) {
    query = query.in("action", actionsFilter);
  }

  const { data: rowsRaw, count } = await query;
  const rows = (rowsRaw ?? []) as DecisionRow[];
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? sliced[sliced.length - 1]?.created_at ?? null
    : null;

  // ── Enrichment ──
  // Collect the entity_ids + variation_ids referenced in metadata so
  // we can fetch display strings in batch (not per row).
  const entityIds = new Set<string>();
  const variationLookupByEntity = new Map<string, Set<string>>();
  // edge_ids → for approve_bet events the proposal_id IS an edge_id
  // and we want to derive the chain_label by joining edges + entities.
  const edgeIds = new Set<string>();
  for (const r of sliced) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const entityId =
      typeof meta.entity_id === "string"
        ? meta.entity_id
        : null;
    if (entityId) entityIds.add(entityId);
    if (r.action === "elect" || r.action === "reject" || r.action === "defer") {
      // proposal_id is the variation_id, scoped to the entity
      if (r.proposal_id && entityId) {
        const set = variationLookupByEntity.get(entityId) ?? new Set<string>();
        set.add(r.proposal_id);
        variationLookupByEntity.set(entityId, set);
      }
    } else if (r.action === "approve_bet" && r.proposal_id) {
      edgeIds.add(r.proposal_id);
    }
  }

  // Batch-fetch entity names.
  const entityNames = new Map<string, string>();
  if (entityIds.size > 0) {
    const { data: ents } = await db
      .from("entities")
      .select("id, name, expanded_detail")
      .in("id", Array.from(entityIds));
    for (const e of (ents ?? []) as Array<{
      id: string;
      name: string;
      expanded_detail: { variations?: Array<{ id?: string; name?: string }> } | null;
    }>) {
      entityNames.set(e.id, e.name);
      // Pull variation names too if we asked about variations on this entity.
      const lookup = variationLookupByEntity.get(e.id);
      if (lookup && e.expanded_detail && Array.isArray(e.expanded_detail.variations)) {
        for (const v of e.expanded_detail.variations) {
          if (v.id && v.name && lookup.has(v.id)) {
            variationLookupByEntity.set(
              `${e.id}::${v.id}`,
              new Set([v.name]),
            );
          }
        }
      }
    }
  }

  function lookupVariationName(
    entityId: string | null,
    variationId: string | null,
  ): string | null {
    if (!entityId || !variationId) return null;
    const set = variationLookupByEntity.get(`${entityId}::${variationId}`);
    if (!set) return null;
    return set.values().next().value ?? null;
  }

  // Batch-fetch edge metadata for approve_bet events. We want the
  // source/target entity ids so we can render "Distraction Overload
  // → Intentional Browsing Prompter → Reduced Passive Browsing Time".
  // For MVP: just fetch the edge + its source+target names; full
  // chain reconstruction (joining 2 edges into a triplet) is a
  // future enrichment.
  const edgeChainLabels = new Map<string, string>();
  if (edgeIds.size > 0) {
    const { data: edges } = await db
      .from("edges")
      .select("id, source_entity_id, target_entity_id")
      .in("id", Array.from(edgeIds));
    const edgeRows = (edges ?? []) as Array<{
      id: string;
      source_entity_id: string;
      target_entity_id: string;
    }>;
    // Collect names for source+target endpoints.
    const endpointIds = new Set<string>();
    for (const e of edgeRows) {
      endpointIds.add(e.source_entity_id);
      endpointIds.add(e.target_entity_id);
    }
    const endpointNames = new Map<string, string>();
    if (endpointIds.size > 0) {
      const { data: endpointRows } = await db
        .from("entities")
        .select("id, name")
        .in("id", Array.from(endpointIds));
      for (const r of (endpointRows ?? []) as Array<{ id: string; name: string }>) {
        endpointNames.set(r.id, r.name);
      }
    }
    for (const e of edgeRows) {
      const src = endpointNames.get(e.source_entity_id) ?? "?";
      const tgt = endpointNames.get(e.target_entity_id) ?? "?";
      edgeChainLabels.set(e.id, `${src} → ${tgt}`);
    }
  }

  // Build NotebookEvent[].
  const events: NotebookEvent[] = sliced.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const action = r.action as NotebookEvent["action"];
    const entityId = typeof meta.entity_id === "string" ? meta.entity_id : null;
    const entityName = entityId
      ? entityNames.get(entityId) ??
        (typeof meta.entity_name === "string" ? meta.entity_name : null)
      : typeof meta.entity_name === "string"
        ? meta.entity_name
        : null;
    // For variation-scoped events, proposal_id IS the variation_id.
    const variationId =
      action === "elect" || action === "reject" || action === "defer" || action === "clear"
        ? r.proposal_id
        : null;
    const variationName = variationId
      ? lookupVariationName(entityId, variationId) ??
        (typeof meta.variation_name === "string" ? meta.variation_name : null)
      : null;
    // approve_bet: proposal_id IS edge_id; render chain label.
    const chainLabel =
      action === "approve_bet" && r.proposal_id
        ? edgeChainLabels.get(r.proposal_id) ?? null
        : null;

    return {
      id: r.id,
      action,
      created_at: r.created_at,
      subject: {
        sub_objective_id: r.sub_objective_id,
        entity_id: entityId,
        entity_name: entityName,
        variation_id: variationId,
        variation_name: variationName,
        chain_id: null, // future: derive from edge → chain join
        chain_label: chainLabel,
      },
      meta: {
        lift_pct: numberOrUndefined(meta.lift_pct),
        placebo_verdict: stringOrUndefined(meta.placebo_verdict) as
          | "pass"
          | "fail"
          | "skip"
          | undefined,
        top_score: numberOrUndefined(meta.top_score),
        effectiveness_score: numberOrUndefined(meta.effectiveness_score),
        // Phase 11.1 — pass through the evaluation tier so notebook
        // rows can render the MethodBadge alongside the score chip.
        evaluation_method: stringOrUndefined(meta.evaluation_method) as
          | "heuristic"
          | "rubric"
          | "evidence"
          | "simulation"
          | "tested"
          | undefined,
        prior_disposition: stringOrUndefined(meta.prior_disposition) as
          | "elected"
          | "rejected"
          | "deferred"
          | undefined,
        target_root_cause: stringOrUndefined(meta.target_root_cause),
        candidate_count: numberOrUndefined(meta.candidate_count),
        conflicts_open_count: numberOrUndefined(meta.conflicts_open_count),
        integration_points_count: numberOrUndefined(meta.integration_points_count),
        approved:
          typeof meta.approved === "boolean" ? (meta.approved as boolean) : undefined,
        blurb: stringOrUndefined(meta.blurb),
        // ── Phase 10a — system event metadata pass-through ──
        room_layer_counts:
          meta.room_layer_counts && typeof meta.room_layer_counts === "object"
            ? (meta.room_layer_counts as {
                pain?: number;
                features?: number;
                outcomes?: number;
              })
            : undefined,
        variation_count: numberOrUndefined(meta.variation_count),
        had_research:
          typeof meta.had_research === "boolean"
            ? (meta.had_research as boolean)
            : undefined,
        expansion_node_title: stringOrUndefined(meta.expansion_node_title),
        attach_point: stringOrUndefined(meta.attach_point),
        prototype_status: stringOrUndefined(meta.prototype_status) as
          | "planned"
          | "running"
          | "concluded"
          | "abandoned"
          | undefined,
        prior_prototype_status: stringOrUndefined(meta.prior_prototype_status) as
          | "planned"
          | "running"
          | "concluded"
          | "abandoned"
          | undefined,
        result_summary: stringOrUndefined(meta.result_summary),
        finding_id: stringOrUndefined(meta.finding_id),
        finding_title: stringOrUndefined(meta.finding_title),
        finding_category: stringOrUndefined(meta.finding_category),
        finding_severity: stringOrUndefined(meta.finding_severity),
        theme_title: stringOrUndefined(meta.theme_title),
        spawned_sub_objective_id: stringOrUndefined(meta.spawned_sub_objective_id),
        spawned_sub_objective_title: stringOrUndefined(
          meta.spawned_sub_objective_title,
        ),
        canonical_code: stringOrUndefined(meta.canonical_code),
        canonical_display_name: stringOrUndefined(meta.canonical_display_name),
        prior_entity_count: numberOrUndefined(meta.prior_entity_count),
        constraints_summary: stringOrUndefined(meta.constraints_summary),
        stage_from: stringOrUndefined(meta.stage_from) as
          | "clarifying"
          | "picking"
          | "main"
          | "done"
          | undefined,
        stage_to: stringOrUndefined(meta.stage_to) as
          | "clarifying"
          | "picking"
          | "main"
          | "done"
          | undefined,
        chain_count: numberOrUndefined(meta.chain_count),
        chain_ids: Array.isArray(meta.chain_ids)
          ? (meta.chain_ids.filter((s) => typeof s === "string") as string[])
          : undefined,
        // Phase 11.2 — proxy-indicator breakdown for `score` events.
        // Validate the array shape defensively because the row was
        // written by older code paths too (legacy `score` events have
        // no indicator_breakdown — render-time falls back to no chips).
        indicator_breakdown: Array.isArray(meta.indicator_breakdown)
          ? (meta.indicator_breakdown as unknown[])
              .filter(
                (x): x is {
                  indicator: string;
                  avg_score: number;
                  min_confidence: number;
                  outcome_name: string;
                } =>
                  !!x &&
                  typeof x === "object" &&
                  typeof (x as { indicator?: unknown }).indicator === "string" &&
                  typeof (x as { avg_score?: unknown }).avg_score === "number" &&
                  typeof (x as { min_confidence?: unknown }).min_confidence ===
                    "number" &&
                  typeof (x as { outcome_name?: unknown }).outcome_name ===
                    "string",
              )
              .slice(0, 3)
          : undefined,
        indicator_count: numberOrUndefined(meta.indicator_count),
        // Phase 11.4 — chain enrichment metadata pass-through.
        enriched_chain_count: numberOrUndefined(meta.enriched_chain_count),
        new_chains_count: numberOrUndefined(meta.new_chains_count),
        avg_chain_strength: numberOrUndefined(meta.avg_chain_strength),
        orphans_closed: numberOrUndefined(meta.orphans_closed),
        // Phase 11.6 — baseline metadata pass-through.
        indicator_name: stringOrUndefined(meta.indicator_name),
        baseline_value: stringOrUndefined(meta.baseline_value),
        target_value: stringOrUndefined(meta.target_value),
        baseline_unit: stringOrUndefined(meta.baseline_unit),
        baseline_source: stringOrUndefined(meta.baseline_source) as
          | "user"
          | "llm"
          | undefined,
        // Phase 11.A — layer event metadata pass-through.
        // layers_generated / layers_regenerated render the domain
        // template + leaf counts as a compact stack-summary chip.
        // layer_position_set surfaces ordinal shifts (prior → next).
        domain_template: stringOrUndefined(meta.domain_template) as
          | "software"
          | "cognition_health"
          | "business_ops"
          | "behavior_change"
          | "scientific"
          | "generic"
          | undefined,
        layer_count: numberOrUndefined(meta.layer_count),
        variable_count: numberOrUndefined(meta.variable_count),
        influence_count: numberOrUndefined(meta.influence_count),
        previous_state_hash: stringOrUndefined(meta.previous_state_hash),
        triggered_by: stringOrUndefined(meta.triggered_by),
        layer_ordinals: Array.isArray(meta.layer_ordinals)
          ? (meta.layer_ordinals as unknown[]).filter(
              (n): n is number =>
                typeof n === "number" && Number.isFinite(n),
            )
          : undefined,
        prior_layer_ordinals: Array.isArray(meta.prior_layer_ordinals)
          ? (meta.prior_layer_ordinals as unknown[]).filter(
              (n): n is number =>
                typeof n === "number" && Number.isFinite(n),
            )
          : undefined,
      },
    };
  });

  const page: NotebookEventPage = {
    events,
    next_cursor: nextCursor,
    total: typeof count === "number" ? count : events.length,
  };
  return NextResponse.json(page);
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

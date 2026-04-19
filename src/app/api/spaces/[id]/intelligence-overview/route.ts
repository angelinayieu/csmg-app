/**
 * GET /api/spaces/[id]/intelligence-overview
 *
 * Single endpoint powering the Intelligence Dashboard.
 * Aggregates everything the user needs to see the reflexive-loop system
 * working on their behalf — in one request.
 *
 * Returns:
 *   proposed_edges_queue[]  — unreviewed prospector-proposed edges, with full context for inline review
 *   open_questions[]        — all status=open entity_questions across the space
 *   recent_activity[]       — last N pair checks, grouped by session
 *   velocity                — pair-checks/day over last 7 days
 *   questioned_entities     — entities with open questions (deduped, for priority-queue visualization)
 */

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Edge, Entity } from "@/types";
import type { EntityQuestion } from "@/types/entity-question";

export const maxDuration = 15;

export interface ProposedEdgeQueueItem {
  edge: Edge;
  source_entity: { id: string; name: string; entity_category: string };
  target_entity: { id: string; name: string; entity_category: string };
  proposed_at: string;
  reasoning: string | null;
  dimensions_examined: string[];
}

export interface ActivityEntry {
  checked_at: string;
  edge_proposed: boolean;
  examination_level: number;
  entity_a_name: string;
  entity_b_name: string;
  reasoning: string | null;
  resulting_edge_id: string | null;
}

export interface SpaceVelocity {
  checks_last_24h: number;
  checks_last_7d: number;
  edges_found_last_7d: number;
  acceptance_rate_last_30d: number | null;
}

export interface IntelligenceOverview {
  proposed_edges_queue: ProposedEdgeQueueItem[];
  open_questions: Array<EntityQuestion & { entity_name: string }>;
  recent_activity: ActivityEntry[];
  velocity: SpaceVelocity;
  questioned_entity_ids: string[];
  total_entities: number;
  total_edges: number;
  total_pair_checks: number;
  prospector_proposed_edges: number;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const since24h = new Date(now - day).toISOString();
  const since7d = new Date(now - 7 * day).toISOString();
  const since30d = new Date(now - 30 * day).toISOString();

  // Parallel fetch of every aggregate
  const [
    entitiesRes,
    edgesRes,
    openQuestionsRes,
    proposedChecksRes,
    recentChecksRes,
    velocityChecksRes,
    calibrationRowsRes,
  ] = await Promise.all([
    db.from("entities").select("id, name, entity_category, connection_search_count, last_connection_search_at").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db
      .from("entity_questions")
      .select("*")
      .eq("space_id", spaceId)
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    // Prospector-proposed edges with no user_verdict yet
    db
      .from("pairwise_connection_checks")
      .select("*")
      .eq("space_id", spaceId)
      .eq("edge_proposed", true)
      .is("user_verdict", null)
      .not("resulting_edge_id", "is", null)
      .order("checked_at", { ascending: false })
      .limit(30),
    // Recent activity (last 50 checks across the space)
    db
      .from("pairwise_connection_checks")
      .select("checked_at, edge_proposed, examination_level, entity_a_id, entity_b_id, reasoning, resulting_edge_id")
      .eq("space_id", spaceId)
      .order("checked_at", { ascending: false })
      .limit(50),
    // Velocity window: all checks in last 7d
    db
      .from("pairwise_connection_checks")
      .select("checked_at, edge_proposed")
      .eq("space_id", spaceId)
      .gte("checked_at", since7d),
    // Calibration rows (last 30d of reviewed prospector edges)
    db
      .from("pairwise_connection_checks")
      .select("user_verdict")
      .eq("space_id", spaceId)
      .eq("edge_proposed", true)
      .not("user_verdict", "is", null)
      .gte("user_verdict_at", since30d),
  ]);

  const entities = (entitiesRes.data ?? []) as Array<
    Pick<Entity, "id" | "name" | "entity_category"> & {
      connection_search_count?: number;
      last_connection_search_at?: string | null;
    }
  >;
  const edges = (edgesRes.data ?? []) as Edge[];
  const openQuestions = (openQuestionsRes.data ?? []) as EntityQuestion[];

  const entityById = new Map(entities.map((e) => [e.id, e]));
  const edgeById = new Map(edges.map((e) => [e.id, e]));

  // Build proposed-edges review queue with full context
  interface ProposedCheckRow {
    resulting_edge_id: string;
    entity_a_id: string;
    entity_b_id: string;
    checked_at: string;
    reasoning: string | null;
    dimensions_examined: string[] | null;
  }
  const proposedChecks = (proposedChecksRes.data ?? []) as ProposedCheckRow[];
  const proposed_edges_queue: ProposedEdgeQueueItem[] = [];
  for (const check of proposedChecks) {
    if (!check.resulting_edge_id) continue;
    const edge = edgeById.get(check.resulting_edge_id);
    if (!edge) continue; // edge was already deleted
    const source = entityById.get(edge.source_entity_id);
    const target = entityById.get(edge.target_entity_id);
    if (!source || !target) continue;
    proposed_edges_queue.push({
      edge,
      source_entity: {
        id: source.id,
        name: source.name,
        entity_category: source.entity_category,
      },
      target_entity: {
        id: target.id,
        name: target.name,
        entity_category: target.entity_category,
      },
      proposed_at: check.checked_at,
      reasoning: check.reasoning,
      dimensions_examined: check.dimensions_examined ?? [],
    });
  }

  // Activity feed: annotate with entity names
  interface ActivityCheckRow {
    checked_at: string;
    edge_proposed: boolean;
    examination_level: number;
    entity_a_id: string;
    entity_b_id: string;
    reasoning: string | null;
    resulting_edge_id: string | null;
  }
  const recent_activity: ActivityEntry[] = ((recentChecksRes.data ?? []) as ActivityCheckRow[]).map(
    (row) => ({
      checked_at: row.checked_at,
      edge_proposed: row.edge_proposed,
      examination_level: row.examination_level,
      entity_a_name: entityById.get(row.entity_a_id)?.name ?? "?",
      entity_b_name: entityById.get(row.entity_b_id)?.name ?? "?",
      reasoning: row.reasoning,
      resulting_edge_id: row.resulting_edge_id,
    }),
  );

  // Velocity
  const velocityRows = (velocityChecksRes.data ?? []) as Array<{ checked_at: string; edge_proposed: boolean }>;
  let checks24h = 0;
  let edges7d = 0;
  for (const r of velocityRows) {
    if (r.checked_at >= since24h) checks24h++;
    if (r.edge_proposed) edges7d++;
  }

  // Calibration: acceptance rate over last 30d
  const calibRows = (calibrationRowsRes.data ?? []) as Array<{ user_verdict: string }>;
  const accepted = calibRows.filter((r) => r.user_verdict === "accepted").length;
  const acceptance_rate_last_30d = calibRows.length > 0 ? accepted / calibRows.length : null;

  const overview: IntelligenceOverview = {
    proposed_edges_queue,
    open_questions: openQuestions.map((q) => ({
      ...q,
      entity_name: entityById.get(q.entity_id)?.name ?? "Unknown entity",
    })),
    recent_activity,
    velocity: {
      checks_last_24h: checks24h,
      checks_last_7d: velocityRows.length,
      edges_found_last_7d: edges7d,
      acceptance_rate_last_30d,
    },
    questioned_entity_ids: Array.from(new Set(openQuestions.map((q) => q.entity_id))),
    total_entities: entities.length,
    total_edges: edges.length,
    total_pair_checks: velocityRows.length, // note: this is last-7d; total-total comes from coverage-landscape
    prospector_proposed_edges: proposed_edges_queue.length,
  };

  return NextResponse.json(overview);
}

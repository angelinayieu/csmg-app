// ── Run-scoped context reader (Phase 1 Step 8) ──
//
// The blackboard problem (from the intake-whiteboard design doc):
//
// > A long intake spans 10–20 agent calls. Stage 6 has no recollection of
// > what Stage 2 researched unless it's queried from the DB, and the DB
// > query is neighborhood-scoped. Agents run in isolation, re-deriving
// > context every call.
//
// Phase 1 Step 2 shipped the append-only event log (`pipeline_run_events`).
// This module is the read-side complement: a structured summary of what
// a given run has produced so far, derived from the log.
//
// Consumers:
//   - Downstream pipeline stages that want "what happened earlier in
//     this run" without scraping raw events or re-running DB joins
//   - Canvas UI (future audit drawer) showing an at-a-glance summary
//   - The /api/pipeline/runs/[runId]/context endpoint that exposes
//     this to clients
//
// The summary is deliberately structured (typed fields, not free-form
// prose). LLM-generated stage-level summaries can layer on top later
// without reshuffling the underlying data contract.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PipelineRunEventRow,
  PipelineRunRow,
  PipelineStage,
  StructuralEvent,
} from "@/types/pipeline-events";
import { digestStages, type StageDigest } from "./stage-digest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface RunContextStageSummary {
  stage: PipelineStage;
  enteredAt: string | null;
  exitedAt: string | null;
  durationMs: number | null;
  /** Message on the enter event, if any. */
  message: string | null;
  eventCount: number;
  /**
   * Deterministic 1-2 sentence digest rendered from the stage's event
   * slice. See `lib/events/stage-digest.ts`. Consumers (audit panel,
   * downstream prompts) can use this directly without scanning events.
   */
  digest: string | null;
}

export interface RunContextEntitySummary {
  entityId: string;
  entityCode: string | null;
  name: string;
  category: string | null;
  importance: string | null;
}

export interface RunContextEdgeSummary {
  edgeId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  dimension: string;
  polarity: string | null;
  confidence: number;
}

export interface RunContextSourceSummary {
  url: string;
  title: string | null;
  authority: number;
  publishedAt: string | null;
}

export interface RunContextProposalSummary {
  proposalId: string;
  kind: "strategy" | "experiment" | "variant";
  title: string;
  targetEntityId: string | null;
  distribution: {
    p10: number;
    p50: number;
    p90: number;
    mean?: number;
    stddev?: number;
  } | null;
}

export interface RunContext {
  runId: string;
  spaceId: string;
  pipeline: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  /**
   * Totals per event type — quick at-a-glance summary for UI badges
   * and cost/progress estimators.
   */
  counts: {
    entities: number;
    edges: number;
    cycles: number;
    bridges: number;
    proposals: number;
    sources: number;
    predictions: number;
    stageBoundaries: number;
    /** Probability-space shells opened this run (Tier 2 frame-extractor). */
    spaces: number;
    /** Transient entities placed inside space shells (pre-merge). Not yet
     *  persisted to the entities table until cross-space-linker runs. */
    spaceEntities: number;
    /** Transient edges placed inside space shells (pre-merge). */
    spaceEdges: number;
    /** Cross-axis duplicate detections flagged by cross-space-linker. */
    crossSpaceLinks: number;
    /** Structural analogs surfaced by the Phase 2H retrieval pipeline. */
    analogs: number;
  };
  /** Stage timing — one entry per stage that had an enter or exit event. */
  stages: RunContextStageSummary[];
  /** Entities persisted during this run. */
  entities: RunContextEntitySummary[];
  /** Edges persisted during this run. */
  edges: RunContextEdgeSummary[];
  /** External sources consulted during this run. */
  sources: RunContextSourceSummary[];
  /** Ranked proposals emitted this run (with simulated distributions when present). */
  proposals: RunContextProposalSummary[];
  /** Total events in the log, regardless of type. */
  totalEvents: number;
}

const PIPELINE_STAGES: PipelineStage[] = [
  "intake",
  "landscape",
  "kg",
  "proposal",
  "lab",
  "results",
];

/**
 * Build a structured summary of everything `pipeline_run_events` knows
 * about a given run. Single round-trip; the caller is responsible for
 * ownership auth (usually via RLS in Supabase).
 *
 * Returns null when the run doesn't exist.
 */
export async function readRunContext(
  db: AnyDb,
  runId: string,
): Promise<RunContext | null> {
  const { data: runRow } = (await db
    .from("pipeline_runs")
    .select(
      "id, space_id, pipeline, status, started_at, completed_at, error_message",
    )
    .eq("id", runId)
    .maybeSingle()) as { data: Pick<PipelineRunRow, "id" | "space_id" | "pipeline" | "status" | "started_at" | "completed_at" | "error_message"> | null };
  if (!runRow) return null;

  const { data: eventRows } = (await db
    .from("pipeline_run_events")
    .select("*")
    .eq("run_id", runId)
    .order("sequence", { ascending: true })) as {
    data: PipelineRunEventRow[] | null;
  };
  const events: PipelineRunEventRow[] = eventRows ?? [];

  // Per-stage aggregator — first enter wins, last exit wins.
  const stageAcc = new Map<
    PipelineStage,
    { enteredAt: string | null; exitedAt: string | null; message: string | null; count: number }
  >();

  const counts = {
    entities: 0,
    edges: 0,
    cycles: 0,
    bridges: 0,
    proposals: 0,
    sources: 0,
    predictions: 0,
    stageBoundaries: 0,
    spaces: 0,
    spaceEntities: 0,
    spaceEdges: 0,
    crossSpaceLinks: 0,
    analogs: 0,
  };
  const entities: RunContextEntitySummary[] = [];
  const edges: RunContextEdgeSummary[] = [];
  const sources: RunContextSourceSummary[] = [];
  const proposals: RunContextProposalSummary[] = [];

  for (const row of events) {
    const e = row.payload as StructuralEvent;
    switch (e.type) {
      case "entity_added":
        counts.entities++;
        entities.push({
          entityId: e.entityId,
          entityCode: e.entityCode,
          name: e.name,
          category: e.entityCategory,
          importance: e.importance,
        });
        break;
      case "edge_added":
        counts.edges++;
        edges.push({
          edgeId: e.edgeId,
          sourceEntityId: e.sourceEntityId,
          targetEntityId: e.targetEntityId,
          relationshipType: e.relationshipType,
          dimension: e.dimension,
          polarity: e.polarity,
          confidence: e.confidence,
        });
        break;
      case "cycle_detected":
        counts.cycles++;
        break;
      case "bridge_formed":
        counts.bridges++;
        break;
      case "proposal_ready":
        counts.proposals++;
        proposals.push({
          proposalId: e.proposalId,
          kind: e.kind,
          title: e.title,
          targetEntityId: e.targetEntityId ?? null,
          distribution: e.distribution ?? null,
        });
        break;
      case "source_cited":
        counts.sources++;
        sources.push({
          url: e.sourceUrl,
          title: e.title,
          authority: e.authority,
          publishedAt: e.publishedAt,
        });
        break;
      case "prediction_recorded":
        counts.predictions++;
        break;
      case "space_opened":
        counts.spaces++;
        break;
      case "space_entity_added":
        counts.spaceEntities++;
        break;
      case "space_edge_added":
        counts.spaceEdges++;
        break;
      case "cross_space_link":
        counts.crossSpaceLinks++;
        break;
      case "space_merge_begin":
      case "space_merge_complete":
        // No dedicated counter — the merge is a state transition, not
        // a countable artifact. Shell + link counts already reflect it.
        break;
      case "structural_analog_found":
        counts.analogs++;
        break;
      case "stage_boundary": {
        counts.stageBoundaries++;
        const slot = stageAcc.get(e.stage) ?? {
          enteredAt: null,
          exitedAt: null,
          message: null,
          count: 0,
        };
        slot.count++;
        if (e.phase === "enter" && !slot.enteredAt) {
          slot.enteredAt = row.emitted_at;
          if (e.message) slot.message = e.message;
        } else if (e.phase === "exit") {
          slot.exitedAt = row.emitted_at;
          if (e.message && !slot.message) slot.message = e.message;
        }
        stageAcc.set(e.stage, slot);
        break;
      }
      default:
        // Future event types — silently ignored for forward compat.
        break;
    }
  }

  // Compute deterministic per-stage digests from the event slice.
  // Pure function, no LLM — cheap enough to do on every read.
  const digestByStage = new Map<PipelineStage, StageDigest>();
  for (const d of digestStages(events)) {
    digestByStage.set(d.stage, d);
  }

  const stages: RunContextStageSummary[] = PIPELINE_STAGES.filter((s) =>
    stageAcc.has(s),
  ).map((s) => {
    const slot = stageAcc.get(s)!;
    const durationMs =
      slot.enteredAt && slot.exitedAt
        ? new Date(slot.exitedAt).getTime() -
          new Date(slot.enteredAt).getTime()
        : null;
    return {
      stage: s,
      enteredAt: slot.enteredAt,
      exitedAt: slot.exitedAt,
      durationMs,
      message: slot.message,
      eventCount: slot.count,
      digest: digestByStage.get(s)?.digest ?? null,
    };
  });

  return {
    runId: runRow.id,
    spaceId: runRow.space_id,
    pipeline: runRow.pipeline,
    status: runRow.status as RunContext["status"],
    startedAt: runRow.started_at,
    completedAt: runRow.completed_at,
    errorMessage: runRow.error_message,
    counts,
    stages,
    entities,
    edges,
    sources,
    proposals,
    totalEvents: events.length,
  };
}

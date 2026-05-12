// ── Stage digest (Phase 1 Step 8 extension) ──
//
// Generates deterministic 1-2 sentence summaries per pipeline stage
// from its event slice. Pure function — no LLM cost, no extra DB
// round-trip. Templates are keyed on `event_type` so adding new
// structural events just adds a new branch, no other refactor.
//
// Consumers:
//   - Canvas audit panel — shows a human-readable row per stage
//     instead of just duration + event count
//   - Downstream pipelines that want "what did stage N produce" as a
//     tiny prompt-injection snippet without scanning raw events
//   - Future LLM-authored summaries can layer on top (the deterministic
//     digest becomes the `prior` the LLM improves from)

import type {
  PipelineRunEventRow,
  PipelineStage,
  StructuralEvent,
} from "@/types/pipeline-events";

const STAGE_LABELS: Record<PipelineStage, string> = {
  intake: "Intake",
  landscape: "Landscape scouting",
  kg: "Knowledge graph",
  proposal: "Proposals",
  twin: "Digital twin",
  lab: "Lab execution",
  reflexive: "Reflexive loop",
  results: "Results",
};

interface StageBuckets {
  entities: number;
  edges: number;
  cycles: number;
  bridges: number;
  proposals: number;
  sources: number;
  predictions: number;
  // Probability-space Tier 2 work-in-progress signal. These don't
  // persist to the entities table yet (cross-space-linker does that
  // later), but the user should see progress while the shells fill
  // so the digest doesn't lie "no artifacts" during an active run.
  spaceShells: number;
  spaceEntities: number;
  spaceEdges: number;
  crossSpaceLinks: number;
  entityCategories: Map<string, number>;
  edgeDimensions: Map<string, number>;
  authoritySum: number;
  authorityCount: number;
  firstEnterMessage: string | null;
}

function makeBuckets(): StageBuckets {
  return {
    entities: 0,
    edges: 0,
    cycles: 0,
    bridges: 0,
    proposals: 0,
    sources: 0,
    predictions: 0,
    spaceShells: 0,
    spaceEntities: 0,
    spaceEdges: 0,
    crossSpaceLinks: 0,
    entityCategories: new Map(),
    edgeDimensions: new Map(),
    authoritySum: 0,
    authorityCount: 0,
    firstEnterMessage: null,
  };
}

/**
 * Partition the event stream into buckets keyed by pipeline stage,
 * using stage_boundary enter/exit events as the splitter. Events that
 * arrive before the first stage_boundary are ignored (shouldn't
 * happen in practice — every wired pipeline starts with an enter).
 */
function partitionByStage(
  events: PipelineRunEventRow[],
): Map<PipelineStage, StageBuckets> {
  const result = new Map<PipelineStage, StageBuckets>();
  let currentStage: PipelineStage | null = null;

  for (const row of events) {
    const e = row.payload as StructuralEvent;
    if (e.type === "stage_boundary") {
      if (e.phase === "enter") {
        currentStage = e.stage;
        const bucket = result.get(currentStage) ?? makeBuckets();
        if (!bucket.firstEnterMessage && e.message) {
          bucket.firstEnterMessage = e.message;
        }
        result.set(currentStage, bucket);
      }
      continue;
    }
    if (!currentStage) continue;
    const bucket = result.get(currentStage) ?? makeBuckets();
    switch (e.type) {
      case "entity_added":
        bucket.entities++;
        if (e.entityCategory) {
          bucket.entityCategories.set(
            e.entityCategory,
            (bucket.entityCategories.get(e.entityCategory) ?? 0) + 1,
          );
        }
        break;
      case "edge_added":
        bucket.edges++;
        if (e.dimension) {
          bucket.edgeDimensions.set(
            e.dimension,
            (bucket.edgeDimensions.get(e.dimension) ?? 0) + 1,
          );
        }
        break;
      case "cycle_detected":
        bucket.cycles++;
        break;
      case "bridge_formed":
        bucket.bridges++;
        break;
      case "proposal_ready":
        bucket.proposals++;
        break;
      case "source_cited":
        bucket.sources++;
        if (typeof e.authority === "number" && Number.isFinite(e.authority)) {
          bucket.authoritySum += e.authority;
          bucket.authorityCount++;
        }
        break;
      case "prediction_recorded":
        bucket.predictions++;
        break;
      case "space_opened":
        bucket.spaceShells++;
        break;
      case "space_entity_added":
        bucket.spaceEntities++;
        break;
      case "space_edge_added":
        bucket.spaceEdges++;
        break;
      case "cross_space_link":
        bucket.crossSpaceLinks++;
        break;
      default:
        break;
    }
    result.set(currentStage, bucket);
  }

  return result;
}

/**
 * Given a stage's bucket, render a compact 1-2 sentence digest.
 * Sentence 1 is always present (what happened). Sentence 2 only
 * appears when there's interesting secondary content (top categories,
 * average authority, etc.).
 */
function digestForStage(stage: PipelineStage, b: StageBuckets): string {
  const parts: string[] = [];

  const mainItems: string[] = [];
  if (b.entities > 0) mainItems.push(`${b.entities} ${b.entities === 1 ? "entity" : "entities"}`);
  if (b.edges > 0) mainItems.push(`${b.edges} ${b.edges === 1 ? "edge" : "edges"}`);
  if (b.cycles > 0) mainItems.push(`${b.cycles} ${b.cycles === 1 ? "cycle" : "cycles"}`);
  if (b.bridges > 0) mainItems.push(`${b.bridges} ${b.bridges === 1 ? "bridge" : "bridges"}`);
  if (b.sources > 0) mainItems.push(`${b.sources} ${b.sources === 1 ? "source" : "sources"}`);
  if (b.proposals > 0) mainItems.push(`${b.proposals} ${b.proposals === 1 ? "proposal" : "proposals"}`);
  if (b.predictions > 0) mainItems.push(`${b.predictions} ${b.predictions === 1 ? "prediction" : "predictions"}`);

  const label = STAGE_LABELS[stage] ?? stage;
  if (mainItems.length === 0) {
    // Probability-space work-in-progress. These aren't persisted
    // artifacts yet, but the user is watching shells fill — the
    // digest should reflect what they're actually seeing.
    const wip: string[] = [];
    if (b.spaceShells > 0)
      wip.push(`${b.spaceShells} axis ${b.spaceShells === 1 ? "shell" : "shells"}`);
    if (b.spaceEntities > 0)
      wip.push(
        `${b.spaceEntities} in-space ${b.spaceEntities === 1 ? "entity" : "entities"}`,
      );
    if (b.spaceEdges > 0)
      wip.push(`${b.spaceEdges} in-space ${b.spaceEdges === 1 ? "edge" : "edges"}`);
    if (b.crossSpaceLinks > 0)
      wip.push(
        `${b.crossSpaceLinks} cross-axis ${b.crossSpaceLinks === 1 ? "link" : "links"}`,
      );
    if (wip.length > 0) {
      parts.push(`${label}: surveying — ${wip.join(", ")} so far.`);
    } else {
      parts.push(`${label}: in progress.`);
    }
  } else {
    parts.push(`${label}: produced ${mainItems.join(", ")}.`);
  }

  // Sentence 2 — secondary detail when present.
  const detail: string[] = [];
  if (b.entityCategories.size > 0) {
    const top = topN(b.entityCategories, 3);
    if (top.length > 0) {
      detail.push(
        `entity mix: ${top.map((t) => `${t[1]} ${t[0]}`).join(", ")}`,
      );
    }
  }
  if (b.edgeDimensions.size > 0) {
    const top = topN(b.edgeDimensions, 3);
    if (top.length > 0) {
      detail.push(`edges across ${top.map((t) => t[0]).join("/")}`);
    }
  }
  if (b.authorityCount > 0) {
    const avg = b.authoritySum / b.authorityCount;
    detail.push(`avg source authority ${avg.toFixed(2)}`);
  }
  if (detail.length > 0) {
    parts.push(`${detail.join("; ")}.`);
  }

  return parts.join(" ");
}

function topN<K>(map: Map<K, number>, n: number): Array<[K, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export interface StageDigest {
  stage: PipelineStage;
  digest: string;
  entryMessage: string | null;
}

/**
 * Main entry point — stream-level interface. Takes the same event row
 * array the RunContext reader uses (already ordered by sequence) and
 * returns one digest per stage that fired at least an enter event.
 */
export function digestStages(events: PipelineRunEventRow[]): StageDigest[] {
  const buckets = partitionByStage(events);
  const STAGE_ORDER: PipelineStage[] = [
    "intake",
    "landscape",
    "kg",
    "proposal",
    "twin",
    "lab",
    "reflexive",
    "results",
  ];
  const result: StageDigest[] = [];
  for (const stage of STAGE_ORDER) {
    const b = buckets.get(stage);
    if (!b) continue;
    result.push({
      stage,
      digest: digestForStage(stage, b),
      entryMessage: b.firstEnterMessage,
    });
  }
  return result;
}

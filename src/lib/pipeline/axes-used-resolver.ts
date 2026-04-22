// ── Axes-used resolver (Phase 2E · PR 5) ──
//
// Given a set of supporting-entity names (or semantic codes + a
// code→name lookup), returns the subset of probability-space axes
// whose per-axis generator materialized a matching entity for this
// run. Lets downstream consumers (strategy + app emitters) tag each
// `proposal_ready` event with `axes_used: ProbabilitySpaceAxis[]` so
// the proposal card can render axis-colored provenance badges.
//
// Matching is normalized-name exact match against every
// `space_entity_added` event in this run. Why exact and not fuzzy:
// the linker already merged near-duplicates before any strategy
// referenced them; at this stage, two distinct normalized names
// mean two distinct concepts. Pass 2 (embedding cosine) is a
// separate matching layer scoped to pre-merge linker work.
//
// v1 scope — DOES NOT:
//   - Traverse the KG to find "adjacent" axis coverage. Only direct
//     name matches count. Transitive support ("this axis supports
//     entity X which feeds decision Y which grounds strategy Z")
//     would need pathway tracing; deferred to a future PR.
//   - Weight axes by how many supporting entities they contribute.
//     Currently all axes appear equally in `axes_used`. Weighted
//     provenance is a natural extension — add a parallel `axis_weight`
//     map when the UI wants to prioritize chips.
//
// Soft-fail: if the query errors or no `space_entity_added` events
// exist for this run (run predates PR 2), returns an empty array.
// Empty → caller emits an event with `axes_used: []`, which the UI
// treats as "no axis coverage" (no badge row rendered).

import type {
  ProbabilitySpaceAxis,
  SpaceEntityAddedEvent,
} from "@/types/pipeline-events";

/** Kept in lockstep with the cross-space-linker normalizer + rail
 *  chip normalizer so matches are consistent across the pipeline. */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

/** Minimal row shape we pull from `pipeline_run_events`. */
interface RawEventRow {
  event_type: string;
  payload: unknown;
}

/**
 * Load all `space_entity_added` events for a pipeline run and return
 * a map of normalized-name → set-of-axes. Single DB round-trip; the
 * resulting map is cheap to query for each proposal that needs
 * axis resolution within the same run.
 */
export async function loadRunAxisIndex(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  runId: string,
): Promise<Map<string, Set<ProbabilitySpaceAxis>>> {
  const { data, error } = await db
    .from("pipeline_run_events")
    .select("event_type, payload")
    .eq("run_id", runId)
    .eq("event_type", "space_entity_added");

  if (error || !Array.isArray(data)) {
    return new Map();
  }

  const index = new Map<string, Set<ProbabilitySpaceAxis>>();
  for (const row of data as RawEventRow[]) {
    if (row.event_type !== "space_entity_added") continue;
    const p = row.payload as Partial<SpaceEntityAddedEvent>;
    if (typeof p.name !== "string" || typeof p.spaceKey !== "string") continue;
    // spaceKey shape: `${runId}:${axis}`
    const parts = p.spaceKey.split(":");
    const axis = parts[parts.length - 1] as ProbabilitySpaceAxis;
    if (!axis) continue;
    const key = normalizeName(p.name);
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(axis);
  }
  return index;
}

/**
 * Resolve axes for a proposal given its supporting-entity names.
 * Names can be the display names of supporting entities (from the
 * decompose `entities` table) — the matcher normalizes both sides.
 * Duplicates in `names` are fine.
 *
 * Returns the axes sorted by canonical order so UI badge rows are
 * stable across reloads of the same proposal.
 */
export function resolveAxesForNames(
  names: Iterable<string>,
  axisIndex: Map<string, Set<ProbabilitySpaceAxis>>,
): ProbabilitySpaceAxis[] {
  const hit = new Set<ProbabilitySpaceAxis>();
  for (const n of names) {
    if (!n) continue;
    const key = normalizeName(n);
    const axes = axisIndex.get(key);
    if (axes) {
      for (const a of axes) hit.add(a);
    }
  }
  return sortAxes(Array.from(hit));
}

/**
 * Run-level fallback: every axis that produced at least one entity
 * during this run. Used when a proposal has no supporting-entity
 * metadata at all — we still want to say "this run considered N
 * lenses" rather than blanking the badge row.
 *
 * Call once per run; returns all the axes in the index.
 */
export function runLevelAxes(
  axisIndex: Map<string, Set<ProbabilitySpaceAxis>>,
): ProbabilitySpaceAxis[] {
  const all = new Set<ProbabilitySpaceAxis>();
  for (const axes of axisIndex.values()) {
    for (const a of axes) all.add(a);
  }
  return sortAxes(Array.from(all));
}

// Canonical display order. Matches the order in AXIS_CATALOG /
// AXIS_ORDER — keep in sync if that file changes.
const AXIS_SORT: Record<ProbabilitySpaceAxis, number> = {
  financial: 0,
  timeline: 1,
  actors: 2,
  causal_scenarios: 3,
  evidence: 4,
  assumptions: 5,
  risk: 6,
  cultural: 7,
};

function sortAxes(axes: ProbabilitySpaceAxis[]): ProbabilitySpaceAxis[] {
  return axes.sort((a, b) => AXIS_SORT[a] - AXIS_SORT[b]);
}

/**
 * Space-scoped axis index loader for endpoints that run OUTSIDE the
 * original decompose/synthesize run (most notably `generate-apps`,
 * which starts its own pipeline_run). Finds the most recent
 * pipeline_run for this space that emitted any `space_entity_added`
 * events and builds the axis index from that run.
 *
 * If no run in the space has axis events (legacy spaces, or runs
 * that predate PR 1-2), returns an empty map. Callers get empty
 * axes_used → UI hides the badge row.
 */
export async function loadLatestSpaceAxisIndex(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
): Promise<Map<string, Set<ProbabilitySpaceAxis>>> {
  // Find the most recent run_id for this space that has at least one
  // space_entity_added event. We query pipeline_runs ordered by
  // started_at DESC, then filter-down client-side by checking the
  // events table — a join-based approach would be cleaner but
  // Supabase's query builder makes this awkward without an RPC, and
  // the client-side loop is bounded (we look at ≤20 recent runs).
  const { data: runs } = await db
    .from("pipeline_runs")
    .select("id")
    .eq("space_id", spaceId)
    .order("started_at", { ascending: false })
    .limit(20);

  const runIds = ((runs ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (runIds.length === 0) return new Map();

  // Pull the space_entity_added events for any of those runs in one
  // query. Use the first run_id that yields matches as the axis
  // source — older runs aren't mixed in.
  const { data: events } = await db
    .from("pipeline_run_events")
    .select("run_id, event_type, payload")
    .in("run_id", runIds)
    .eq("event_type", "space_entity_added");

  const rows = (events ?? []) as Array<{
    run_id: string;
    event_type: string;
    payload: unknown;
  }>;
  if (rows.length === 0) return new Map();

  // Pick the latest run (earliest in runIds order since runs is
  // DESC). If multiple qualify, prefer the most recent.
  let targetRun: string | null = null;
  for (const id of runIds) {
    if (rows.some((r) => r.run_id === id)) {
      targetRun = id;
      break;
    }
  }
  if (!targetRun) return new Map();

  const index = new Map<string, Set<ProbabilitySpaceAxis>>();
  for (const row of rows) {
    if (row.run_id !== targetRun) continue;
    const p = row.payload as Partial<SpaceEntityAddedEvent>;
    if (typeof p.name !== "string" || typeof p.spaceKey !== "string") continue;
    const parts = p.spaceKey.split(":");
    const axis = parts[parts.length - 1] as ProbabilitySpaceAxis;
    if (!axis) continue;
    const key = normalizeName(p.name);
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(axis);
  }
  return index;
}

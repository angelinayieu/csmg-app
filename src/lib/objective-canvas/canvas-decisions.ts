// ── Canvas Decisions ───────────────────────────────────────────────
//
// Server-side aggregator that walks all entities + the cached cross-
// room analysis state and produces a per-room "what needs your
// attention" summary used by <CanvasDecisionSurface> on the main
// Objective Canvas view.
//
// Why server-side: counts roll up cleanly from entities.expanded_detail
// (already in scope on the canvas page load) without firing any new
// queries or LLM calls. Computing client-side would force the page
// to send full expanded_detail blobs over the wire — heavy, and
// pointless since only counts are needed.
//
// Quiet by design: rooms with ZERO pending decisions are dropped from
// the output. The Decision Surface then renders nothing when the
// returned array is empty, keeping the canvas calm.
//
// Soft thresholds (mirroring the drawer's DecisionSurface):
//   • pending_strong_count counts variations where
//     addresses_pain >= 0.6 AND disposition is null
//   • cross-room findings included only when severity is critical|high
//     AND disposition is open|acknowledged (not resolved/dismissed)
//   • friction-shaped categories only: friction | gap | bottleneck

import type {
  AnalysisFinding,
  CrossRoomAnalysisState,
} from "./analyses/types";

export interface RoomDecisionSummary {
  sub_objective_id: string;
  sub_objective_title: string;
  /** Sum of composed_design.conflicts_open[] across all entities in
   *  this room. Each entry is a real user-facing conflict the
   *  composition synthesizer couldn't resolve. */
  conflict_count: number;
  /** Cross-room analysis findings (friction / gap / bottleneck) at
   *  severity high or critical whose references include this room
   *  AND whose disposition is still open or acknowledged. */
  friction_count: number;
  /** Variations with addresses_pain >= 0.6 AND disposition null,
   *  summed across all entities in this room. Strong = the system
   *  thinks the user should make a call on them. */
  pending_strong_count: number;
  /** Total signals (conflict + friction + pending) — used for sort
   *  ordering. Top = highest priority. */
  total_signal: number;
  /** Loudest category present, used by the UI to pick the leading
   *  dot color. "conflict" > "friction" > "pending" > null. */
  top_category: "conflict" | "friction" | "pending" | null;
}

// Minimal entity shape — keeps the helper decoupled from the
// page.tsx full row type. Only the fields read here matter.
export interface EntityForSummary {
  parent_sub_objective_id: string | null;
  expanded_detail: unknown;
}

interface ExpandedDetailLite {
  composed_design?: {
    conflicts_open?: unknown;
  } | null;
  variations?: Array<{
    addresses_pain?: unknown;
    disposition?: unknown;
  }> | null;
}

const ALLOWED_FINDING_CATEGORIES = new Set(["friction", "gap", "bottleneck"]);
const ALLOWED_FINDING_SEVERITIES = new Set(["critical", "high"]);
const LIVE_DISPOSITIONS = new Set(["open", "acknowledged"]);

export function computeRoomDecisionSummaries(args: {
  subs: Array<{ id: string; title: string }>;
  entities: EntityForSummary[];
  /** Either the full cross_room_analysis state OR null. When null,
   *  friction_count is always 0. */
  crossRoomAnalysis?: CrossRoomAnalysisState | null;
}): RoomDecisionSummary[] {
  const { subs, entities, crossRoomAnalysis } = args;

  // Index entities by sub-objective id for O(N) walks.
  const entitiesBySub = new Map<string, EntityForSummary[]>();
  for (const e of entities) {
    const sid = e.parent_sub_objective_id;
    if (!sid) continue;
    const bucket = entitiesBySub.get(sid);
    if (bucket) {
      bucket.push(e);
    } else {
      entitiesBySub.set(sid, [e]);
    }
  }

  // Pre-filter the cross-room findings ONCE — saves repeating the
  // severity/disposition/category check per sub.
  const liveFindings: AnalysisFinding[] = Array.isArray(
    crossRoomAnalysis?.findings,
  )
    ? crossRoomAnalysis.findings.filter(
        (f) =>
          ALLOWED_FINDING_CATEGORIES.has(f.category) &&
          ALLOWED_FINDING_SEVERITIES.has(f.severity) &&
          LIVE_DISPOSITIONS.has(f.disposition),
      )
    : [];

  const summaries: RoomDecisionSummary[] = [];

  for (const sub of subs) {
    const bucket = entitiesBySub.get(sub.id) ?? [];

    let conflictCount = 0;
    let pendingStrongCount = 0;

    for (const e of bucket) {
      const ed = (e.expanded_detail ?? null) as ExpandedDetailLite | null;
      if (!ed) continue;

      // Conflicts open — straight array length, defensive against
      // non-array shapes.
      const conflicts = ed.composed_design?.conflicts_open;
      if (Array.isArray(conflicts)) conflictCount += conflicts.length;

      // Pending strong elections — variations awaiting decision.
      if (Array.isArray(ed.variations)) {
        for (const v of ed.variations) {
          const disposition = v?.disposition ?? null;
          if (disposition !== null && disposition !== undefined) continue;
          const ap =
            typeof v?.addresses_pain === "number" ? v.addresses_pain : 0;
          if (ap >= 0.6) pendingStrongCount += 1;
        }
      }
    }

    // Friction — cross-room findings touching this room.
    let frictionCount = 0;
    for (const f of liveFindings) {
      if (f.references?.room_ids?.includes(sub.id)) frictionCount += 1;
    }

    const totalSignal = conflictCount + frictionCount + pendingStrongCount;
    if (totalSignal === 0) continue;

    summaries.push({
      sub_objective_id: sub.id,
      sub_objective_title: sub.title,
      conflict_count: conflictCount,
      friction_count: frictionCount,
      pending_strong_count: pendingStrongCount,
      total_signal: totalSignal,
      top_category:
        conflictCount > 0
          ? "conflict"
          : frictionCount > 0
            ? "friction"
            : pendingStrongCount > 0
              ? "pending"
              : null,
    });
  }

  // Sort: severity first (conflict > friction > pending), then by
  // total signal count desc. Result: the loudest room is the first
  // row, eye lands on "act here" immediately.
  const CATEGORY_RANK: Record<NonNullable<RoomDecisionSummary["top_category"]>, number> = {
    conflict: 0,
    friction: 1,
    pending: 2,
  };
  summaries.sort((a, b) => {
    const aRank = a.top_category ? CATEGORY_RANK[a.top_category] : 99;
    const bRank = b.top_category ? CATEGORY_RANK[b.top_category] : 99;
    if (aRank !== bRank) return aRank - bRank;
    return b.total_signal - a.total_signal;
  });

  return summaries;
}

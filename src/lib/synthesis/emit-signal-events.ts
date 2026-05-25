// ── emit-signal-events.ts ──
//
// Bridges `extractSignals()` output → pipeline_run_events stream so
// the canvas painter can spawn HiddenSignalShape live during a
// synthesize run.
//
// Without this, signals were being computed twice (pre + post
// synthesis) and persisted into `synthesis_data.signal_extraction`
// but never surfaced anywhere except as tactic-chip slugs in the
// strategy hero card — the most strategically important findings
// were effectively invisible. See pipeline-events.ts for the
// SignalDetectedEvent / SignalClusterEvent schemas.
//
// Filter strategy (capped at ~12 first-class shapes per pass):
//   - Always emit critical cascade vulnerabilities (typically 0-3)
//   - Always emit structural holes with shared_neighbors ≥ 3
//   - Always emit flip-prone loops with weakest_edge_confidence < 0.4
//   - Top 3 hidden variables by inferred-impact heuristic
//   - Everything else collapses into one SignalClusterEvent
//
// Deterministic signalId (stable hash of type + sorted entity_ids)
// means Pass 2 re-emissions UPSERT the same canvas shape rather
// than stacking duplicates. Cluster id is per-space so Pass 2's
// cluster replaces Pass 1's.

import type { SupabaseClient } from "@supabase/supabase-js";
import { emitBatchEvents } from "@/lib/events/structural-event-bus";
import type {
  SignalDetectedEvent,
  SignalClusterEvent,
  StructuralEvent,
} from "@/types/pipeline-events";
import type {
  SignalExtractionResult,
  StructuralHole,
  HiddenVariable,
  CascadeVulnerability,
  FlipProneLoop,
} from "@/lib/intelligence/signal-extraction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** Max individually-emitted shapes per pass. Beyond this, the long
 *  tail rolls into the cluster event. Tuned so a typical run shows
 *  the highest-leverage findings without flooding the canvas. */
const MAX_INDIVIDUAL_SIGNALS = 12;

/** Minimum shared neighbors for a structural hole to escape the
 *  cluster. Holes with 2 shared neighbors are common noise — 3+
 *  is the threshold where it usually represents a real missing
 *  link rather than incidental co-occurrence. */
const STRUCTURAL_HOLE_THRESHOLD = 3;

/** Maximum weakest-edge confidence for a flip-prone loop to escape
 *  the cluster. Loops where the weakest edge is ≥ 0.4 confidence
 *  are not actually flip-prone — the bar is "could realistically
 *  flip", not "has any weak edge". */
const FLIP_LOOP_THRESHOLD = 0.4;

/** Top-N hidden variables to surface individually. */
const TOP_HIDDEN_VARIABLES = 3;

/**
 * Stable deterministic id for a signal. The painter uses this as the
 * tldraw shape id so Pass 2 re-emissions update the same shape.
 *
 * Sorts entity ids before joining so order-independent (a hole
 * between C1-C2 produces the same id as one between C2-C1).
 */
function makeSignalId(
  signalType: SignalDetectedEvent["signalType"],
  primaryEntityIds: string[],
): string {
  const sorted = [...primaryEntityIds].sort();
  return `signal-${signalType}-${sorted.join("-")}`.slice(0, 96);
}

/**
 * Compute severity tier from trajectory_impact × confidence. Used
 * for signal types that don't carry their own severity field
 * (structural_hole, hidden_variable, flip_prone_loop). For
 * cascade_vulnerability we pass through the source's verbatim
 * severity since the detector computes it from richer signals
 * (redundancy + critical downstream count).
 */
function severityFromUrgency(
  trajectoryImpact: number,
  confidence: number,
): SignalDetectedEvent["severity"] {
  const urgency = trajectoryImpact * confidence;
  if (urgency >= 0.55) return "critical";
  if (urgency >= 0.3) return "moderate";
  return "low";
}

/** Map cascade severity → event severity. "high" without a
 *  redundancy path is critical-by-our-tier; everything else is
 *  moderate. Keeps the visual escalation tied to real risk. */
function severityFromCascade(
  cv: CascadeVulnerability,
): SignalDetectedEvent["severity"] {
  if (cv.severity === "critical") return "critical";
  if (cv.severity === "high" && !cv.has_redundancy) return "critical";
  if (cv.severity === "high") return "moderate";
  return "low";
}

// ── Per-type builders ──
//
// Each builder takes a typed signal + returns the SignalDetectedEvent
// (or null if the signal shouldn't promote to canvas).

function buildStructuralHoleEvent(
  hole: StructuralHole,
): SignalDetectedEvent | null {
  if (hole.shared_neighbors < STRUCTURAL_HOLE_THRESHOLD) return null;
  const primaryEntityIds = [hole.entity_a_id, hole.entity_b_id];
  // Confidence scales with shared neighbors; cap at 0.9 to leave
  // headroom (these are inferred, not observed).
  const confidence = Math.min(0.4 + hole.shared_neighbors * 0.12, 0.9);
  const trajectoryImpact = 0.65;
  return {
    type: "signal_detected",
    signalId: makeSignalId("structural_hole", primaryEntityIds),
    signalType: "structural_hole",
    name: `Missing link: ${hole.entity_a_name} ↔ ${hole.entity_b_name}`,
    description: hole.reasoning,
    trajectoryImpact,
    confidence,
    severity: severityFromUrgency(trajectoryImpact, confidence),
    primaryEntityIds,
    secondaryEntityIds: [],
    reasoning: `These two entities share ${hole.shared_neighbors} common neighbors but no direct edge — a hidden connection most likely exists.`,
    validationAction: `Investigate whether ${hole.entity_a_name} influences ${hole.entity_b_name} directly (or vice versa).`,
  };
}

function buildHiddenVariableEvent(
  hv: HiddenVariable,
): SignalDetectedEvent | null {
  const primaryEntityIds = [hv.between_entity_ids[0], hv.between_entity_ids[1]];
  const confidence = 0.55;
  const trajectoryImpact = 0.6;
  return {
    type: "signal_detected",
    signalId: makeSignalId("hidden_variable", primaryEntityIds),
    signalType: "hidden_variable",
    name: `Hidden mediator: ${hv.between_entity_names[0]} → ? → ${hv.between_entity_names[1]}`,
    description: hv.mediation_mechanism,
    trajectoryImpact,
    confidence,
    severity: severityFromUrgency(trajectoryImpact, confidence),
    primaryEntityIds,
    secondaryEntityIds: [],
    reasoning: `An unmodeled variable likely mediates the connection between these two entities. If identified, it becomes a new intervention point.`,
    validationAction: `Identify what mechanism connects "${hv.between_entity_names[0]}" to "${hv.between_entity_names[1]}".`,
  };
}

function buildCascadeVulnerabilityEvent(
  cv: CascadeVulnerability,
): SignalDetectedEvent | null {
  const severity = severityFromCascade(cv);
  // Only promote critical or moderate; lows are noise.
  if (severity === "low") return null;
  const primaryEntityIds = [cv.entity_id];
  return {
    type: "signal_detected",
    signalId: makeSignalId("cascade_vulnerability", primaryEntityIds),
    signalType: "cascade_vulnerability",
    name: `Single point of failure: ${cv.entity_name}`,
    description: `Affects ${cv.downstream_count} downstream entities${cv.has_redundancy ? "" : " with no redundancy"}. ${cv.critical_downstream.length} critical entities in the blast radius.`,
    trajectoryImpact: severity === "critical" ? 0.9 : 0.7,
    confidence: 0.85,
    severity,
    primaryEntityIds,
    secondaryEntityIds: cv.critical_downstream.slice(0, 5),
    reasoning: `The system's trajectory depends on ${cv.entity_name} holding. ${cv.has_redundancy ? "Some alternative paths exist." : "No alternative paths exist to route around its failure."}`,
    validationAction: cv.has_redundancy
      ? `Audit whether the redundant paths actually cover ${cv.entity_name}'s critical functions.`
      : `Build a contingency plan or backup path for ${cv.entity_name}.`,
  };
}

function buildFlipProneLoopEvent(
  fl: FlipProneLoop,
): SignalDetectedEvent | null {
  if (fl.weakest_edge_confidence >= FLIP_LOOP_THRESHOLD) return null;
  const primaryEntityIds = [
    fl.weakest_edge_entity_ids[0],
    fl.weakest_edge_entity_ids[1],
  ];
  const trajectoryImpact = 0.7;
  // Lower edge confidence = higher signal confidence (the gap is the signal).
  const confidence = 1 - fl.weakest_edge_confidence;
  return {
    type: "signal_detected",
    signalId: makeSignalId("flip_prone_loop", primaryEntityIds),
    signalType: "flip_prone_loop",
    name: `Flip-prone ${fl.current_type.replace(/_/g, " ")} loop`,
    description: fl.flip_trigger,
    trajectoryImpact,
    confidence,
    severity: severityFromUrgency(trajectoryImpact, confidence),
    primaryEntityIds,
    secondaryEntityIds: fl.cycle_entity_ids.filter(
      (id) => id !== primaryEntityIds[0] && id !== primaryEntityIds[1],
    ),
    reasoning: `The weakest edge in this cycle has only ${(fl.weakest_edge_confidence * 100).toFixed(0)}% confidence — if it inverts or breaks, the entire loop's polarity could flip.`,
    validationAction: `Validate or replace the weak edge between ${fl.weakest_edge_entity_ids[0]} and ${fl.weakest_edge_entity_ids[1]}.`,
  };
}

// ── Main entry: emit filtered signal events ──

/**
 * Convert a SignalExtractionResult into a batch of pipeline events
 * and emit them. Soft-fail throughout — signal emission never blocks
 * the synthesize pipeline. Returns silently when runId is null
 * (pipeline runs without an event channel) or the result is empty.
 *
 * @param db - Supabase client (server-side, RLS-bypassed for system events)
 * @param runId - pipeline_runs.id; signals are scoped to this run
 * @param result - the output of `extractSignals()`
 * @param spaceId - the space the signals belong to (for the cluster shape)
 */
export async function emitFilteredSignalEvents(
  db: AnyDb,
  runId: string | null,
  result: SignalExtractionResult,
  spaceId: string,
): Promise<void> {
  if (!runId) return;
  try {
    const events: StructuralEvent[] = [];
    let suppressedCount = 0;
    const suppressedTypeCounts = new Map<string, number>();

    // ── Cascade vulnerabilities (highest priority) ──
    // Promote ALL critical ones — they're the most consequential
    // finding the structural pass can produce.
    for (const cv of result.cascade_vulnerabilities) {
      const event = buildCascadeVulnerabilityEvent(cv);
      if (event && events.length < MAX_INDIVIDUAL_SIGNALS) {
        events.push(event);
      } else if (cv.severity !== "moderate") {
        suppressedCount++;
        suppressedTypeCounts.set(
          "cascade_vulnerability",
          (suppressedTypeCounts.get("cascade_vulnerability") ?? 0) + 1,
        );
      }
    }

    // ── Structural holes (above shared-neighbors threshold) ──
    const holeEvents: SignalDetectedEvent[] = [];
    for (const hole of result.structural_holes) {
      const event = buildStructuralHoleEvent(hole);
      if (event) holeEvents.push(event);
    }
    // Sort by shared_neighbors (proxy for confidence) descending.
    holeEvents.sort((a, b) => b.confidence - a.confidence);
    for (const event of holeEvents) {
      if (events.length < MAX_INDIVIDUAL_SIGNALS) {
        events.push(event);
      } else {
        suppressedCount++;
        suppressedTypeCounts.set(
          "structural_hole",
          (suppressedTypeCounts.get("structural_hole") ?? 0) + 1,
        );
      }
    }

    // ── Flip-prone loops (below weakest-edge confidence threshold) ──
    const flipEvents: SignalDetectedEvent[] = [];
    for (const fl of result.flip_prone_loops) {
      const event = buildFlipProneLoopEvent(fl);
      if (event) flipEvents.push(event);
    }
    flipEvents.sort((a, b) => b.confidence - a.confidence);
    for (const event of flipEvents) {
      if (events.length < MAX_INDIVIDUAL_SIGNALS) {
        events.push(event);
      } else {
        suppressedCount++;
        suppressedTypeCounts.set(
          "flip_prone_loop",
          (suppressedTypeCounts.get("flip_prone_loop") ?? 0) + 1,
        );
      }
    }

    // ── Hidden variables (top-N by inferred impact) ──
    // Hidden variables get a smaller individual quota since there's
    // typically a lot of them and the structural ones above are
    // higher-value visualizations.
    const hvEvents: SignalDetectedEvent[] = [];
    for (const hv of result.hidden_variables) {
      const event = buildHiddenVariableEvent(hv);
      if (event) hvEvents.push(event);
    }
    hvEvents.sort((a, b) => b.trajectoryImpact - a.trajectoryImpact);
    for (let i = 0; i < hvEvents.length; i++) {
      if (
        i < TOP_HIDDEN_VARIABLES &&
        events.length < MAX_INDIVIDUAL_SIGNALS
      ) {
        events.push(hvEvents[i]);
      } else {
        suppressedCount++;
        suppressedTypeCounts.set(
          "hidden_variable",
          (suppressedTypeCounts.get("hidden_variable") ?? 0) + 1,
        );
      }
    }

    // Also tally the untyped hypothesis types (assumption_at_risk,
    // temporal_window, analogous_pattern, measurement_gap) that
    // signal-extraction returns in `hypotheses` but has no typed
    // struct for. These always go into the cluster since we have no
    // first-class visual treatment for them yet.
    for (const hyp of result.hypotheses) {
      if (
        hyp.type === "assumption_at_risk" ||
        hyp.type === "temporal_window" ||
        hyp.type === "analogous_pattern" ||
        hyp.type === "measurement_gap"
      ) {
        suppressedCount++;
        suppressedTypeCounts.set(
          hyp.type,
          (suppressedTypeCounts.get(hyp.type) ?? 0) + 1,
        );
      }
    }

    // ── Cluster event ──
    // Only emit a cluster shape when there's actually a tail. Avoids
    // a "+0 lower-priority signals" chip that adds noise.
    if (suppressedCount > 0) {
      const topTypes = Array.from(suppressedTypeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([type, count]) => `${count} ${type.replace(/_/g, " ")}`);
      const clusterEvent: SignalClusterEvent = {
        type: "signal_cluster",
        // Stable per-space cluster id so Pass 2 upserts.
        clusterId: `signal-cluster-${spaceId}`,
        spaceId,
        suppressedCount,
        topTypes,
      };
      events.push(clusterEvent);
    }

    if (events.length === 0) return;

    // Emit as a batch — atomic insert keeps the canvas's painter
    // staggered drain consistent (events fire 50ms apart even when
    // they all land in one DB write).
    await emitBatchEvents(db, runId, events);
  } catch (err) {
    // Hard-fail-safe: signal emission must never block the pipeline.
    console.warn(
      "[emit-signal-events] emission failed (non-critical):",
      err,
    );
  }
}

// ── Entity kind classification (Phase A1.9) ──
//
// The raw `entity_category` field in the graph is useful but not
// user-legible — users think in terms of "is this a TOOL I can reach
// for, or EVIDENCE someone else gathered, or a METRIC I can track?"
// This module derives that user-facing `kind` from existing entity
// metadata (no new columns required; rederives on every catalog load).
//
// Seven kinds that cover every use case we've seen (science evidence,
// personal life planning, CS dev, code artifacts, process modeling):
//   tool · evidence · metric · observation · concept · actor · artifact
//
// If the heuristic is wrong for a given entity, users can override
// later via a `kind` column stored on the entity row — but on day one,
// these rules derive a good-enough signal from data we already have.

import type { Entity } from "@/types";

export type EntityKind =
  | "tool"
  | "evidence"
  | "metric"
  | "observation"
  | "concept"
  | "actor"
  | "artifact";

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  tool: "Tool",
  evidence: "Evidence",
  metric: "Metric",
  observation: "Observation",
  concept: "Concept",
  actor: "Actor",
  artifact: "Artifact",
};

/**
 * Short accent colors per kind. Kept synchronous with the drawer and
 * shape renderers — if a new kind ships, add it here.
 */
export const ENTITY_KIND_ACCENT: Record<EntityKind, string> = {
  tool: "#10B981",        // emerald — "does work"
  evidence: "#8B5CF6",    // violet — "external authority"
  metric: "#0891B2",      // cyan — "measured"
  observation: "#64748B", // slate — "noticed"
  concept: "#A855F7",     // purple — "abstract"
  actor: "#F97316",       // orange — "human"
  artifact: "#334155",    // graphite — "file"
};

// ── Heuristics ───────────────────────────────────────────────────────

const EVIDENCE_SOURCES = new Set([
  "external",
  "research",
  "web",
  "paper",
  "arxiv",
  "citation",
  "literature",
]);

const ARTIFACT_SOURCES = new Set([
  "upload",
  "file",
  "document",
  "attachment",
  "pdf",
  "code",
  "repo",
  "commit",
]);

const ACTOR_NAME_PATTERNS = [
  /\b(user|customer|client|team|person|author|stakeholder|admin|employee|manager|lead|founder|ceo|investor)\b/i,
  /\b(persona|role|audience|demographic)\b/i,
];

const MEASURABLE_PATTERNS = [
  /\d+\s*%|\$\d|\d+\s*(?:ms|sec|min|hour|day|week|month|year|kb|mb|gb)\b/i,
  /\b(rate|count|score|metric|latency|duration|quantity|frequency|ratio|percentage|throughput|retention|churn|nps|mrr|arr|cac|ltv)\b/i,
  /\bper\s+(second|minute|hour|day|week|month)\b/i,
  /\b(avg|median|p\d{2}|p99|p95)\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Classify an entity into one of the 7 kinds. Order of checks matters:
 * source_tag first (most reliable signal), then category-derived, then
 * text heuristics as fallback.
 */
export function classifyEntityKind(entity: Entity): EntityKind {
  const source = String(entity.source_tag ?? "").toLowerCase().trim();
  if (source && EVIDENCE_SOURCES.has(source)) return "evidence";
  if (source && ARTIFACT_SOURCES.has(source)) return "artifact";

  const category = String(entity.entity_category ?? "").toLowerCase().trim();
  const name = String(entity.name ?? "");
  const description = String(entity.description ?? "");
  const text = `${name} ${description}`;

  if (category === "process") return "tool";

  if (category === "relational") {
    // Relational entities split between actors (people/roles) and
    // concepts (abstract relationships). Name pattern matching wins.
    if (matchesAny(name, ACTOR_NAME_PATTERNS)) return "actor";
    return "concept";
  }

  if (category === "epistemic" || category === "abstract") return "concept";

  if (category === "fault") return "observation";

  if (category === "concrete") {
    // Concrete entities can be measurements or qualitative observations
    // — the text tells us which.
    if (matchesAny(text, MEASURABLE_PATTERNS)) return "metric";
    return "observation";
  }

  // Unknown category — final fallback on text signals.
  if (matchesAny(name, ACTOR_NAME_PATTERNS)) return "actor";
  if (matchesAny(text, MEASURABLE_PATTERNS)) return "metric";
  return "observation";
}

/**
 * Given a list of entities, return the distribution of kinds. Useful
 * for auto-detecting the dominant kind in a space so the drawer can
 * surface kind-specific defaults (e.g. a space with 80% evidence gets
 * the evidence filter pre-enabled).
 */
export function kindDistribution(
  entities: readonly Entity[],
): Record<EntityKind, number> {
  const counts: Record<EntityKind, number> = {
    tool: 0,
    evidence: 0,
    metric: 0,
    observation: 0,
    concept: 0,
    actor: 0,
    artifact: 0,
  };
  for (const e of entities) {
    counts[classifyEntityKind(e)] += 1;
  }
  return counts;
}

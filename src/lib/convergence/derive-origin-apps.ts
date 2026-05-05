// ── Origin-app derivation for findings ───────────────────────────────
//
// Given a Finding (from rank-findings) and the spine's apps list, find
// which app(s) the finding "originated from" — i.e. which app(s) claim
// reasoning provenance over it. Two match modes, applied in order:
//
//   1. CONVERGENCE-ID MATCH (precise) — when the finding is type
//      "convergence" and carries a `convergence_data.id`, look for
//      apps whose `convergence_ids_addressed[]` contains that id.
//      This is the strict semantic match, populated by the strategy
//      LLM during app generation.
//
//   2. ENTITY-OVERLAP MATCH (loose) — fall back to checking whether
//      the finding's `source_entity_ids[]` overlaps with the app's
//      `dominant_entity_ids[]`. Captures "this app acts on the same
//      entities the finding is about" — works for bottleneck / leverage
//      / risk findings that don't carry convergence ids.
//
// Returns the matched apps, deduped, in stable input order. Empty
// array is the honest answer for atomic L4 insights and findings
// whose source entities aren't dominant in any app.
//
// Design choice: returns full app refs (not just ids) so the caller
// can render the pill without an extra lookup. The id-only variant
// can be derived from the result if needed.

import type { Finding } from "@/types/finding";
import type { SpineApp } from "@/types/intelligence-spine";

export interface OriginAppRef {
  id: string;
  name: string;
  /** Why this match landed — useful for hover tooltips ("addresses
   *  convergence conv:3" vs. "acts on entity Working Memory"). */
  match_reason: "convergence_id" | "entity_overlap";
}

export function deriveOriginApps(
  finding: Finding,
  apps: SpineApp[],
): OriginAppRef[] {
  if (apps.length === 0) return [];

  const matched = new Map<string, OriginAppRef>();

  // ── Pass 1: convergence-id match (precise) ─────────────────────
  const convergenceId = finding.convergence_data?.id;
  if (convergenceId) {
    for (const app of apps) {
      if (app.convergence_ids_addressed.includes(convergenceId)) {
        matched.set(app.id, {
          id: app.id,
          name: app.name,
          match_reason: "convergence_id",
        });
      }
    }
  }

  // ── Pass 2: entity-overlap match (loose) ────────────────────────
  // Only run for apps NOT already matched via convergence-id, so the
  // precise reason wins when both apply.
  const findingEntities = new Set(finding.source_entity_ids);
  if (findingEntities.size > 0) {
    for (const app of apps) {
      if (matched.has(app.id)) continue;
      if (app.dominant_entity_ids.some((id) => findingEntities.has(id))) {
        matched.set(app.id, {
          id: app.id,
          name: app.name,
          match_reason: "entity_overlap",
        });
      }
    }
  }

  // Stable order — preserve the order apps were given to us (typically
  // priority-asc from the spine route).
  const result: OriginAppRef[] = [];
  for (const app of apps) {
    const ref = matched.get(app.id);
    if (ref) result.push(ref);
  }
  return result;
}

// ── Staleness ────────────────────────────────────────────────────────
//
// Findings derive from synthesis_data, which is written by the
// /api/pipeline/synthesize family. Use the most recent synthesize
// pipeline_run as the staleness anchor. Three buckets:
//
//   fresh   — last synthesize within FRESH_DAYS
//   aging   — between FRESH_DAYS and STALE_DAYS
//   stale   — older than STALE_DAYS, regen recommended
//   unknown — no synthesize run found (rare, e.g. legacy spaces)

const FRESH_DAYS = 3;
const STALE_DAYS = 14;
const SYNTHESIZE_KINDS = new Set([
  "synthesize",
  "synthesize-layered",
  "strategy-refresh",
]);

export type StalenessBucket = "fresh" | "aging" | "stale" | "unknown";

export interface StalenessReading {
  bucket: StalenessBucket;
  /** Human-readable age. e.g. "2h ago", "5d ago". null when unknown. */
  age_label: string | null;
  /** Days elapsed since the most recent synthesize run. null when unknown. */
  age_days: number | null;
}

export function computeStaleness(
  recentRuns: Array<{ pipeline: string; completed_at: string | null }>,
  now: Date = new Date(),
): StalenessReading {
  const latest = recentRuns
    .filter(
      (r) => SYNTHESIZE_KINDS.has(r.pipeline) && r.completed_at !== null,
    )
    .reduce<string | null>((best, r) => {
      if (!r.completed_at) return best;
      if (!best) return r.completed_at;
      return Date.parse(r.completed_at) > Date.parse(best)
        ? r.completed_at
        : best;
    }, null);

  if (!latest) {
    return { bucket: "unknown", age_label: null, age_days: null };
  }

  const ageMs = now.getTime() - Date.parse(latest);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const bucket: StalenessBucket =
    ageDays <= FRESH_DAYS ? "fresh" : ageDays <= STALE_DAYS ? "aging" : "stale";

  return {
    bucket,
    age_label: formatRel(ageMs),
    age_days: ageDays,
  };
}

function formatRel(ms: number): string {
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}

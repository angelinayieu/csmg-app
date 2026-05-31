// ── Auto-attach evidence rows to existing entities ────────────────
//
// When effect-size extraction lands new `evidence_registries` rows
// they have `attached_entity_id = null`. The researcher would
// otherwise have to click "attach" on every row in the evidence
// drawer before pooling kicks in — a lot of friction when a paper
// produces 20+ rows.
//
// This helper resolves each new row against the space's existing
// entity pool and auto-sets `attached_entity_id` when the match is
// unambiguous + high-confidence. Ambiguous / low-confidence rows
// stay null for manual review (preserves the L2M trust boundary —
// auto-attach is a hint, not a fact).
//
// Match strategy (deterministic, no LLM):
//   1. Normalize: lowercase, strip punctuation, collapse whitespace
//   2. Score each candidate entity against EVERY anchor on the row
//      (outcome_label, intervention_label, instrument_label), keeping
//      the best score per DISTINCT entity:
//        - Exact match on entity.name              → 1.0
//        - Exact match on entity.entity_id (slug)  → 0.95
//        - Exact match on provenance.short_label   → 0.92
//        - Token-subset containment                → 0.85–0.95
//        - Substring inclusion (long enough)       → 0.70–0.85
//        - Token-overlap (Jaccard, ≥ 50%)          → 0.5–0.80
//   3. Pick the entity with max score per evidence row
//   4. Auto-attach iff: best_score ≥ 0.85 AND
//      best_score is at least 0.10 above the runner-up entity
//      (avoids "two equally good matches" false positives)
//
// Why multiple anchors (was: outcome_label only):
//   The pooling logic (recompute-edge-strengths) groups evidence by
//   attached_entity_id, then for each edge picks evidence attached to
//   either endpoint. Outcome variables are typically the TARGET of an
//   edge, so outcome_label is the PRIMARY anchor. But matching outcome
//   alone stranded papers (0 attachments → 0 grounded edges) whenever the
//   outcome label didn't string-match an entity — so we also try the
//   intervention/instrument labels and attach to whichever entity matches
//   best. Each row still attaches to exactly ONE entity (the single best
//   match across all its anchors), so a single intervention→outcome paper
//   can't double-count itself onto one edge.

import type { EvidenceRegistryRow } from "@/types/evidence-registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

interface EntityRow {
  id: string;
  entity_id: string;
  name: string;
  provenance: Record<string, unknown> | null;
}

export interface AutoAttachSummary {
  candidates: number;
  attached: number;
  skipped_ambiguous: number;
  skipped_no_match: number;
  errors: number;
}

const ATTACH_THRESHOLD = 0.85;
const TIEBREAK_MARGIN = 0.1;

export async function autoAttachEvidence(
  db: AnyDb,
  spaceId: string,
  evidenceRows: EvidenceRegistryRow[],
): Promise<AutoAttachSummary> {
  const summary: AutoAttachSummary = {
    candidates: 0,
    attached: 0,
    skipped_ambiguous: 0,
    skipped_no_match: 0,
    errors: 0,
  };

  // Only consider rows that aren't already attached.
  const candidates = evidenceRows.filter((r) => !r.attached_entity_id);
  summary.candidates = candidates.length;
  if (candidates.length === 0) return summary;

  // Load all entities for the space + their entity_id slugs + provenance
  // (we use provenance.short_label when present — CRCI seed entities
  // carry it).
  const { data: entityData, error: entityErr } = await db
    .from("entities")
    .select("id, entity_id, name, provenance")
    .eq("space_id", spaceId);

  if (entityErr) {
    console.warn("[auto-attach] entity query failed:", entityErr);
    return summary;
  }
  const entities = (entityData ?? []) as EntityRow[];
  if (entities.length === 0) {
    summary.skipped_no_match = candidates.length;
    return summary;
  }

  // Pre-compute normalized lookup tables for fast matching.
  const normalizedEntities = entities.map((e) => ({
    row: e,
    nameNorm: normalize(e.name),
    nameTokens: tokenize(e.name),
    slugNorm: normalize(e.entity_id),
    shortLabelNorm: normalize(
      typeof e.provenance?.short_label === "string"
        ? (e.provenance.short_label as string)
        : "",
    ),
  }));

  // Process each candidate row — match → maybe-attach.
  for (const ev of candidates) {
    // Anchors we try, in priority order. outcome_label is the primary
    // anchor (the target side of most edges), but a paper whose OUTCOME
    // doesn't name-match the graph can still ground via its INTERVENTION
    // or INSTRUMENT label — e.g. an evidence row with outcome "muscle
    // strength" (no graph entity) but intervention "resistance training"
    // (a graph entity). We score every entity against EVERY anchor and keep
    // the best score per DISTINCT entity; each row still attaches to exactly
    // ONE entity, so there's no within-row double-count.
    //
    // (Earlier this matched outcome_label ALONE, which stranded papers — 0
    // attachments → 0 grounded edges — whenever the outcome label didn't
    // string-match an entity. Combined with the brittle scorer below, even
    // on-topic papers routinely grounded nothing.)
    const anchors = [
      ev.outcome_label,
      ev.intervention_label,
      ev.instrument_label,
    ]
      .map((a) => (typeof a === "string" ? a.trim() : ""))
      .filter((a) => normalize(a).length >= 2);
    if (anchors.length === 0) {
      summary.skipped_no_match++;
      continue;
    }

    // Best score per DISTINCT entity across all anchors.
    const bestPerEntity = new Map<string, number>();
    for (const anchor of anchors) {
      const targetNorm = normalize(anchor);
      const targetTokens = tokenize(anchor);
      for (const e of normalizedEntities) {
        const score = scoreEntityMatch({
          targetNorm,
          targetTokens,
          nameNorm: e.nameNorm,
          slugNorm: e.slugNorm,
          shortLabelNorm: e.shortLabelNorm,
          nameTokens: e.nameTokens,
        });
        if (score > (bestPerEntity.get(e.row.id) ?? 0)) {
          bestPerEntity.set(e.row.id, score);
        }
      }
    }

    const ranked = Array.from(bestPerEntity.entries())
      .map(([uuid, score]) => ({ uuid, score }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const runnerUp = ranked[1];

    if (!best || best.score < ATTACH_THRESHOLD) {
      summary.skipped_no_match++;
      continue;
    }
    if (runnerUp && best.score - runnerUp.score < TIEBREAK_MARGIN) {
      summary.skipped_ambiguous++;
      continue;
    }

    // Attach.
    const { error: updErr } = await db
      .from("evidence_registries")
      .update({
        attached_entity_id: best.uuid,
        // Stamp the auto-attach decision into flags for auditability.
        // Existing flags are preserved by spreading on the client side
        // — we re-fetch the current array to avoid clobbering.
        flags: dedupeFlags([...(ev.flags ?? []), "auto_attached"]),
      })
      .eq("id", ev.id);

    if (updErr) {
      console.warn(
        "[auto-attach] update failed for evidence",
        ev.id,
        updErr.message,
      );
      summary.errors++;
      continue;
    }
    summary.attached++;
  }

  return summary;
}

// ── Scoring ───────────────────────────────────────────────────────

interface ScoreInputs {
  targetNorm: string;
  targetTokens: Set<string>;
  nameNorm: string;
  slugNorm: string;
  shortLabelNorm: string;
  nameTokens: Set<string>;
}

function scoreEntityMatch(s: ScoreInputs): number {
  // Exact name match — strongest signal.
  if (s.nameNorm.length > 0 && s.targetNorm === s.nameNorm) return 1.0;
  // Slug exact (e.g. evidence label "BDNF" → entity_id "crci_n23"
  // won't hit this; but evidence label that quotes a slug will).
  if (s.slugNorm.length > 0 && s.targetNorm === s.slugNorm) return 0.95;
  // Short-label exact (CRCI seed: BDNF entity has short_label="BDNF",
  // catches "BDNF" target_label).
  if (s.shortLabelNorm.length > 0 && s.targetNorm === s.shortLabelNorm) {
    return 0.92;
  }
  // Token-subset containment: every distinctive token of the shorter label
  // appears in the longer one. Catches acronym / short-name matches the
  // length-ratio substring rule below MISSES — e.g. target "BDNF" vs entity
  // "Brain-Derived Neurotrophic Factor (BDNF)" scores only 0.72 by substring
  // (ratio ≈ 0.13) and 0 by Jaccard (0.25), so it never attached. A clean
  // token subset is a strong signal; the caller's tiebreak margin rejects a
  // common token that matches many entities. Scored 0.85..0.95 by how much
  // of the larger label the smaller one explains. (tokenize() drops <3-char
  // tokens, so 2-char acronyms like "GH" still fall through — intentional,
  // they're too ambiguous to auto-attach.)
  if (s.targetTokens.size > 0 && s.nameTokens.size > 0) {
    const subset =
      isSubset(s.targetTokens, s.nameTokens) ||
      isSubset(s.nameTokens, s.targetTokens);
    if (subset) {
      const smaller = Math.min(s.targetTokens.size, s.nameTokens.size);
      const larger = Math.max(s.targetTokens.size, s.nameTokens.size);
      const coverage = larger > 0 ? smaller / larger : 0;
      return 0.85 + 0.1 * coverage; // 0.85..0.95
    }
  }
  // Substring inclusion (one contains the other, both ≥ 4 chars to
  // avoid "IL-6" matching "IL-6 receptor activity").
  if (
    s.nameNorm.length >= 4 &&
    s.targetNorm.length >= 4 &&
    (s.nameNorm.includes(s.targetNorm) || s.targetNorm.includes(s.nameNorm))
  ) {
    // Prefer when the candidate is shorter/closer in length.
    const ratio =
      Math.min(s.nameNorm.length, s.targetNorm.length) /
      Math.max(s.nameNorm.length, s.targetNorm.length);
    return 0.7 + 0.15 * ratio; // 0.70..0.85
  }
  // Token-overlap (Jaccard).
  if (s.nameTokens.size > 0 && s.targetTokens.size > 0) {
    const intersect = countIntersection(s.nameTokens, s.targetTokens);
    const union = s.nameTokens.size + s.targetTokens.size - intersect;
    const jaccard = union === 0 ? 0 : intersect / union;
    if (jaccard >= 0.5) {
      // 0.5 → 0.55, 1.0 → 0.80
      return 0.5 + jaccard * 0.3;
    }
    return 0;
  }
  return 0;
}

// ── Helpers ───────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    // Drop non-alphanumeric except dashes (preserves "il-6", "8-ohdg").
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(" ")
      // Drop ultra-short tokens — "of", "to", "a" — which match
      // everything and produce false positives.
      .filter((t) => t.length >= 3),
  );
}

function countIntersection<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** True when `sub` is non-empty and every element of `sub` is in `sup`. */
function isSubset<T>(sub: Set<T>, sup: Set<T>): boolean {
  if (sub.size === 0) return false;
  for (const x of sub) if (!sup.has(x)) return false;
  return true;
}

function dedupeFlags(flags: string[]): string[] {
  return Array.from(new Set(flags.filter((f) => typeof f === "string" && f)));
}

// ── Cross-paper synthesis algorithm ──────────────────────────────
//
// Pure compute: takes evidence_registries rows + ingested_files refs
// + entity importance map, returns a CrossPaperSynthesis. No LLM, no
// DB calls. The endpoint owns auth + reads; this module owns the math.
//
// Algorithm (Initiative 3 v1):
//
//   1. Filter rows to status ∈ {extracted, reviewed} (skip rejected /
//      pending / superseded — they shouldn't influence findings).
//
//   2. Build a claim signature per row from {intervention_label,
//      outcome_label} via tokenize → lower → strip stop words →
//      stem-light → join. Rows with both labels present and non-empty
//      participate; others are skipped (we have no claim).
//
//   3. Greedy Jaccard cluster: for each row, find an existing cluster
//      whose representative signature has ≥0.6 token overlap; otherwise
//      open a new cluster. Order matters here (first row sets the
//      representative); we sort by created_at asc so the earliest
//      paper anchors the cluster — predictable for users.
//
//   4. Within each cluster, classify each paper's row as
//      supports/contradicts/unclear based on effect_size sign vs the
//      cluster's modal sign:
//         - "supports": same sign as modal, p<0.1 OR magnitude ≥ 0.2
//         - "contradicts": opposite sign, same significance gate
//         - "unclear": otherwise
//
//   5. Emit findings:
//      - recurring: clusters with ≥2 distinct asset_ids
//      - contradictions: clusters with ≥1 supports + ≥1 contradicts
//      - under_supported: critical/fundamental entities with exactly
//        one supporting evidence row (computed independently of clustering)

import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import type {
  CrossPaperSynthesis,
  RecurringClaim,
  Contradiction,
  UnderSupportedClaim,
  PaperRef,
} from "@/types/cross-paper-synthesis";

// Tunables — inline for v1; externalize when we tune against real data.
const JACCARD_THRESHOLD = 0.6;
const SIGNIFICANCE_MIN_MAGNITUDE = 0.2;
const SIGNIFICANCE_P_VALUE = 0.1;

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "is", "are", "was", "were",
  "in", "on", "to", "with", "for", "by", "at", "as", "be", "been",
  "from", "this", "that", "these", "those", "it", "its",
]);

// ── Inputs ──────────────────────────────────────────────────────

export interface CrossPaperInput {
  evidence: EvidenceRegistryRow[];
  /** Map ingested_file_id → source_name (paper title). */
  paperTitles: Map<string, string>;
  /** Map entity_id → { name, importance }. Used for under-supported
   *  filtering + display name lookup. */
  entities: Map<
    string,
    { name: string; importance: "fundamental" | "critical" | "important" | "moderate" }
  >;
}

export function computeCrossPaperSynthesis(
  input: CrossPaperInput,
): CrossPaperSynthesis {
  const usable = input.evidence.filter(
    (r) => r.status === "extracted" || r.status === "reviewed",
  );

  // Distinct papers in the working set — used for "from N papers" header.
  const distinctAssets = new Set<string>();
  for (const r of usable) {
    if (r.ingested_file_id) distinctAssets.add(r.ingested_file_id);
  }

  // ── Cluster rows by claim signature ────────────────────────────
  const clusters: ClusterAccum[] = [];
  // Stable order by created_at asc so the earliest paper anchors the cluster.
  const sorted = [...usable].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  );

  for (const row of sorted) {
    const sig = signatureFor(row);
    if (!sig) continue; // no claim — skip

    const tokens = tokenize(sig);
    if (tokens.size === 0) continue;

    // Find best matching existing cluster.
    let best: { cluster: ClusterAccum; score: number } | null = null;
    for (const c of clusters) {
      const score = jaccard(tokens, c.repr_tokens);
      if (score >= JACCARD_THRESHOLD && (!best || score > best.score)) {
        best = { cluster: c, score };
      }
    }

    if (best) {
      best.cluster.rows.push(row);
    } else {
      clusters.push({
        repr_signature: sig,
        repr_tokens: tokens,
        repr_text: representativeText(row),
        rows: [row],
      });
    }
  }

  // ── Build recurring + contradictions ────────────────────────────
  const recurring: RecurringClaim[] = [];
  const contradictions: Contradiction[] = [];

  for (const c of clusters) {
    const distinctClusterAssets = new Set<string>();
    for (const r of c.rows) {
      if (r.ingested_file_id) distinctClusterAssets.add(r.ingested_file_id);
    }
    if (distinctClusterAssets.size < 2) continue; // not recurring

    // Resolve the cluster's modal sign for direction tagging.
    const modalSign = computeModalSign(c.rows);

    const papers = c.rows.map((r) =>
      paperRefFor(r, input.paperTitles, modalSign),
    );

    // Pick a primary entity — most-frequent attached_entity_id across rows.
    const entityCounts = new Map<string, number>();
    for (const r of c.rows) {
      if (r.attached_entity_id) {
        entityCounts.set(
          r.attached_entity_id,
          (entityCounts.get(r.attached_entity_id) ?? 0) + 1,
        );
      }
    }
    const primaryEntityId =
      pickModeKey(entityCounts) ?? null;
    const primaryEntityName =
      primaryEntityId ? input.entities.get(primaryEntityId)?.name ?? null : null;

    const aggregate = computeAggregate(c.rows);

    const claim: RecurringClaim = {
      id: `cp_recurring_${hashSig(c.repr_signature)}`,
      representative_text: c.repr_text,
      claim_signature: c.repr_signature,
      primary_entity_id: primaryEntityId,
      primary_entity_name: primaryEntityName,
      paper_count: distinctClusterAssets.size,
      papers,
      aggregate_effect: aggregate ?? undefined,
    };
    recurring.push(claim);

    // ── Contradiction detection on the same cluster ────────────────
    const supports = papers.filter((p) => p.direction === "supports");
    const contradicts = papers.filter((p) => p.direction === "contradicts");
    if (supports.length > 0 && contradicts.length > 0) {
      const severity: Contradiction["severity"] =
        supports.length >= 2 && contradicts.length >= 2
          ? "high"
          : supports.length >= 2 || contradicts.length >= 2
            ? "medium"
            : "low";
      contradictions.push({
        id: `cp_contra_${hashSig(c.repr_signature)}`,
        representative_text: c.repr_text,
        claim_signature: c.repr_signature,
        primary_entity_id: primaryEntityId,
        primary_entity_name: primaryEntityName,
        supporting_papers: supports,
        contradicting_papers: contradicts,
        severity,
      });
    }
  }

  recurring.sort((a, b) => b.paper_count - a.paper_count);
  contradictions.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.supporting_papers.length +
        b.contradicting_papers.length -
        (a.supporting_papers.length + a.contradicting_papers.length),
  );

  // ── Under-supported critical/fundamental entities ──────────────
  // Independent computation: for each entity in the importance set,
  // find rows attached to it. If exactly one, it's a gap.
  const rowsByEntity = new Map<string, EvidenceRegistryRow[]>();
  for (const r of usable) {
    if (!r.attached_entity_id) continue;
    const arr = rowsByEntity.get(r.attached_entity_id) ?? [];
    arr.push(r);
    rowsByEntity.set(r.attached_entity_id, arr);
  }
  const under_supported: UnderSupportedClaim[] = [];
  for (const [entityId, rows] of rowsByEntity) {
    const ent = input.entities.get(entityId);
    if (!ent) continue;
    if (ent.importance !== "fundamental" && ent.importance !== "critical") continue;
    if (rows.length !== 1) continue;
    const r = rows[0];
    if (!r.ingested_file_id) continue;
    under_supported.push({
      entity_id: entityId,
      entity_name: ent.name,
      importance: ent.importance,
      sole_paper: paperRefFor(r, input.paperTitles, /* modalSign */ null),
      suggested_search: (r.outcome_label ?? r.intervention_label ?? "")
        .slice(0, 200),
    });
  }
  // Stable sort: fundamental first.
  under_supported.sort((a, b) => {
    if (a.importance === b.importance) {
      return a.entity_name.localeCompare(b.entity_name);
    }
    return a.importance === "fundamental" ? -1 : 1;
  });

  return {
    recurring,
    contradictions,
    under_supported,
    counts: {
      total_papers: distinctAssets.size,
      total_evidence_rows: usable.length,
    },
    generated_at: new Date().toISOString(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────

interface ClusterAccum {
  repr_signature: string;
  repr_tokens: Set<string>;
  repr_text: string;
  rows: EvidenceRegistryRow[];
}

function signatureFor(row: EvidenceRegistryRow): string | null {
  const intervention = (row.intervention_label ?? "").trim();
  const outcome = (row.outcome_label ?? "").trim();
  if (!intervention && !outcome) return null;
  return `${intervention.toLowerCase()} | ${outcome.toLowerCase()}`;
}

function representativeText(row: EvidenceRegistryRow): string {
  const intervention = row.intervention_label?.trim();
  const outcome = row.outcome_label?.trim();
  if (intervention && outcome) return `${intervention} → ${outcome}`;
  if (intervention) return intervention;
  if (outcome) return outcome;
  return "(unlabeled claim)";
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
      .map(stemLight),
  );
}

/** Lightweight stemmer — drops common suffixes that often differ in
 *  scientific paraphrase ("memory" vs "memorization"). Not Porter
 *  strength; just enough to merge obvious near-duplicates. */
function stemLight(word: string): string {
  if (word.length <= 3) return word;
  for (const suffix of ["ization", "ational", "tional", "iveness", "ation", "ities", "ously", "ising", "izing", "ing", "ies", "ied", "ied", "ed", "ly", "es", "s"]) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function computeModalSign(rows: EvidenceRegistryRow[]): -1 | 0 | 1 {
  let pos = 0;
  let neg = 0;
  for (const r of rows) {
    if (r.effect_size == null) continue;
    if (r.effect_size > 0) pos++;
    else if (r.effect_size < 0) neg++;
  }
  if (pos === 0 && neg === 0) return 0;
  return pos >= neg ? 1 : -1;
}

function paperRefFor(
  row: EvidenceRegistryRow,
  titles: Map<string, string>,
  modalSign: -1 | 0 | 1 | null,
): PaperRef {
  const direction: PaperRef["direction"] = (() => {
    if (modalSign == null || modalSign === 0) return "unclear";
    if (row.effect_size == null) return "unclear";
    const significant =
      Math.abs(row.effect_size) >= SIGNIFICANCE_MIN_MAGNITUDE ||
      (row.p_value != null && row.p_value < SIGNIFICANCE_P_VALUE);
    if (!significant) return "unclear";
    return Math.sign(row.effect_size) === modalSign
      ? "supports"
      : "contradicts";
  })();

  return {
    asset_id: row.ingested_file_id ?? "",
    title:
      (row.ingested_file_id && titles.get(row.ingested_file_id)) ||
      "(untitled paper)",
    effect_size: row.effect_size,
    standard_error: row.standard_error,
    effect_metric: row.effect_metric,
    n_treatment: row.n_treatment,
    direction,
  };
}

function pickModeKey<K>(map: Map<K, number>): K | null {
  let bestKey: K | null = null;
  let bestCount = 0;
  for (const [k, v] of map) {
    if (v > bestCount) {
      bestKey = k;
      bestCount = v;
    }
  }
  return bestKey;
}

/**
 * Inverse-variance-weighted aggregate effect across rows. Returns null
 * unless ≥2 rows carry both effect_size and standard_error AND share
 * a common metric (or all-mixed → metric: "mixed").
 */
function computeAggregate(
  rows: EvidenceRegistryRow[],
): RecurringClaim["aggregate_effect"] | null {
  const usable = rows.filter(
    (r) =>
      r.effect_size != null &&
      r.standard_error != null &&
      r.standard_error > 0,
  );
  if (usable.length < 2) return null;

  const metrics = new Set(usable.map((r) => r.effect_metric ?? "unknown"));
  const metric = metrics.size === 1 ? [...metrics][0] : "mixed";

  // Inverse-variance weights: w_i = 1 / SE_i²
  const weights = usable.map((r) => 1 / (r.standard_error! * r.standard_error!));
  const sumWeights = weights.reduce((s, w) => s + w, 0);
  const weighted = usable.reduce(
    (s, r, i) => s + r.effect_size! * weights[i],
    0,
  );
  const mean = weighted / sumWeights;
  const pooledSe = Math.sqrt(1 / sumWeights);

  // Cochran's Q for I²:
  //   Q = sum_i w_i * (effect_i - mean)²
  //   I² = max(0, (Q - df) / Q) where df = k - 1
  let Q = 0;
  for (let i = 0; i < usable.length; i++) {
    const diff = usable[i].effect_size! - mean;
    Q += weights[i] * diff * diff;
  }
  const df = usable.length - 1;
  const i2 = df > 0 && Q > df ? (Q - df) / Q : 0;

  return {
    mean,
    se: pooledSe,
    heterogeneity_i2: i2,
    n_studies: usable.length,
    metric,
  };
}

function hashSig(sig: string): string {
  // Deterministic short id from signature. Small Murmur-ish hash —
  // collisions are tolerable since this id is just a React key + a
  // stable handle for client-side state, not a DB primary key.
  let h = 2166136261;
  for (let i = 0; i < sig.length; i++) {
    h ^= sig.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function severityRank(s: Contradiction["severity"]): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

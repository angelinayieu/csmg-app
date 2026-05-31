// ── build-concept-clusters ──────────────────────────────────────────
//
// Pure, deterministic clustering of objective-canvas ROOM entities that
// denote the SAME concept across different rooms — so the map can draw
// REAL cross-room connections instead of fabricated string-matches.
//
// Why this exists (verified against the live DB, 2026-05-30):
//   OC room-generation produces the same concept in many rooms with
//   VARIED phrasing — e.g. "Privacy Concerns with Data Sharing",
//   "Data Privacy Concerns", "Privacy Concerns Hinder Data Sharing".
//   `entities.canonical_concept_id` is now linked at generation time
//   (commit ed1ccc6) but keys on the EXACT normalized name, so those
//   variants stay distinct (only 6 exact cross-room matches across 510
//   entities). Clustering the variants collapses them into ONE concept
//   node spanning N rooms → that is the dense cross-room connection layer.
//   Lexical clustering alone surfaces ~235 candidate cross-room links
//   (vs 6 exact) at high quality, so it is worth materialising.
//
// Design notes:
//   • PURE: no DB, no LLM, no embeddings, no writes. Feed it the rows,
//     get clusters + edges back. The caller decides whether to persist
//     or render.
//   • PLUGGABLE similarity: `scorePair` is deterministic today (canonical
//     id → normalized-name → token-Jaccard → substring, mirroring the
//     evidence/auto-attach scoring rubric). Swap it for embedding cosine
//     when concept embeddings exist — the union-find + edge emission stay
//     identical.
//   • TRANSITIVE: union-find groups A-B and B-C into one cluster {A,B,C}
//     even if A and C never directly score above threshold.
//   • Cross-room ONLY edges: intra-room relationships are already the
//     `edges` table's job; this layer adds what was missing.

export interface ConceptEntityInput {
  /** entities.id (uuid). */
  id: string;
  /** entities.name — the concept phrasing. */
  name: string;
  /** parent_sub_objective_id — the room this concept lives in. */
  roomId: string | null;
  /** entities.canonical_concept_id when linked (strongest merge signal). */
  canonicalConceptId?: string | null;
}

export type ClusterBasis = "canonical" | "exact_name" | "token" | "substring";

export interface ConceptCluster {
  /** Stable id = the lexicographically-smallest member id. */
  clusterId: string;
  /** Representative label = the shortest member name (least-qualified). */
  label: string;
  /** All entity ids in this cluster. */
  memberIds: string[];
  /** Distinct rooms this concept spans. */
  roomIds: string[];
  /** True when the cluster spans ≥2 rooms (i.e. it yields connections). */
  crossRoom: boolean;
}

export interface ConceptConnection {
  /** Representative member (the hub of the star). */
  fromId: string;
  /** A same-cluster member in a DIFFERENT room. */
  toId: string;
  clusterId: string;
  /** Why these two were judged the same concept. */
  basis: ClusterBasis;
  /** 0..1 confidence of the pairwise judgement. */
  score: number;
}

export interface ConceptClusterResult {
  clusters: ConceptCluster[];
  /** Cross-room connections only (star from each cluster's representative). */
  connections: ConceptConnection[];
  built_at: string;
  stats: {
    entities: number;
    clusters: number;
    crossRoomClusters: number;
    connections: number;
  };
}

export interface BuildConceptClustersOptions {
  /** Min token-Jaccard to link two names (default 0.5). */
  tokenThreshold?: number;
  /** Min shared meaningful tokens regardless of Jaccard (default 2). */
  minSharedTokens?: number;
  /** Words excluded from token matching (generic connective/domain noise). */
  stopwords?: Set<string>;
}

const DEFAULT_STOPWORDS = new Set([
  "with", "that", "this", "from", "your", "their", "into", "data", "user",
  "users", "over", "more", "less", "through", "between", "within", "based",
  "when", "will", "have", "they", "and", "the", "for", "via", "due",
]);

// ── Public entry ────────────────────────────────────────────────────

export function buildConceptClusters(
  entities: ConceptEntityInput[],
  opts: BuildConceptClustersOptions = {},
): ConceptClusterResult {
  const tokenThreshold = opts.tokenThreshold ?? 0.5;
  const minSharedTokens = opts.minSharedTokens ?? 2;
  const stopwords = opts.stopwords ?? DEFAULT_STOPWORDS;

  const built_at = new Date().toISOString();
  const valid = entities.filter((e) => e?.id && typeof e.name === "string" && e.name.trim().length > 0);

  // Precompute normalized form + token set per entity.
  const prepared = valid.map((e) => ({
    e,
    norm: normalize(e.name),
    tokens: tokenize(e.name, stopwords),
  }));
  const byId = new Map(prepared.map((p) => [p.e.id, p]));

  // ── Union-find over entity ids ────────────────────────────────────
  const parent = new Map<string, string>();
  for (const p of prepared) parent.set(p.e.id, p.e.id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // path-compress
    let cur = x;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Keep the lexicographically-smaller id as root for stable clusterIds.
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  // ── Candidate generation via inverted indexes (avoids O(n²)) ───────
  // 1. canonical_concept_id buckets — strongest signal, union directly.
  const byCanonical = new Map<string, string[]>();
  // 2. normalized-name buckets — exact-name duplicates across rooms.
  const byNorm = new Map<string, string[]>();
  // 3. token postings — candidate pairs share ≥1 meaningful token.
  const byToken = new Map<string, string[]>();

  for (const p of prepared) {
    if (p.e.canonicalConceptId) {
      pushTo(byCanonical, p.e.canonicalConceptId, p.e.id);
    }
    if (p.norm.length > 0) pushTo(byNorm, p.norm, p.e.id);
    for (const t of p.tokens) pushTo(byToken, t, p.e.id);
  }

  // Union exact-signal buckets.
  for (const ids of byCanonical.values()) unionAll(ids, union);
  for (const ids of byNorm.values()) unionAll(ids, union);

  // Token-driven candidate pairs → score → maybe union.
  const checked = new Set<string>();
  for (const ids of byToken.values()) {
    // Skip pathological huge postings (a token shared by most entities is
    // noise, not signal) — caps work and false positives.
    if (ids.length > 60) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (find(a) === find(b)) continue; // already merged
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (checked.has(key)) continue;
        checked.add(key);
        const pa = byId.get(a)!;
        const pb = byId.get(b)!;
        const judged = scorePair(pa, pb, { tokenThreshold, minSharedTokens });
        if (judged) union(a, b);
      }
    }
  }

  // ── Materialize clusters ──────────────────────────────────────────
  const groups = new Map<string, string[]>();
  for (const p of prepared) {
    const root = find(p.e.id);
    pushTo(groups, root, p.e.id);
  }

  const clusters: ConceptCluster[] = [];
  const connections: ConceptConnection[] = [];

  for (const [clusterId, memberIds] of groups) {
    const members = memberIds.map((id) => byId.get(id)!);
    const roomIds = Array.from(
      new Set(members.map((m) => m.e.roomId).filter((r): r is string => !!r)),
    );
    const crossRoom = roomIds.length >= 2;
    // Representative = shortest name (the least-qualified phrasing).
    const rep = members.reduce((best, m) =>
      m.e.name.length < best.e.name.length ? m : best,
    );

    clusters.push({
      clusterId,
      label: rep.e.name,
      memberIds: members.map((m) => m.e.id),
      roomIds,
      crossRoom,
    });

    if (!crossRoom) continue;
    // Star edges: rep → every member in a different room than rep.
    for (const m of members) {
      if (m.e.id === rep.e.id) continue;
      if (m.e.roomId && m.e.roomId === rep.e.roomId) continue; // same room → skip
      const judged = scorePair(rep, m, { tokenThreshold, minSharedTokens }) ??
        // rep↔m may have merged transitively; still record the best basis.
        bestBasis(rep, m);
      connections.push({
        fromId: rep.e.id,
        toId: m.e.id,
        clusterId,
        basis: judged.basis,
        score: judged.score,
      });
    }
  }

  // Stable ordering for deterministic output.
  clusters.sort((a, b) => b.memberIds.length - a.memberIds.length || a.clusterId.localeCompare(b.clusterId));
  connections.sort((a, b) => b.score - a.score || a.fromId.localeCompare(b.fromId));

  return {
    clusters,
    connections,
    built_at,
    stats: {
      entities: valid.length,
      clusters: clusters.length,
      crossRoomClusters: clusters.filter((c) => c.crossRoom).length,
      connections: connections.length,
    },
  };
}

// ── Pairwise similarity (the pluggable seam) ────────────────────────

interface Prepared {
  e: ConceptEntityInput;
  norm: string;
  tokens: Set<string>;
}

/**
 * Judge whether two prepared entities denote the same concept. Returns a
 * `{ basis, score }` when they pass, else `null`. Deterministic; mirrors
 * the evidence/auto-attach scoring ladder. Replace with embedding cosine
 * to upgrade lexical → semantic without touching the clustering loop.
 */
function scorePair(
  a: Prepared,
  b: Prepared,
  cfg: { tokenThreshold: number; minSharedTokens: number },
): { basis: ClusterBasis; score: number } | null {
  if (
    a.e.canonicalConceptId &&
    b.e.canonicalConceptId &&
    a.e.canonicalConceptId === b.e.canonicalConceptId
  ) {
    return { basis: "canonical", score: 1 };
  }
  if (a.norm.length > 0 && a.norm === b.norm) {
    return { basis: "exact_name", score: 1 };
  }
  // Token Jaccard + shared-count gate.
  const shared = intersectionSize(a.tokens, b.tokens);
  if (shared >= cfg.minSharedTokens) {
    const union = a.tokens.size + b.tokens.size - shared;
    const jaccard = union === 0 ? 0 : shared / union;
    if (jaccard >= cfg.tokenThreshold) {
      return { basis: "token", score: round2(0.5 + jaccard * 0.5) };
    }
  }
  // Substring inclusion (both reasonably long → avoids "il-6" noise).
  if (
    a.norm.length >= 6 &&
    b.norm.length >= 6 &&
    (a.norm.includes(b.norm) || b.norm.includes(a.norm))
  ) {
    const ratio =
      Math.min(a.norm.length, b.norm.length) /
      Math.max(a.norm.length, b.norm.length);
    if (ratio >= 0.6) return { basis: "substring", score: round2(0.6 + ratio * 0.3) };
  }
  return null;
}

/** Best-effort basis for a transitively-merged pair (never null). */
function bestBasis(a: Prepared, b: Prepared): { basis: ClusterBasis; score: number } {
  if (
    a.e.canonicalConceptId &&
    b.e.canonicalConceptId &&
    a.e.canonicalConceptId === b.e.canonicalConceptId
  ) {
    return { basis: "canonical", score: 1 };
  }
  if (a.norm === b.norm) return { basis: "exact_name", score: 1 };
  const shared = intersectionSize(a.tokens, b.tokens);
  const union = a.tokens.size + b.tokens.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;
  return { basis: "token", score: round2(Math.max(0.5, 0.5 + jaccard * 0.5)) };
}

// ── Text helpers (kept in-file; mirror evidence/auto-attach rules) ──

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string, stopwords: Set<string>): Set<string> {
  return new Set(
    normalize(s)
      .split(" ")
      .filter((t) => t.length >= 4 && !stopwords.has(t)),
  );
}

function intersectionSize<T>(a: Set<T>, b: Set<T>): number {
  // Iterate the smaller set.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const x of small) if (big.has(x)) n++;
  return n;
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function unionAll(ids: string[], union: (a: string, b: string) => void): void {
  for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

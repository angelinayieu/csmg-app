// ── buildKgContext — Phase 1 fetcher ─────────────────────────────
//
// Pulls a relevant slice of the KG for an LLM reasoning task. One
// canonical entry point that every endpoint should use instead of
// hand-rolling its own joins:
//
//   const ctx = await buildKgContext({
//     spaceId,
//     mode: "summarize",
//     focusEntityIds: extractedEntityIds,
//   });
//   const prompt = renderKgContext(ctx);
//
// Today this does deterministic ranking (importance × centrality ×
// lexical overlap with `query`). When pgvector is wired we'll swap
// the lexical scorer for an embedding-similarity one in a single
// place — every caller gets the upgrade for free.
//
// The fetcher is intentionally cheap on RPCs:
//   - 1× select on entities (capped early via order + limit)
//   - 1× select on edges (filtered by source_entity_id IN primaries)
//   - 1× select on claims (filtered by source_entity_id IN primaries)
//   - 1× select on kg_communities (latest detection_run for space)
//   - 1× select on spaces.synthesis_data (axioms + convergences live in jsonb)
// Total: 5 sequential queries. Could parallelize entities + the
// space row, but the second-batch queries (edges/claims/communities)
// depend on knowing the primary entity ids, so the chain is bounded.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entity, Edge, Claim } from "@/types";
import type { Axiom, InsightConvergence } from "@/types/synthesis";
import type {
  BuildKgContextOpts,
  KgContext,
  KgContextCaps,
  KgContextMode,
  KgCommunityInfo,
  KgCommunitySummary,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── Default caps per mode ─────────────────────────────────────────
//
// Tuned to keep the rendered block under ~3-5k tokens for "broad" and
// "summarize", under ~6-8k for "strategy" (which is the heavy path).

const DEFAULT_CAPS: Record<KgContextMode, KgContextCaps> = {
  broad: {
    maxEntities: 16,
    maxEdgesPerEntity: 3,
    maxClaimsPerEntity: 1,
    maxCommunities: 4,
    maxAxioms: 6,
    maxConvergences: 3,
    edgeConfidenceFloor: 0.4,
    claimConfidenceFloor: 0.5,
  },
  deep: {
    maxEntities: 12,
    maxEdgesPerEntity: 5,
    maxClaimsPerEntity: 3,
    maxCommunities: 2,
    maxAxioms: 4,
    maxConvergences: 2,
    edgeConfidenceFloor: 0.3,
    claimConfidenceFloor: 0.4,
  },
  strategy: {
    maxEntities: 22,
    maxEdgesPerEntity: 5,
    maxClaimsPerEntity: 2,
    maxCommunities: 6,
    maxAxioms: 10,
    maxConvergences: 5,
    edgeConfidenceFloor: 0.35,
    claimConfidenceFloor: 0.4,
  },
  summarize: {
    maxEntities: 24,
    maxEdgesPerEntity: 4,
    maxClaimsPerEntity: 2,
    maxCommunities: 4,
    maxAxioms: 6,
    maxConvergences: 3,
    edgeConfidenceFloor: 0.35,
    claimConfidenceFloor: 0.4,
  },
};

// ── Importance rank ───────────────────────────────────────────────

const IMPORTANCE_RANK: Record<string, number> = {
  fundamental: 0,
  critical: 1,
  important: 2,
  moderate: 3,
  peripheral: 4,
};

function importanceScore(e: Entity): number {
  const imp = (e as Entity & { importance?: string | null }).importance;
  return IMPORTANCE_RANK[imp ?? "peripheral"] ?? 5;
}

function entityConfidence(e: Entity): number {
  const c = (e as Entity & { confidence?: number | null }).confidence;
  return typeof c === "number" ? c : 0.5;
}

// ── Lexical relevance scoring ────────────────────────────────────
//
// Cheap word-overlap score between the query and an entity's
// (name + description). Non-word chars stripped, lowercase, length-3+
// tokens only. Returns 0 when no query supplied so this term drops
// out of the rank.

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function lexicalOverlap(query: string | undefined, e: Entity): number {
  if (!query || !query.trim()) return 0;
  const qTokens = tokenize(query);
  if (qTokens.size === 0) return 0;
  const text = `${e.name ?? ""} ${(e as Entity & { description?: string | null }).description ?? ""}`;
  const eTokens = tokenize(text);
  if (eTokens.size === 0) return 0;
  let intersection = 0;
  for (const t of qTokens) if (eTokens.has(t)) intersection++;
  // Jaccard-ish but query-anchored — we care about query coverage,
  // not entity coverage.
  return intersection / qTokens.size;
}

// ── Token estimation ──────────────────────────────────────────────

function estTokens(s: string | null | undefined): number {
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}

// ── Main entry ────────────────────────────────────────────────────

export async function buildKgContext(
  db: AnyDb,
  opts: BuildKgContextOpts,
): Promise<KgContext> {
  const {
    spaceId,
    mode,
    query = "",
    focusEntityIds = [],
    caps: capsOverride,
  } = opts;
  const caps: KgContextCaps = { ...DEFAULT_CAPS[mode], ...(capsOverride ?? {}) };

  // ── 1. Fetch entities ─────────────────────────────────────────
  // Pull a generous superset, then rank locally — Supabase can't
  // express "rank by composite of importance × lexical similarity"
  // server-side. The superset is bounded (4× the entity cap) so the
  // local rank stays cheap.
  const fetchLimit = Math.max(caps.maxEntities * 4, 80);
  const { data: rawEntities } = await db
    .from("entities")
    .select("*")
    .eq("space_id", spaceId)
    .order("centrality_rank", { ascending: true, nullsFirst: false })
    .limit(fetchLimit);

  const entities = (rawEntities ?? []) as Entity[];
  const focusSet = new Set(focusEntityIds);

  // Rank: focus first, then composite (importance × centrality ×
  // lexical overlap with query). We keep it deterministic by
  // tie-breaking on confidence then id.
  const ranked = [...entities].sort((a, b) => {
    const aFocus = focusSet.has(a.id) ? 0 : 1;
    const bFocus = focusSet.has(b.id) ? 0 : 1;
    if (aFocus !== bFocus) return aFocus - bFocus;
    const impDiff = importanceScore(a) - importanceScore(b);
    if (impDiff !== 0) return impDiff;
    const lex = lexicalOverlap(query, b) - lexicalOverlap(query, a);
    if (lex !== 0) return lex;
    const aRank =
      (a as Entity & { centrality_rank?: number | null }).centrality_rank ??
      Number.MAX_SAFE_INTEGER;
    const bRank =
      (b as Entity & { centrality_rank?: number | null }).centrality_rank ??
      Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return entityConfidence(b) - entityConfidence(a);
  });

  const primaryEntities = ranked.slice(0, caps.maxEntities);
  const primaryEntityIds = new Set<string>();
  for (const e of primaryEntities) primaryEntityIds.add(e.id);

  // ── 2. Fetch edges (only those touching primaries) ─────────────
  // We over-pull and filter locally for the same reason as entities.
  // edges.confidence floor applied here so the filter stays explicit.
  let edges: Edge[] = [];
  if (primaryEntityIds.size > 0) {
    const ids = Array.from(primaryEntityIds);
    const { data: rawEdges } = await db
      .from("edges")
      .select("*")
      .eq("space_id", spaceId)
      .or(
        `source_entity_id.in.(${ids.map((s) => `"${s}"`).join(",")}),target_entity_id.in.(${ids.map((s) => `"${s}"`).join(",")})`,
      )
      .gte("confidence", caps.edgeConfidenceFloor)
      .limit(caps.maxEntities * (caps.maxEdgesPerEntity + 2));
    edges = (rawEdges ?? []) as Edge[];
  }

  // ── 3. Fetch claims (only those sourced from primaries) ────────
  let claims: Claim[] = [];
  if (primaryEntityIds.size > 0) {
    const ids = Array.from(primaryEntityIds);
    const { data: rawClaims } = await db
      .from("claims")
      .select("*")
      .eq("space_id", spaceId)
      .in("source_entity_id", ids)
      .gte("confidence", caps.claimConfidenceFloor)
      .limit(caps.maxEntities * caps.maxClaimsPerEntity * 2);
    claims = (rawClaims ?? []) as Claim[];
  }

  // ── 4. Fetch communities (latest detection_run for space) ─────
  // GraphRAG-style summaries already live on kg_communities.summary
  // (jsonb). We pick the latest detection_run, then filter to those
  // whose entity_ids overlap our primaryEntityIds. Score by overlap
  // count desc.
  const communities = await fetchCommunities(
    db,
    spaceId,
    primaryEntityIds,
    caps.maxCommunities,
  );

  // ── 5. Fetch synthesis_data jsonb (axioms + convergences) ─────
  const { axioms, convergences } = await fetchSynthesisJsonb(
    db,
    spaceId,
    primaryEntityIds,
    caps,
  );

  // ── 6. Estimate tokens ─────────────────────────────────────────
  const sectionTokens = {
    entities: primaryEntities.reduce(
      (acc, e) =>
        acc +
        estTokens(e.name) +
        estTokens(
          (e as Entity & { description?: string | null }).description,
        ),
      0,
    ),
    edges: edges.reduce(
      (acc, e) =>
        acc +
        estTokens(e.relationship_type) +
        estTokens(e.dimension) +
        estTokens(
          (e as Edge & { conditions?: string | null }).conditions ?? "",
        ),
      0,
    ),
    claims: claims.reduce((acc, c) => acc + estTokens(c.claim_text), 0),
    communities: communities.reduce(
      (acc, c) =>
        acc +
        estTokens(c.summary?.title) +
        estTokens(c.summary?.summary) +
        (c.summary?.findings ?? []).reduce(
          (a, f) => a + estTokens(f.summary) + estTokens(f.explanation ?? ""),
          0,
        ),
      0,
    ),
    axioms: axioms.reduce(
      (acc, a) => acc + estTokens(a.claim) + estTokens(a.if_false),
      0,
    ),
    convergences: convergences.reduce(
      (acc, c) =>
        acc +
        estTokens(c.concern_label) +
        c.signals.reduce((a, s) => a + estTokens(s.summary), 0),
      0,
    ),
  };
  const estimatedTokens = Object.values(sectionTokens).reduce(
    (a, n) => a + n,
    0,
  );

  return {
    spaceId,
    mode,
    queryHint: query,
    primaryEntities,
    primaryEntityIds,
    edges,
    claims,
    communities,
    axioms,
    convergences,
    estimatedTokens,
    sectionTokens,
  };
}

// ── Communities sub-fetch ─────────────────────────────────────────

async function fetchCommunities(
  db: AnyDb,
  spaceId: string,
  primaryEntityIds: Set<string>,
  maxCommunities: number,
): Promise<KgCommunityInfo[]> {
  if (maxCommunities <= 0) return [];
  // Step 1: latest detection_run for this space.
  const { data: runRow } = await db
    .from("kg_communities")
    .select("detection_run_id, computed_at")
    .eq("space_id", spaceId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!runRow) return [];
  const detectionRunId = (runRow as { detection_run_id: string })
    .detection_run_id;

  // Step 2: load all communities from that run, with summaries. We
  // load the whole set (they're small, dozens of rows max) and
  // filter locally — Supabase can't do array-overlap filtering with
  // pure REST without a dedicated RPC.
  const { data: rawComms } = await db
    .from("kg_communities")
    .select("id, level, entity_ids, summary")
    .eq("space_id", spaceId)
    .eq("detection_run_id", detectionRunId)
    .order("level", { ascending: true });
  const all = (rawComms ?? []) as Array<{
    id: string;
    level: number;
    entity_ids: string[];
    summary: KgCommunitySummary | null;
  }>;

  if (primaryEntityIds.size === 0) {
    // No focus — return the top-rated summaries (level 0, highest
    // rating). Useful for "broad" mode where we want the global
    // shape of the space.
    return all
      .filter((c) => c.level === 0 && c.summary)
      .sort((a, b) => (b.summary?.rating ?? 0) - (a.summary?.rating ?? 0))
      .slice(0, maxCommunities)
      .map((c) => ({
        id: c.id,
        level: c.level,
        entityIds: c.entity_ids,
        summary: c.summary,
        overlapWithFocus: 0,
      }));
  }

  // With focus: rank by overlap count desc, prefer leaf communities
  // (higher level) since they're more specific.
  const scored = all
    .map((c) => {
      let overlap = 0;
      for (const eid of c.entity_ids) {
        if (primaryEntityIds.has(eid)) overlap++;
      }
      return { c, overlap };
    })
    .filter((s) => s.overlap > 0);
  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return b.c.level - a.c.level;
  });
  return scored.slice(0, maxCommunities).map(({ c, overlap }) => ({
    id: c.id,
    level: c.level,
    entityIds: c.entity_ids,
    summary: c.summary,
    overlapWithFocus: overlap,
  }));
}

// ── Synthesis jsonb sub-fetch (axioms + convergences) ─────────────

async function fetchSynthesisJsonb(
  db: AnyDb,
  spaceId: string,
  primaryEntityIds: Set<string>,
  caps: KgContextCaps,
): Promise<{ axioms: Axiom[]; convergences: InsightConvergence[] }> {
  const { data: spaceRow } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow) return { axioms: [], convergences: [] };
  const synth = (spaceRow as { synthesis_data: unknown }).synthesis_data as {
    axioms?: Axiom[];
    insight_convergences?: InsightConvergence[];
  } | null;
  if (!synth) return { axioms: [], convergences: [] };

  // Axioms: always include "critical" load-bearing ones (they're the
  // load-bearing assumptions — strategy/synthesis quality drops
  // visibly without them). Otherwise prefer those whose scope_anchor
  // hits a primary entity.
  const allAxioms = Array.isArray(synth.axioms) ? synth.axioms : [];
  const scoredAxioms = allAxioms
    .map((a) => {
      const isCritical = a.load_bearing === "critical";
      const anchorMatch =
        typeof a.scope_anchor === "string" &&
        primaryEntityIds.has(a.scope_anchor);
      const score =
        (isCritical ? 1000 : 0) +
        (anchorMatch ? 100 : 0) +
        (a.load_bearing === "important" ? 10 : 0);
      return { a, score };
    })
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, caps.maxAxioms)
    .map((s) => s.a);

  // Convergences: skip "weak" — they're the post-synth long tail.
  // Then prefer ones whose shared_entity_ids overlap primaries.
  const allConv = Array.isArray(synth.insight_convergences)
    ? synth.insight_convergences
    : [];
  const scoredConv = allConv
    .filter((c) => c.strength === "strong" || c.strength === "moderate")
    .map((c) => {
      let overlap = 0;
      for (const eid of c.shared_entity_ids) {
        if (primaryEntityIds.has(eid)) overlap++;
      }
      const baseScore = c.strength === "strong" ? 100 : 50;
      return { c, score: baseScore + overlap * 25 + c.signal_count };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, caps.maxConvergences)
    .map((s) => s.c);

  return { axioms: scoredAxioms, convergences: scoredConv };
}

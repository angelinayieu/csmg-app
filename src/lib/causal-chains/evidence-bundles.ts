import type { CausalChain } from "@/types/causal-chains";
import type { EvidenceRegistryRow } from "@/types/evidence-registry";
import type {
  EntityEvidenceBundle,
  ChainEvidenceBundles,
  EvidenceCitation,
} from "@/types/evidence-bundles";
import {
  evidenceToPoolingInputs,
  poolEffects,
  type PoolingResult,
} from "@/lib/evidence/edge-strength-pooler";

interface EdgePoolingMetadata {
  pooled_effect: number;
  pooled_se: number;
  pooled_ci_lower: number;
  pooled_ci_upper: number;
  tau_squared: number;
  n_studies: number;
  evidence_row_ids: string[];
  reml_iterations: number;
  recomputed_at: string;
}

interface EdgeRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  dynamics_properties: Record<string, unknown> | null;
}

interface EntityRow {
  entity_id: string;
  name: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export async function loadChainEvidenceBundles(
  db: AnyDb,
  spaceId: string,
  chain: CausalChain,
): Promise<ChainEvidenceBundles> {
  const chainEntityIds = collectChainEntityIds(chain);
  if (chainEntityIds.length === 0) {
    return { chain_id: chain.id, bundles: [], uncovered_entity_ids: [] };
  }

  const orFilter = chainEntityIds
    .flatMap((id) => [`source_entity_id.eq.${id}`, `target_entity_id.eq.${id}`])
    .join(",");

  const [{ data: entityRows }, { data: edgeRows }, { data: evidenceRows }] =
    await Promise.all([
      db
        .from("entities")
        .select("entity_id, name")
        .eq("space_id", spaceId)
        .in("entity_id", chainEntityIds),
      db
        .from("edges")
        .select("id, source_entity_id, target_entity_id, dynamics_properties")
        .eq("space_id", spaceId)
        .or(orFilter),
      db
        .from("evidence_registries")
        .select("*")
        .eq("space_id", spaceId)
        .in("status", ["extracted", "reviewed"])
        .in("attached_entity_id", chainEntityIds),
    ]);

  const entities = (entityRows ?? []) as EntityRow[];
  const edges = (edgeRows ?? []) as EdgeRow[];
  const evidence = (evidenceRows ?? []) as EvidenceRegistryRow[];

  const entityNameMap = new Map(entities.map((e) => [e.entity_id, e.name]));
  const evidenceByEntity = groupEvidenceByEntity(evidence);
  const newestEvidenceTsByEntity = newestEvidenceTimestamps(evidence);
  const edgePoolCache = buildEdgePoolCache(edges, newestEvidenceTsByEntity);

  const bundles: EntityEvidenceBundle[] = [];
  const uncovered: string[] = [];

  for (const entityId of chainEntityIds) {
    const cached = edgePoolCache.get(entityId);
    if (cached) {
      bundles.push({
        attached_entity_id: entityId,
        entity_name: entityNameMap.get(entityId) ?? entityId,
        pooled: cached.pooled,
        effect_metric: cached.dominantMetric,
        citations: cached.citations,
        source: "edge_cache",
      });
      continue;
    }
    const rows = evidenceByEntity.get(entityId) ?? [];
    if (rows.length === 0) {
      uncovered.push(entityId);
      continue;
    }
    const inputs = evidenceToPoolingInputs(rows);
    const pooled = poolEffects(inputs);
    if (!pooled) {
      uncovered.push(entityId);
      continue;
    }
    bundles.push({
      attached_entity_id: entityId,
      entity_name: entityNameMap.get(entityId) ?? entityId,
      pooled,
      effect_metric: dominantMetric(rows),
      citations: rows.map(rowToCitation),
      source: "live_pooled",
    });
  }

  return {
    chain_id: chain.id,
    bundles,
    uncovered_entity_ids: uncovered,
  };
}

export function collectChainEntityIds(chain: CausalChain): string[] {
  const ids = new Set<string>();
  for (const stage of chain.stages) {
    if (stage.entity_id) ids.add(stage.entity_id);
  }
  for (const id of chain.entity_ids ?? []) ids.add(id);
  return [...ids];
}

function groupEvidenceByEntity(
  rows: EvidenceRegistryRow[],
): Map<string, EvidenceRegistryRow[]> {
  const map = new Map<string, EvidenceRegistryRow[]>();
  for (const r of rows) {
    if (!r.attached_entity_id) continue;
    const arr = map.get(r.attached_entity_id) ?? [];
    arr.push(r);
    map.set(r.attached_entity_id, arr);
  }
  return map;
}

// Newest evidence timestamp per entity. Used to detect stale edge-cache:
// if the cache's recomputed_at predates the entity's newest evidence row,
// we fall through to live-pooling instead of trusting the cache.
function newestEvidenceTimestamps(
  rows: EvidenceRegistryRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.attached_entity_id) continue;
    const ts = Date.parse(r.updated_at ?? r.created_at ?? "");
    if (!Number.isFinite(ts)) continue;
    const prev = map.get(r.attached_entity_id);
    if (prev === undefined || ts > prev) map.set(r.attached_entity_id, ts);
  }
  return map;
}

interface EdgeCacheEntry {
  pooled: PoolingResult;
  dominantMetric: string;
  citations: EvidenceCitation[];
}

function buildEdgePoolCache(
  edges: EdgeRow[],
  newestEvidenceTs: Map<string, number>,
): Map<string, EdgeCacheEntry> {
  const cache = new Map<string, EdgeCacheEntry>();
  for (const edge of edges) {
    const meta = edge.dynamics_properties?.pooling_metadata as
      | EdgePoolingMetadata
      | undefined;
    if (!meta || !Number.isFinite(meta.pooled_effect)) continue;

    const cacheTs = Date.parse(meta.recomputed_at ?? "");
    if (!Number.isFinite(cacheTs)) continue;

    // Reject stale cache: if either endpoint has evidence newer than the
    // cache's recompute timestamp, don't use the cache for either.
    const srcNewest = newestEvidenceTs.get(edge.source_entity_id) ?? 0;
    const tgtNewest = newestEvidenceTs.get(edge.target_entity_id) ?? 0;
    if (cacheTs < srcNewest || cacheTs < tgtNewest) continue;

    const pooled: PoolingResult = {
      pooled_effect: meta.pooled_effect,
      pooled_se: meta.pooled_se,
      pooled_ci_lower: meta.pooled_ci_lower,
      pooled_ci_upper: meta.pooled_ci_upper,
      tau_squared: meta.tau_squared,
      n_studies: meta.n_studies,
      evidence_row_ids: meta.evidence_row_ids,
      reml_iterations: meta.reml_iterations,
    };
    const entry: EdgeCacheEntry = {
      pooled,
      dominantMetric: "mixed",
      citations: meta.evidence_row_ids.map((id) => ({
        evidence_id: id,
        ingested_file_id: null,
        quote: null,
        page: null,
      })),
    };
    if (!cache.has(edge.source_entity_id)) cache.set(edge.source_entity_id, entry);
    if (!cache.has(edge.target_entity_id)) cache.set(edge.target_entity_id, entry);
  }
  return cache;
}

function dominantMetric(rows: EvidenceRegistryRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.effect_metric) continue;
    counts.set(r.effect_metric, (counts.get(r.effect_metric) ?? 0) + 1);
  }
  if (counts.size === 0) return "unknown";
  if (counts.size === 1) return [...counts.keys()][0];
  return "mixed";
}

function rowToCitation(r: EvidenceRegistryRow): EvidenceCitation {
  return {
    evidence_id: r.id,
    ingested_file_id: r.ingested_file_id,
    quote: r.source_quote,
    page: r.source_page,
  };
}

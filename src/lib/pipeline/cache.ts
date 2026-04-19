// ── Pipeline cache + fingerprinting utilities ──
// Purpose: eliminate redundant LLM calls when inputs haven't meaningfully changed.
// Caches keyed by a stable fingerprint of the decomposition state (entities + edges)
// so any structural change invalidates the cache naturally.

import { createHash } from "crypto";

export type CacheMode = "prefer" | "skip" | "only";

interface EntityLike {
  entity_id?: string;
  name?: string;
  importance?: string;
}
interface EdgeLike {
  source_entity_id?: string;
  target_entity_id?: string;
  relationship_type?: string;
}

/**
 * Compute a stable fingerprint of the decomposition state. Changes when entities
 * or edges change structurally. Used to detect whether re-synthesis is warranted
 * and whether a cached research result still applies.
 */
export function computeDecompFingerprint(
  entities: EntityLike[],
  edges: EdgeLike[],
): string {
  const entityDigest = [...entities]
    .map((e) => `${e.entity_id ?? ""}|${(e.name ?? "").toLowerCase()}|${e.importance ?? ""}`)
    .sort()
    .join("\n");
  const edgeDigest = [...edges]
    .map((e) => `${e.source_entity_id ?? ""}→${e.target_entity_id ?? ""}|${(e.relationship_type ?? "").toLowerCase()}`)
    .sort()
    .join("\n");
  return createHash("sha256")
    .update(`${entityDigest}\n--\n${edgeDigest}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Compute a cache key for a research request. Combines depth + the fingerprint of
 * the spaces involved so cache invalidates when structure shifts.
 */
export function computeResearchCacheKey(
  depth: string,
  fingerprints: string[],
): string {
  const sortedFingerprints = [...fingerprints].sort().join("|");
  return createHash("sha256")
    .update(`${depth}::${sortedFingerprints}`)
    .digest("hex")
    .slice(0, 16);
}

export interface ResearchCacheEntry {
  key: string;
  depth: string;
  stored_at: string; // ISO timestamp
  // The payload is kept opaque — callers validate the shape themselves
  payload: Record<string, unknown>;
}

export interface ResearchCache {
  entries: ResearchCacheEntry[];
}

const DEFAULT_TTL_DAYS = 7;

export function isCacheFresh(storedAt: string, ttlDays: number = DEFAULT_TTL_DAYS): boolean {
  const stored = new Date(storedAt).getTime();
  if (!Number.isFinite(stored)) return false;
  const ageMs = Date.now() - stored;
  return ageMs >= 0 && ageMs <= ttlDays * 24 * 60 * 60 * 1000;
}

export function findFreshCacheEntry(
  cache: ResearchCache | undefined | null,
  key: string,
  ttlDays: number = DEFAULT_TTL_DAYS,
): ResearchCacheEntry | null {
  if (!cache?.entries?.length) return null;
  const hit = cache.entries.find((e) => e.key === key);
  if (!hit) return null;
  if (!isCacheFresh(hit.stored_at, ttlDays)) return null;
  return hit;
}

/**
 * Store a cache entry, trimming the list to the most recent 10 entries to prevent
 * synthesis_data bloat on long-lived spaces.
 */
export function appendCacheEntry(
  cache: ResearchCache | undefined | null,
  entry: ResearchCacheEntry,
  maxEntries = 10,
): ResearchCache {
  const existing = (cache?.entries ?? []).filter((e) => e.key !== entry.key);
  const updated = [entry, ...existing].slice(0, maxEntries);
  return { entries: updated };
}

export function humanAge(storedAt: string): string {
  const ms = Date.now() - new Date(storedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

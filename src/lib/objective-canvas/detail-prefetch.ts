// ── Object-detail prefetch cache ──
//
// Lets card components warm the network round-trips for the object-detail rail
// BEFORE the rail mounts — so by the time the user's click lands and the rail
// renders, the data is already in memory.
//
// Two caches, both keyed by URL:
//   - object detail:  /api/brainstorm/space/[spaceId]/library/objects/[objectId]
//   - glossary:       /api/brainstorm/space/[spaceId]/glossary
// Each entry holds either a live in-flight Promise (so a click during prefetch
// reuses the same fetch) OR the resolved JSON. Entries expire after a short
// TTL so we don't show stale data; the rail also still fires its own fetch on
// mount as a safety net — the cache just short-circuits it when warm.
//
// All best-effort: every helper soft-fails (no throws to the caller).

const OBJECT_TTL_MS = 15_000;
const GLOSSARY_TTL_MS = 30_000;

type CacheEntry<T> = {
  ts: number;
  // Live fetch in-flight — late callers await this same promise.
  promise?: Promise<T | null>;
  // Resolved JSON (or null on soft-fail).
  value?: T | null;
};

const objectCache = new Map<string, CacheEntry<unknown>>();
const glossaryCache = new Map<string, CacheEntry<unknown>>();

function objectKey(spaceId: string, objectId: string) {
  return `${spaceId}::${objectId}`;
}

function fresh<T>(e: CacheEntry<T> | undefined, ttl: number): boolean {
  if (!e) return false;
  return Date.now() - e.ts < ttl;
}

function startFetch<T>(url: string): Promise<T | null> {
  return fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);
}

/** Warm the object-detail fetch. Idempotent — if the same key is in flight or
 *  recently cached, returns the existing entry's promise. Safe to call from
 *  hover/pointerdown handlers. */
export function prefetchObjectDetail(spaceId: string, objectId: string): void {
  if (!spaceId || !objectId) return;
  const key = objectKey(spaceId, objectId);
  const existing = objectCache.get(key);
  if (fresh(existing, OBJECT_TTL_MS)) return;
  const promise = startFetch(
    `/api/brainstorm/space/${spaceId}/library/objects/${objectId}`,
  );
  const entry: CacheEntry<unknown> = { ts: Date.now(), promise };
  objectCache.set(key, entry);
  void promise.then((v) => {
    entry.value = v ?? null;
    entry.promise = undefined;
    entry.ts = Date.now();
  });
}

/** Consume a prefetched object-detail entry. Returns the resolved JSON (if
 *  ready), or a Promise to await (if a prefetch is in flight), or null to
 *  signal "no cache — fetch fresh". The entry is left in place so a remount
 *  within the TTL still hits warm. */
export function takeObjectDetail<T = unknown>(
  spaceId: string,
  objectId: string,
): T | Promise<T | null> | null {
  const key = objectKey(spaceId, objectId);
  const e = objectCache.get(key);
  if (!e || !fresh(e, OBJECT_TTL_MS)) return null;
  if (e.value !== undefined) return e.value as T;
  if (e.promise) return e.promise as Promise<T | null>;
  return null;
}

/** Invalidate a single object's cache entry (call after a write that the rail
 *  needs to reflect — e.g. + Link / Make-it-mine). */
export function invalidateObjectDetail(spaceId: string, objectId: string) {
  objectCache.delete(objectKey(spaceId, objectId));
}

/** Warm the space glossary fetch. Cheap to call repeatedly. */
export function prefetchGlossary(spaceId: string): void {
  if (!spaceId) return;
  const existing = glossaryCache.get(spaceId);
  if (fresh(existing, GLOSSARY_TTL_MS)) return;
  const promise = startFetch(`/api/brainstorm/space/${spaceId}/glossary`);
  const entry: CacheEntry<unknown> = { ts: Date.now(), promise };
  glossaryCache.set(spaceId, entry);
  void promise.then((v) => {
    entry.value = v ?? null;
    entry.promise = undefined;
    entry.ts = Date.now();
  });
}

export function takeGlossary<T = unknown>(
  spaceId: string,
): T | Promise<T | null> | null {
  const e = glossaryCache.get(spaceId);
  if (!e || !fresh(e, GLOSSARY_TTL_MS)) return null;
  if (e.value !== undefined) return e.value as T;
  if (e.promise) return e.promise as Promise<T | null>;
  return null;
}

export function invalidateGlossary(spaceId: string) {
  glossaryCache.delete(spaceId);
}

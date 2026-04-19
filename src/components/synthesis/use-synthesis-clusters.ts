"use client";

// Phase 39 — Synthesis clusters (v1, local persistence).
//
// The Miro-killer composability feature: users drag one feed event onto
// another to group them into a cluster. The cluster itself renders as a
// new event in the same feed, with its members shown inline when
// expanded. Nested clusters are supported (you can drag a cluster into
// another cluster).
//
// Persistence: localStorage for v1. Keyed by space so clusters don't
// leak across workspaces. Future Phase 40 will upgrade to a
// synthesis_clusters Supabase table; the hook interface is designed so
// that upgrade is a drop-in (same shape, just different storage).
//
// Why localStorage first:
//   - Fully wired without a schema migration
//   - Demos correctly: state survives refresh within the same browser
//   - Isolates UX from backend concerns so we can iterate on gestures
//   - Easy to migrate: on first server load, seed from localStorage

import { useCallback, useEffect, useState } from "react";

export type ClusterMemberKind =
  | "reaction"
  | "decomposition"
  | "bridge"
  | "cluster";

export interface ClusterMember {
  /** The feed event kind this member references. */
  kind: ClusterMemberKind;
  /** The feed event's id (matches FeedEvent.id). */
  id: string;
}

export interface PersistedCluster {
  id: string;
  name: string;
  members: ClusterMember[];
  created_at: string;
  updated_at: string;
}

const VERSION = 1;

interface PersistedShape {
  v: number;
  clusters: PersistedCluster[];
}

function storageKey(spaceId: string): string {
  return `synthesis-clusters:${spaceId}`;
}

function readClusters(spaceId: string): PersistedCluster[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(spaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedShape;
    if (typeof parsed !== "object" || parsed === null) return [];
    if (parsed.v !== VERSION) return []; // future: run migration
    if (!Array.isArray(parsed.clusters)) return [];
    return parsed.clusters.filter(isWellFormed);
  } catch {
    return [];
  }
}

function isWellFormed(c: unknown): c is PersistedCluster {
  if (typeof c !== "object" || c === null) return false;
  const obj = c as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.created_at === "string" &&
    typeof obj.updated_at === "string" &&
    Array.isArray(obj.members)
  );
}

function writeClusters(spaceId: string, clusters: PersistedCluster[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedShape = { v: VERSION, clusters };
    window.localStorage.setItem(storageKey(spaceId), JSON.stringify(payload));
  } catch {
    /* quota exceeded or private mode — silent */
  }
}

function uuid4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return (
    Math.random().toString(36).slice(2, 10) +
    "-" +
    Date.now().toString(36)
  );
}

export interface UseSynthesisClusters {
  clusters: PersistedCluster[];
  /**
   * Create a cluster from two or more member references. Returns the new
   * cluster id. De-duplicates members by (kind,id).
   */
  createCluster: (members: ClusterMember[], name?: string) => string | null;
  /**
   * Append members to an existing cluster. No-op if cluster doesn't
   * exist or no new members to add (after dedup).
   */
  addToCluster: (clusterId: string, members: ClusterMember[]) => void;
  deleteCluster: (clusterId: string) => void;
  renameCluster: (clusterId: string, name: string) => void;
  /** Remove a single member from a cluster. If it leaves <2 members, deletes the cluster. */
  removeMember: (clusterId: string, member: ClusterMember) => void;
}

export function useSynthesisClusters(
  spaceId: string | null | undefined,
): UseSynthesisClusters {
  const [clusters, setClusters] = useState<PersistedCluster[]>([]);

  // Hydrate on mount. Browser-only read so SSR doesn't see stale state.
  useEffect(() => {
    if (!spaceId) return;
    setClusters(readClusters(spaceId));
  }, [spaceId]);

  // Persist on every change. Write is the same size as the payload, so
  // we don't need debouncing for typical cluster volumes.
  useEffect(() => {
    if (!spaceId) return;
    writeClusters(spaceId, clusters);
  }, [spaceId, clusters]);

  const createCluster = useCallback(
    (members: ClusterMember[], name?: string): string | null => {
      const deduped = dedupeMembers(members);
      if (deduped.length < 2) return null;
      const id = uuid4();
      const now = new Date().toISOString();
      const cluster: PersistedCluster = {
        id,
        name: name?.trim() || defaultClusterName(deduped),
        members: deduped,
        created_at: now,
        updated_at: now,
      };
      setClusters((prev) => [cluster, ...prev]);
      return id;
    },
    [],
  );

  const addToCluster = useCallback(
    (clusterId: string, members: ClusterMember[]) => {
      setClusters((prev) =>
        prev.map((c) => {
          if (c.id !== clusterId) return c;
          const combined = dedupeMembers([...c.members, ...members]);
          if (combined.length === c.members.length) return c;
          return {
            ...c,
            members: combined,
            updated_at: new Date().toISOString(),
          };
        }),
      );
    },
    [],
  );

  const deleteCluster = useCallback((clusterId: string) => {
    setClusters((prev) => prev.filter((c) => c.id !== clusterId));
  }, []);

  const renameCluster = useCallback((clusterId: string, name: string) => {
    setClusters((prev) =>
      prev.map((c) =>
        c.id === clusterId
          ? { ...c, name: name.trim() || c.name, updated_at: new Date().toISOString() }
          : c,
      ),
    );
  }, []);

  const removeMember = useCallback(
    (clusterId: string, member: ClusterMember) => {
      setClusters((prev) => {
        const next: PersistedCluster[] = [];
        for (const c of prev) {
          if (c.id !== clusterId) {
            next.push(c);
            continue;
          }
          const remaining = c.members.filter(
            (m) => !(m.kind === member.kind && m.id === member.id),
          );
          if (remaining.length < 2) {
            // Drop the cluster — it's no longer a cluster.
            continue;
          }
          next.push({
            ...c,
            members: remaining,
            updated_at: new Date().toISOString(),
          });
        }
        return next;
      });
    },
    [],
  );

  return {
    clusters,
    createCluster,
    addToCluster,
    deleteCluster,
    renameCluster,
    removeMember,
  };
}

function dedupeMembers(members: ClusterMember[]): ClusterMember[] {
  const seen = new Set<string>();
  const out: ClusterMember[] = [];
  for (const m of members) {
    const key = `${m.kind}:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function defaultClusterName(members: ClusterMember[]): string {
  return `Cluster · ${members.length} items`;
}

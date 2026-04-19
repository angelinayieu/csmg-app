"use client";

import { useMemo } from "react";
import type { Entity } from "@/types";

// Phase 9a — Probability space children resolution.
//
// "Children" of an entity = entities whose provenance.parent_entity_id
// points to that entity. These are the proxy indicators produced by
// /api/canvas/recursive-decompose, plus any manually-created children.
//
// Returns a two-layer tree (direct children + their children) so the
// probability-space rings can show layered indicator segments.

export interface ProbabilityChild {
  entity: Entity;
  /** How the child relates to the parent (from edge relationship_type, if known) */
  relationship: string | null;
  /** Recursive indicator children of this child (depth 2) */
  grandchildren: Entity[];
}

export interface ProbabilitySpaceTree {
  parent: Entity;
  children: ProbabilityChild[];
  /** True if no children exist yet — the rings render a single "+ decompose" slot. */
  isEmpty: boolean;
}

export interface UseProbabilitySpaceChildrenOptions {
  parent: Entity | null;
  allEntities: Entity[];
}

function parentIdOf(e: Entity): string | null {
  const prov = e.provenance as
    | { parent_entity_id?: string | null }
    | null
    | undefined;
  if (!prov || typeof prov !== "object") return null;
  return prov.parent_entity_id ?? null;
}

export function useProbabilitySpaceChildren({
  parent,
  allEntities,
}: UseProbabilitySpaceChildrenOptions): ProbabilitySpaceTree | null {
  return useMemo(() => {
    if (!parent) return null;

    // Build a parent_id → children index once
    const byParent = new Map<string, Entity[]>();
    for (const e of allEntities) {
      const pid = parentIdOf(e);
      if (!pid) continue;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(e);
    }

    const directChildren = byParent.get(parent.id) ?? [];
    const children: ProbabilityChild[] = directChildren.map((c) => ({
      entity: c,
      relationship: null,
      grandchildren: byParent.get(c.id) ?? [],
    }));

    return {
      parent,
      children,
      isEmpty: children.length === 0,
    };
  }, [parent, allEntities]);
}

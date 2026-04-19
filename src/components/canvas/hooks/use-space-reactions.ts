"use client";

// Phase 30 — canvas-wide reactions hook + per-entity index.
//
// Lists every saved reaction in a space (capped at 80 by the API) and
// builds an index keyed by entity id so KGNodeShape cards can render a
// visible chip showing "this entity participates in N reactions". Until
// now, reaction work done in the lab was invisible back on the canvas —
// this closes the review's #1 conceptual wound (C5 / "reactions are a
// dead end").

import { useEffect, useMemo, useState } from "react";
import type { Reaction, ReactionType } from "@/types/reactions";

export interface EntityReactionSummary {
  count: number;
  /** Types touching this entity, ordered by appearance. */
  types: ReactionType[];
  /** First reaction id — used as the default focus for deep links. */
  firstId: string;
  /** All reactions touching this entity, newest-first. */
  all: Reaction[];
}

export interface SpaceReactionsIndex {
  byEntity: Map<string, EntityReactionSummary>;
  total: number;
  loading: boolean;
}

/**
 * Fetches every reaction for a space on mount. Returns a per-entity index
 * plus raw count. Caller re-runs on refreshKey change (e.g. after a save).
 */
export function useSpaceReactions(
  spaceId: string | null | undefined,
  refreshKey: number = 0,
): SpaceReactionsIndex {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId) {
      setReactions([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/canvas/reactions?spaceId=${encodeURIComponent(spaceId)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: { reactions?: Reaction[] }) => {
        setReactions(json.reactions ?? []);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setReactions([]);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [spaceId, refreshKey]);

  const byEntity = useMemo(() => {
    const m = new Map<string, EntityReactionSummary>();
    // reactions are already newest-first from the API
    for (const r of reactions) {
      for (const eid of r.entity_ids) {
        const cur = m.get(eid);
        if (cur) {
          cur.count += 1;
          if (!cur.types.includes(r.reaction_type)) cur.types.push(r.reaction_type);
          cur.all.push(r);
        } else {
          m.set(eid, {
            count: 1,
            types: [r.reaction_type],
            firstId: r.id,
            all: [r],
          });
        }
      }
    }
    return m;
  }, [reactions]);

  return { byEntity, total: reactions.length, loading };
}

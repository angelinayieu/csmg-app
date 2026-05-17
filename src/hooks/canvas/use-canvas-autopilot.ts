// ── useCanvasAutopilot ──
//
// Round-based recursive decomposition for the unified canvas. The
// canvas equivalent of /hooks/synergy/use-autopilot.ts.
//
// Each round:
//   1. Reads the current entities + edges from the space context.
//   2. Picks the freshest unexpanded "leaf" entity (no children
//      created by decompose).
//   3. POSTs /api/canvas/recursive-decompose to spawn 2-3 children.
//   4. Waits for the canvas painter to settle (SSE events animate
//      the new entities in) before the next round starts.
//
// Stops when:
//   - The requested round count is reached.
//   - No unexpanded leaves remain.
//   - The user calls stop().
//   - An LLM call errors out.

"use client";

import { useCallback, useRef, useState } from "react";
import type { Entity, Edge } from "@/types";

export type CanvasAutopilotPhase =
  | { kind: "idle" }
  | { kind: "running"; round: number; total: number }
  | { kind: "stopped"; reason: string; completed: number; total: number }
  | { kind: "error"; message: string };

interface RunArgs {
  spaceId: string;
  rounds: number;
  /** Live entities + edges from the space context. The hook reads
   *  these on each round-tick to find the freshest leaf. */
  getEntities: () => Entity[];
  getEdges: () => Edge[];
  onRound?: (info: {
    round: number;
    targetEntityId: string;
    childCount: number;
  }) => void;
}

interface UseCanvasAutopilotReturn {
  phase: CanvasAutopilotPhase;
  run: (args: RunArgs) => Promise<void>;
  stop: () => void;
}

// Inter-round pause so the SSE-driven canvas painter animates the
// new entities in before the next decompose call fires. Long enough
// to feel like a beat; short enough not to feel sluggish.
const ROUND_PAUSE_MS = 450;

export function useCanvasAutopilot(): UseCanvasAutopilotReturn {
  const [phase, setPhase] = useState<CanvasAutopilotPhase>({ kind: "idle" });
  const stopRequested = useRef(false);

  const stop = useCallback(() => {
    stopRequested.current = true;
  }, []);

  const run = useCallback(async (args: RunArgs) => {
    const { spaceId, rounds, getEntities, getEdges, onRound } = args;
    stopRequested.current = false;
    setPhase({ kind: "running", round: 1, total: rounds });

    let completed = 0;
    try {
      for (let r = 1; r <= rounds; r++) {
        if (stopRequested.current) {
          setPhase({
            kind: "stopped",
            reason: "Stopped by user",
            completed,
            total: rounds,
          });
          return;
        }
        setPhase({ kind: "running", round: r, total: rounds });

        const target = pickFreshestLeaf(getEntities(), getEdges());
        if (!target) {
          setPhase({
            kind: "stopped",
            reason: "Every leaf is expanded",
            completed,
            total: rounds,
          });
          return;
        }

        const res = await fetch("/api/canvas/recursive-decompose", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId, entityId: target.entity_id ?? target.id }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `${res.status}`);
        }
        const json = (await res.json().catch(() => ({}))) as {
          children?: Array<{
            id: string;
            entity_id?: string;
            name?: string;
            description?: string | null;
            entity_category?: string | null;
            confidence?: number | null;
          }>;
        };
        const kids = json.children ?? [];
        const childCount = kids.length;
        // Phase 2c-D — dispatch a window event so the in-canvas
        // CanvasAutopilotSpawner can paint kg-node shapes near the
        // parent. The autopilot panel lives outside the editor
        // tree, so direct editor.createShapes calls aren't an
        // option from here; the event bus is the bridge.
        if (kids.length > 0 && target.entity_id) {
          const placeable = kids
            .filter(
              (k): k is typeof k & { entity_id: string; name: string } =>
                typeof k.entity_id === "string" && typeof k.name === "string",
            )
            .map((k) => ({
              id: k.id,
              entity_id: k.entity_id,
              name: k.name,
              description: k.description ?? null,
              entity_category: k.entity_category ?? null,
              confidence: k.confidence ?? null,
            }));
          if (placeable.length > 0) {
            window.dispatchEvent(
              new CustomEvent("interaxis:autopilot-round", {
                detail: {
                  spaceId,
                  parentEntityId: target.entity_id,
                  children: placeable,
                },
              }),
            );
          }
        }
        completed += 1;
        onRound?.({ round: r, targetEntityId: target.id, childCount });

        // Inter-round breath so the canvas paints.
        await new Promise((resolve) => setTimeout(resolve, ROUND_PAUSE_MS));
      }
      setPhase({
        kind: "stopped",
        reason: "Done",
        completed,
        total: rounds,
      });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  return { phase, run, stop };
}

// ── Helpers ──

// A "leaf" is an entity with no outgoing parent/decomposes-to
// edges that ALSO hasn't been probed for decomposition yet. The
// canvas's entities table doesn't store created_at on the row
// type, so we use `decomposition_probed_at` as the freshness
// signal: nulls = never touched = candidates; among candidates we
// pick the lowest analysis_count as the "freshest" leaf (proxy for
// "most recently created and least worked over"). Deterministic.
function pickFreshestLeaf(entities: Entity[], edges: Edge[]): Entity | null {
  if (entities.length === 0) return null;
  const hasChildren = new Set<string>();
  for (const e of edges) {
    if (
      e.relationship_type === "parent_of" ||
      e.relationship_type === "decomposes_to"
    ) {
      hasChildren.add(e.source_entity_id);
    }
  }
  const leaves = entities.filter(
    (e) =>
      !hasChildren.has(e.entity_id ?? e.id) &&
      e.decomposition_probed_at === null,
  );
  if (leaves.length === 0) return null;
  // Lowest analysis_count first; ties broken by reverse-id order so
  // the most recently inserted row wins (Supabase generates UUIDs in
  // creation order under most workloads).
  const sorted = [...leaves].sort((a, b) => {
    const ca = a.analysis_count ?? 0;
    const cb = b.analysis_count ?? 0;
    if (ca !== cb) return ca - cb;
    return b.id.localeCompare(a.id);
  });
  return sorted[0];
}

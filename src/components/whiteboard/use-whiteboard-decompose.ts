"use client";

// ── useWhiteboardDecompose ──
//
// Orchestrates the in-place decompose action for the whiteboard. Flow:
//
//   1. Call /api/pipeline/expand to generate the expansion record for the
//      parent entity. This creates an `expansions` row with sub_components +
//      internal_pathways.
//   2. Call /api/pipeline/materialize-expansions to promote the expansion
//      record into actual entities + edges in the graph.
//   3. Ask the parent (route/overview) to re-fetch space data so the new
//      entities appear in the canvas.
//   4. Plan child positions using planDecomposeLayout: centered under parent,
//      in the layer band below, with sibling shifts if overlap would occur.
//   5. Commit planned child positions + sibling shifts to whiteboard_positions
//      (via the setManyPositions handler passed in).
//   6. Mark the new entity IDs as "spawning" for the CSS spawn animation.
//
// Returns state: loading + error + spawningIds (to pass through to canvas).

import { useState, useCallback } from "react";
import type { Entity } from "@/types";
import {
  planDecomposeLayout,
  estimateChildSize,
  type ExistingNode,
} from "./decompose-layout";

export interface UseWhiteboardDecomposeOptions {
  spaceId: string;
  /** Called after entities+edges are materialized. Return the updated entity list. */
  refreshData: () => Promise<{ entities: Entity[] } | null>;
  /** Called with the planned layout updates (both new children AND sibling shifts). */
  applyPositions: (updates: Array<{ entity_id: string; x: number; y: number }>) => void;
}

interface DecomposeState {
  loading: boolean;
  error: string | null;
  /** Entity UUIDs that were just spawned — canvas uses this for animation. */
  spawningIds: Set<string>;
}

export function useWhiteboardDecompose({
  spaceId,
  refreshData,
  applyPositions,
}: UseWhiteboardDecomposeOptions) {
  const [state, setState] = useState<DecomposeState>({
    loading: false,
    error: null,
    spawningIds: new Set(),
  });

  /**
   * Trigger in-place decompose for a parent entity.
   * @param parent - The entity being decomposed
   * @param parentRect - Current canvas rect of the parent node
   * @param existingNodes - All other nodes currently on the canvas (for overlap detection + shift)
   * @param depthLevel - Optional depth override (1–5). Default 1 for backward compat.
   *                    Higher levels produce more sub-components and deeper analysis.
   */
  const decompose = useCallback(
    async (
      parent: Entity,
      parentRect: { x: number; y: number; width: number; height: number },
      existingNodes: ExistingNode[],
      depthLevel: number = 1,
    ) => {
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        // 1. Expand the parent — generates the expansion record
        const expandRes = await fetch("/api/pipeline/expand", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entity_id: parent.id,
            space_id: spaceId,
            depth_level: Math.max(1, Math.min(5, Math.round(depthLevel))),
          }),
        });
        if (!expandRes.ok) {
          const err = await expandRes.json().catch(() => ({}));
          throw new Error(err.error ?? `Expand failed: HTTP ${expandRes.status}`);
        }

        // 2. Materialize expansion → real entities + edges
        const matRes = await fetch("/api/pipeline/materialize-expansions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId }),
        });
        if (!matRes.ok) {
          const err = await matRes.json().catch(() => ({}));
          throw new Error(err.error ?? `Materialize failed: HTTP ${matRes.status}`);
        }

        // 3. Refresh local entity list
        const refreshed = await refreshData();
        if (!refreshed) {
          throw new Error("Failed to refresh space data after decompose");
        }

        // 4. Identify newly-added children — entities whose provenance points
        //    at this parent via expansion_materialization and didn't exist
        //    before. We detect by checking parent_entity_id.
        const priorIds = new Set(existingNodes.map((n) => n.entity_id));
        const newChildren = refreshed.entities.filter((e) => {
          if (priorIds.has(e.id)) return false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parentId = (e as any).parent_entity_id as string | undefined;
          return parentId === parent.id;
        });

        if (newChildren.length === 0) {
          // Nothing spawned — this parent might already have been expanded
          // (cached expansion). Surface a soft notice via error state.
          setState((s) => ({
            ...s,
            loading: false,
            error: "No new children produced. This entity may already be expanded.",
          }));
          return;
        }

        // 5. Plan positions: center children under parent, shift overlapping siblings
        const { childPlans, siblingShifts } = planDecomposeLayout(
          { entity_id: parent.id, ...parentRect },
          newChildren.map((c) => ({ entity_id: c.id, ...estimateChildSize() })),
          existingNodes,
        );

        // 6. Apply positions — one batch of updates covering children + shifts
        const updates: Array<{ entity_id: string; x: number; y: number }> = [];

        for (const plan of childPlans) {
          updates.push({ entity_id: plan.entity_id, x: plan.x, y: plan.y });
        }

        for (const [entity_id, shift] of siblingShifts.entries()) {
          const existing = existingNodes.find((n) => n.entity_id === entity_id);
          if (!existing) continue;
          updates.push({
            entity_id,
            x: existing.x + shift.dx,
            y: existing.y,
          });
        }

        applyPositions(updates);

        // 7. Mark new children as spawning for 0.8s so the CSS animation fires
        const spawnIds = new Set(newChildren.map((c) => c.id));
        setState({
          loading: false,
          error: null,
          spawningIds: spawnIds,
        });

        // Clear spawn state after animation completes
        setTimeout(() => {
          setState((s) => ({ ...s, spawningIds: new Set() }));
        }, 800);
      } catch (err) {
        console.error("[useWhiteboardDecompose] Error:", err);
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Decompose failed",
        }));
      }
    },
    [spaceId, refreshData, applyPositions],
  );

  return {
    decompose,
    loading: state.loading,
    error: state.error,
    spawningIds: state.spawningIds,
    clearError: () => setState((s) => ({ ...s, error: null })),
  };
}

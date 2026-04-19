"use client";

// ── WhiteboardOverview ──
//
// Full-mass overview view. Orchestrates:
//   - Persistent node positions (via useWhiteboardPositions)
//   - Clean in-place decompose (via useWhiteboardDecompose)
//   - Canvas rendering (delegated to WhiteboardCanvas)
//
// The overview owns position state so decompose can batch child-placement +
// sibling-shift updates into a single applyPositions call.

import React, { useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Network, Layers, Loader2, AlertTriangle, X } from "lucide-react";
import { useSpaceData } from "@/contexts/space-data-context";
import { WhiteboardCanvas } from "./whiteboard-canvas";
import { useWhiteboardPositions } from "./use-whiteboard-positions";
import { useWhiteboardDecompose } from "./use-whiteboard-decompose";
import type { Entity } from "@/types";
import type { SynthesisData, Axiom } from "@/types/synthesis";

interface Placement {
  entity_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function WhiteboardOverview() {
  const ctx = useSpaceData();
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

  // Latest placements published by the canvas — used for overlap calcs on decompose.
  const placementsRef = useRef<Placement[]>([]);

  // ── Positions hook — single source of truth for manual overrides ──
  const { positions, setPosition, setManyPositions, resetAll } = useWhiteboardPositions(ctx.space.id);

  // ── Decompose hook — owns the expand → materialize → refresh → position chain ──
  const { decompose, loading: decomposing, error: decomposeError, spawningIds, clearError } = useWhiteboardDecompose({
    spaceId: ctx.space.id,
    refreshData: async () => {
      // Trigger router refresh + wait for it to complete. The context will
      // re-hydrate entities/edges on the next render.
      ctx.refresh();
      // Wait one microtask for the context to update. In practice the user
      // may need to manually refresh if the router refresh isn't immediate.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return { entities: ctx.entities };
    },
    applyPositions: setManyPositions,
  });

  const onNodeClick = useCallback(
    (entity: Entity) => {
      setSelectedEntity((prev) => (prev?.id === entity.id ? null : entity));
      ctx.setSelectedEntity(entity);
    },
    [ctx],
  );

  const onDecompose = useCallback(
    async (entity: Entity, depthLevel: number = 1) => {
      const placements = placementsRef.current;
      const parentPlacement = placements.find((p) => p.entity_id === entity.id);
      if (!parentPlacement) {
        console.warn("[WhiteboardOverview] No placement found for parent", entity.id);
        return;
      }

      // Existing nodes for overlap detection (everything EXCEPT the parent)
      const existingNodes = placements
        .filter((p) => p.entity_id !== entity.id)
        .map((p) => ({
          entity_id: p.entity_id,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          shiftable: true,
        }));

      await decompose(entity, parentPlacement, existingNodes, depthLevel);
    },
    [decompose],
  );

  const onPlacementsChanged = useCallback((placements: Placement[]) => {
    placementsRef.current = placements;
  }, []);

  const entityCount = ctx.entities.length;
  const edgeCount = ctx.edges.length;
  const hierarchicalCount = ctx.entities.filter(
    (e) => e.layer === "system" || e.layer === "domain" || e.layer === "thread",
  ).length;
  const hasHierarchical = hierarchicalCount >= 3;

  // ── Reasoning overlays: axiom grounding + expansion state ──
  // Parsed once from space.synthesis_data so the canvas can render violet axiom
  // rings and sky expansion badges directly on nodes.
  const synthesisData = useMemo<SynthesisData | null>(() => {
    const raw = ctx.space.synthesis_data as unknown;
    if (!raw) return null;
    try {
      return (typeof raw === "string" ? JSON.parse(raw as string) : raw) as SynthesisData;
    } catch {
      return null;
    }
  }, [ctx.space.synthesis_data]);

  const axiomGroundingByEntityId = useMemo(() => {
    const m = new Map<string, {
      count: number;
      highest_visibility: "HIDDEN" | "IMPLICIT" | "EXPLICIT";
      highest_load_bearing: "critical" | "important" | "moderate";
    }>();
    const visRank: Record<"HIDDEN" | "IMPLICIT" | "EXPLICIT", number> = { HIDDEN: 3, IMPLICIT: 2, EXPLICIT: 1 };
    const lbRank: Record<"critical" | "important" | "moderate", number> = { critical: 3, important: 2, moderate: 1 };
    const axioms = (synthesisData?.axioms ?? []) as Axiom[];
    for (const ax of axioms) {
      for (const eid of ax.rests_on ?? []) {
        const prev = m.get(eid);
        if (!prev) {
          m.set(eid, {
            count: 1,
            highest_visibility: ax.visibility,
            highest_load_bearing: ax.load_bearing,
          });
        } else {
          m.set(eid, {
            count: prev.count + 1,
            highest_visibility: visRank[ax.visibility] > visRank[prev.highest_visibility]
              ? ax.visibility
              : prev.highest_visibility,
            highest_load_bearing: lbRank[ax.load_bearing] > lbRank[prev.highest_load_bearing]
              ? ax.load_bearing
              : prev.highest_load_bearing,
          });
        }
      }
    }
    return m;
  }, [synthesisData]);

  const expansionByEntityUuid = useMemo(() => {
    const m = new Map<string, { depth: number; subComponentCount: number }>();
    // Primary source: entity.is_expanded + expansion_axioms counts per parent
    const axiomsByParent = new Map<string, number>();
    for (const ax of synthesisData?.expansion_axioms ?? []) {
      axiomsByParent.set(ax.parent_entity_id, (axiomsByParent.get(ax.parent_entity_id) ?? 0) + 1);
    }
    for (const e of ctx.entities) {
      const anyE = e as unknown as { is_expanded?: boolean; expansion_depth?: number; child_count?: number };
      if (anyE.is_expanded) {
        m.set(e.id, {
          depth: typeof anyE.expansion_depth === "number" ? anyE.expansion_depth : 1,
          subComponentCount: typeof anyE.child_count === "number"
            ? anyE.child_count
            : (axiomsByParent.get(e.id) ?? 0),
        });
      }
    }
    return m;
  }, [ctx.entities, synthesisData]);

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb + header */}
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white/85 backdrop-blur-sm px-5 py-3 z-10">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <Link href={`/app/space/${ctx.space.id}/graph`} className="inline-flex items-center gap-1 hover:text-gray-700">
            <ArrowLeft className="h-3 w-3" />
            Back to space
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">Whiteboard</span>
          <span>/</span>
          <span className="font-semibold text-gray-900 inline-flex items-center gap-1.5">
            <Network className="h-3 w-3" />
            Overview
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-600">
          {decomposing && (
            <span className="inline-flex items-center gap-1 text-indigo-700 font-medium">
              <Loader2 className="h-3 w-3 animate-spin" />
              Decomposing…
            </span>
          )}
          <span>
            <span className="font-semibold text-gray-900">{entityCount}</span> entities
          </span>
          <span>
            <span className="font-semibold text-gray-900">{edgeCount}</span> edges
          </span>
          {hasHierarchical && (
            <span className="inline-flex items-center gap-1 text-indigo-700">
              <Layers className="h-3 w-3" />
              hierarchical
            </span>
          )}
        </div>
      </div>

      {/* Decompose error banner */}
      {decomposeError && (
        <div className="flex items-start justify-between gap-3 border-b border-rose-200 bg-rose-50/70 px-5 py-2 text-[11px] text-rose-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{decomposeError}</span>
          </div>
          <button onClick={clearError} className="text-rose-600 hover:text-rose-800">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Helper banner when no hierarchical structure exists */}
      {!hasHierarchical && entityCount > 0 && !decomposeError && (
        <div className="border-b border-amber-200 bg-amber-50/70 px-5 py-2 text-[11px] text-amber-800">
          <span className="font-semibold">Tip:</span> this space has no hierarchical (system/domain/thread) layers yet.
          Nodes will render in the default L2 band. For dimensional structure, re-run decomposition via{" "}
          <code className="font-mono bg-amber-100 px-1 py-0.5 rounded">/api/pipeline/decompose-hierarchical</code>.
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 min-h-0 relative">
        {entityCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-gray-500">
            <Network className="h-10 w-10 text-gray-300" />
            <div className="text-sm font-medium text-gray-700">No entities yet</div>
            <p className="text-xs max-w-md text-gray-500">
              The whiteboard renders the current space. Run decomposition to populate entities and edges.
            </p>
          </div>
        ) : (
          <WhiteboardCanvas
            spaceId={ctx.space.id}
            entities={ctx.entities}
            edges={ctx.edges}
            onNodeClick={onNodeClick}
            onDecompose={onDecompose}
            selectedEntityId={selectedEntity?.id ?? null}
            spawningEntityIds={spawningIds}
            positionOverrides={positions}
            onNodeMoved={setPosition}
            onResetPositions={resetAll}
            onPlacementsChanged={onPlacementsChanged}
            axiomGroundingByEntityId={axiomGroundingByEntityId}
            expansionByEntityUuid={expansionByEntityUuid}
          />
        )}
      </div>
    </div>
  );
}

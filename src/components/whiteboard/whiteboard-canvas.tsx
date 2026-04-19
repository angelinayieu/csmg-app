"use client";

// ── WhiteboardCanvas ──
//
// The main canvas component. Composes:
//   - Pan/zoom surface (useCanvasTransform from operating-twin)
//   - Tier-based node cards
//   - Weighted edges
//   - Cluster zones per layer
//
// Stays read-heavy in Phase A: nodes can be clicked + decompose invoked,
// but we don't yet support dragging nodes around. Manual positioning is
// Phase B.

import React, { useMemo, useRef, useCallback, useEffect, useState } from "react";
import { Plus, Minus, Maximize2, RotateCcw } from "lucide-react";
import "./whiteboard-animations.css";
import { cn } from "@/lib/utils";
import { useCanvasTransform } from "@/components/operating-twin/hooks/use-canvas-transform";
import { classifyAll, detectConvergenceNodes, type TierClassification } from "@/lib/whiteboard/tier-classifier";
import { LAYERS, entityToLayerId, LAYER_ORDER, type LayerId } from "@/lib/whiteboard/layer-config";
import { WhiteboardNode } from "./whiteboard-node";
import { WhiteboardEdge, type WhiteboardEdgeRenderData } from "./whiteboard-edge";
import { WhiteboardClusterZone, computeClusterZones, type ClusterZoneData } from "./whiteboard-cluster-zone";
import { PredictedEdgeAffordance } from "./predicted-edge-affordance";
import { useWhiteboardPositions } from "./use-whiteboard-positions";
import { useNodeDrag } from "./use-node-drag";
import { useCascadeReport } from "./use-cascade-report";
import type { Entity, Edge } from "@/types";

// ── Node layout (per tier → geometry) ──

const TIER_WIDTH_MAP: Record<string, number> = {
  hero: 300,
  key: 260,
  support: 220,
  peripheral: 170,
};
const TIER_HEIGHT_ESTIMATE: Record<string, number> = {
  hero: 170,
  key: 140,
  support: 110,
  peripheral: 56,
};

interface NodePlacement {
  entity: Entity;
  tier: TierClassification["tier"];
  weight: number;
  layer: LayerId;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute node positions grouped by layer in horizontal bands.
 * - L0 at top, L4 at bottom
 * - Within each layer, nodes sorted by weight descending
 * - Children positioned under parent (via parent_entity_id chains)
 *
 * Phase B will replace this with a persistence-aware layout that remembers
 * user-moved positions.
 */
function computeLayout(
  entities: Entity[],
  classifications: Map<string, TierClassification>,
): NodePlacement[] {
  if (entities.length === 0) return [];

  const COL_GAP = 28;
  const ROW_GAP = 80;
  const LAYER_BAND_HEIGHT = 280;
  const LAYER_MARGIN_TOP = 60;
  const CANVAS_MARGIN_X = 80;

  // Group entities by layer
  const byLayer = new Map<LayerId, Entity[]>();
  for (const id of LAYER_ORDER) byLayer.set(id, []);
  for (const e of entities) {
    const layer = entityToLayerId(e);
    byLayer.get(layer)!.push(e);
  }

  // Sort each layer by weight desc (heroes front-and-center)
  for (const [layer, layerEntities] of byLayer) {
    layerEntities.sort((a, b) => {
      const wa = classifications.get(a.id)?.weight ?? 0;
      const wb = classifications.get(b.id)?.weight ?? 0;
      return wb - wa;
    });
  }

  // Position each layer in its own horizontal band.
  // Within a band, flow left-to-right, wrapping if needed.
  const placements: NodePlacement[] = [];
  const MAX_ROW_WIDTH = 2400; // approximate viewport budget before wrapping

  let currentY = LAYER_MARGIN_TOP;

  for (const layerId of LAYER_ORDER) {
    const layerEntities = byLayer.get(layerId) ?? [];
    if (layerEntities.length === 0) continue;

    // Pack nodes into rows within this layer band
    let rowX = CANVAS_MARGIN_X;
    let rowY = currentY;
    let rowMaxHeight = 0;
    let rowsInLayer = 1;

    for (const entity of layerEntities) {
      const cls = classifications.get(entity.id);
      if (!cls) continue;
      const width = TIER_WIDTH_MAP[cls.tier] ?? 220;
      const height = TIER_HEIGHT_ESTIMATE[cls.tier] ?? 110;

      // Start a new row if current row would overflow.
      if (rowX + width > CANVAS_MARGIN_X + MAX_ROW_WIDTH) {
        rowX = CANVAS_MARGIN_X;
        rowY += rowMaxHeight + COL_GAP;
        rowMaxHeight = 0;
        rowsInLayer++;
      }

      placements.push({
        entity,
        tier: cls.tier,
        weight: cls.weight,
        layer: layerId,
        x: rowX,
        y: rowY,
        width,
        height,
      });

      rowX += width + COL_GAP;
      rowMaxHeight = Math.max(rowMaxHeight, height);
    }

    // Advance to next layer, leaving room for the last row of this one.
    currentY = rowY + rowMaxHeight + ROW_GAP;
  }

  return placements;
}

// ── Props ──

export interface WhiteboardCanvasProps {
  spaceId: string;
  entities: Entity[];
  edges: Edge[];
  onNodeClick?: (entity: Entity) => void;
  onDecompose?: (entity: Entity, depthLevel?: number) => void;
  selectedEntityId?: string | null;
  /** Entity IDs that were just spawned — used for CSS spawn animation. */
  spawningEntityIds?: Set<string>;
  /** Parent-owned position overrides — takes priority over the internal layout engine. */
  positionOverrides?: Map<string, { x: number; y: number }>;
  /**
   * Reasoning overlays — optional. When provided, nodes that ground axioms or
   * have been expanded get visual rings/badges. Keyed by entity.entity_id
   * (display ID like "C5"), not UUID.
   */
  axiomGroundingByEntityId?: Map<string, {
    count: number;
    highest_visibility: "HIDDEN" | "IMPLICIT" | "EXPLICIT";
    highest_load_bearing: "critical" | "important" | "moderate";
  }>;
  /** Expansion state per entity UUID — depth + sub-component count. */
  expansionByEntityUuid?: Map<string, { depth: number; subComponentCount: number }>;
  /** Called when user finishes dragging a node. Parent persists to DB. */
  onNodeMoved?: (entityId: string, x: number, y: number) => void;
  /** Called when user resets all manual positions. */
  onResetPositions?: () => void;
  /** Expose current node rects (post-layout) so parent can use them for decompose overlap calcs. */
  onPlacementsChanged?: (placements: Array<{ entity_id: string; x: number; y: number; width: number; height: number }>) => void;
  /** Accept a predicted edge (playground-materialize output). If provided, affordance appears on predicted edges. */
  onAcceptPredictedEdge?: (edgeId: string) => Promise<void>;
  /** Reject a predicted edge. */
  onRejectPredictedEdge?: (edgeId: string) => Promise<void>;
  className?: string;
}

// ── Main component ──

export function WhiteboardCanvas({
  spaceId,
  entities,
  edges,
  onNodeClick,
  onDecompose,
  selectedEntityId,
  spawningEntityIds,
  positionOverrides,
  onNodeMoved,
  onResetPositions,
  onPlacementsChanged,
  onAcceptPredictedEdge,
  onRejectPredictedEdge,
  axiomGroundingByEntityId,
  expansionByEntityUuid,
  className,
}: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const { transform, zoomIn, zoomOut, reset, noTransition } = useCanvasTransform(canvasRef);

  // ── Classify all entities ──
  const classifications = useMemo(() => classifyAll(entities, edges), [entities, edges]);

  // ── Detect convergence nodes ──
  const convergenceIds = useMemo(() => detectConvergenceNodes(edges), [edges]);

  // ── Fetch latest cascade report ──
  const cascadeData = useCascadeReport(spaceId);

  // Build UUID-keyed map of pressure-point seed counts. The cascade report
  // stores display ids (e.g. "C3"); the canvas works with DB UUIDs.
  const pressureByUuid = useMemo(() => {
    const m = new Map<string, number>();
    if (cascadeData.pressurePoints.size === 0) return m;
    for (const e of entities) {
      const hits = cascadeData.pressurePoints.get(e.entity_id);
      if (hits) m.set(e.id, hits);
    }
    return m;
  }, [entities, cascadeData.pressurePoints]);

  // ── Compute default layout ──
  const defaultPlacements = useMemo(() => computeLayout(entities, classifications), [entities, classifications]);

  // ── Apply position overrides: override > default ──
  const placements = useMemo(() => {
    return defaultPlacements.map((p) => {
      const override = positionOverrides?.get(p.entity.id);
      if (override) {
        return { ...p, x: override.x, y: override.y };
      }
      return p;
    });
  }, [defaultPlacements, positionOverrides]);

  // Publish current rects back to parent for overlap calcs
  useEffect(() => {
    if (!onPlacementsChanged) return;
    onPlacementsChanged(
      placements.map((p) => ({
        entity_id: p.entity.id,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
      })),
    );
  }, [placements, onPlacementsChanged]);

  const placementById = useMemo(() => {
    const m = new Map<string, NodePlacement>();
    for (const p of placements) m.set(p.entity.id, p);
    return m;
  }, [placements]);

  // ── Local drag state ──
  const [draggingPosition, setDraggingPosition] = useState<{ entity_id: string; x: number; y: number } | null>(null);

  const onDragStart = useNodeDrag({
    getScale: () => transform.scale,
    onMove: (entity_id, x, y) => {
      setDraggingPosition({ entity_id, x, y });
    },
    onEnd: (entity_id, x, y) => {
      onNodeMoved?.(entity_id, x, y);
      setDraggingPosition(null);
    },
  });

  // ── Compute cluster zones ──
  const clusterZones = useMemo((): ClusterZoneData[] => {
    const byLayer = new Map<LayerId, Array<{ x: number; y: number; width: number; height: number }>>();
    for (const p of placements) {
      if (!byLayer.has(p.layer)) byLayer.set(p.layer, []);
      byLayer.get(p.layer)!.push({ x: p.x, y: p.y, width: p.width, height: p.height });
    }
    return computeClusterZones(byLayer as Map<string, typeof byLayer extends Map<string, infer V> ? V : never>, LAYERS);
  }, [placements]);

  // ── Prepare edge render data ──
  const edgeRenderData = useMemo((): WhiteboardEdgeRenderData[] => {
    const result: WhiteboardEdgeRenderData[] = [];
    for (const edge of edges) {
      const src = placementById.get(edge.source_entity_id);
      const tgt = placementById.get(edge.target_entity_id);
      if (!src || !tgt) continue;

      // Edge endpoints: center-bottom of source → center-top of target
      const sourceX = src.x + src.width / 2;
      const sourceY = src.y + src.height;
      const targetX = tgt.x + tgt.width / 2;
      const targetY = tgt.y;

      const srcLayerIdx = LAYER_ORDER.indexOf(src.layer);
      const tgtLayerIdx = LAYER_ORDER.indexOf(tgt.layer);
      const layerGap = Math.abs(srcLayerIdx - tgtLayerIdx);

      result.push({
        edge,
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourceWeight: src.weight,
        targetWeight: tgt.weight,
        sourceLayer: LAYERS[src.layer],
        targetLayer: LAYERS[tgt.layer],
        layerGap,
      });
    }
    return result;
  }, [edges, placementById]);

  // ── Compute overall canvas dimensions ──
  const { canvasWidth, canvasHeight } = useMemo(() => {
    if (placements.length === 0) return { canvasWidth: 1200, canvasHeight: 800 };
    let maxX = 0;
    let maxY = 0;
    for (const p of placements) {
      maxX = Math.max(maxX, p.x + p.width);
      maxY = Math.max(maxY, p.y + p.height);
    }
    return { canvasWidth: maxX + 200, canvasHeight: maxY + 200 };
  }, [placements]);

  // ── Fit-to-screen on first load ──
  const [hasAutoFit, setHasAutoFit] = useState(false);
  useEffect(() => {
    if (hasAutoFit || placements.length === 0 || !canvasRef.current) return;
    // Let the initial transform apply naturally, then reset to center/fit.
    setHasAutoFit(true);
  }, [hasAutoFit, placements.length]);

  // ── Legend counts by tier ──
  const tierCounts = useMemo(() => {
    const counts = { hero: 0, key: 0, support: 0, peripheral: 0 };
    for (const p of placements) counts[p.tier]++;
    return counts;
  }, [placements]);

  return (
    <div className={cn("relative w-full h-full overflow-hidden bg-slate-50", className)}>
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(1200px 800px at 50% 40%, #f5f8fc 0%, #eaeff5 50%, #e0e7f0 100%)",
          zIndex: 0,
        }}
      />

      {/* Grid dots */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(10,30,80,0.05) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          zIndex: 0,
        }}
      />

      {/* Pannable canvas */}
      <div
        ref={canvasRef}
        className="relative w-full h-full"
        style={{ cursor: "grab" }}
      >
        <div
          className="absolute origin-top-left"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transition: noTransition ? "none" : "transform 0.2s ease-out",
          }}
        >
          {/* Cluster zones (z-index 0) */}
          {clusterZones.map((z) => (
            <WhiteboardClusterZone key={`cz-${z.layerId}`} zone={z} />
          ))}

          {/* Edges layer */}
          <svg
            className="absolute top-0 left-0 pointer-events-none"
            style={{ width: canvasWidth, height: canvasHeight, zIndex: 2 }}
          >
            {edgeRenderData.map((data) => (
              <WhiteboardEdge key={`e-${data.edge.id}`} data={data} />
            ))}
          </svg>

          {/* Predicted-edge affordances (HTML layer over edges, interactive) */}
          {onAcceptPredictedEdge && onRejectPredictedEdge && (
            <>
              {edgeRenderData
                .filter((d) => d.edge.source_tag === "predicted")
                .map((d) => {
                  const midX = (d.sourceX + d.targetX) / 2;
                  const midY = (d.sourceY + d.targetY) / 2;
                  return (
                    <PredictedEdgeAffordance
                      key={`pred-${d.edge.id}`}
                      edgeId={d.edge.id}
                      x={midX}
                      y={midY}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      reasoning={(d.edge as any).conditions ?? null}
                      confidence={d.edge.confidence}
                      alwaysVisible
                      onAccept={onAcceptPredictedEdge}
                      onReject={onRejectPredictedEdge}
                    />
                  );
                })}
            </>
          )}

          {/* Nodes layer */}
          {placements.map((p) => {
            // Live drag override: if this is the entity being dragged, use
            // the drag position instead of the stored one.
            const isBeingDragged = draggingPosition?.entity_id === p.entity.id;
            const nx = isBeingDragged ? draggingPosition!.x : p.x;
            const ny = isBeingDragged ? draggingPosition!.y : p.y;
            const isSpawning = spawningEntityIds?.has(p.entity.id) ?? false;
            return (
              <WhiteboardNode
                key={`n-${p.entity.id}`}
                entity={p.entity}
                tier={p.tier}
                weight={p.weight}
                layer={LAYERS[p.layer]}
                isConvergence={convergenceIds.has(p.entity.id)}
                pressureSeeds={pressureByUuid.get(p.entity.id) ?? null}
                axiomGrounding={axiomGroundingByEntityId?.get(p.entity.entity_id) ?? null}
                expansionInfo={expansionByEntityUuid?.get(p.entity.id) ?? null}
                x={nx}
                y={ny}
                selected={selectedEntityId === p.entity.id}
                onClick={onNodeClick}
                onDecompose={onDecompose}
                onPointerDown={(e) => onDragStart(e, p.entity.id, nx, ny)}
                spawning={isSpawning}
                dragging={isBeingDragged}
              />
            );
          })}
        </div>
      </div>

      {/* Zoom controls (bottom-right) */}
      <div className="absolute right-3 bottom-3 flex gap-1 z-30" data-no-pan>
        <button
          onClick={zoomOut}
          className="w-8 h-8 rounded-lg bg-white/70 backdrop-blur-md border border-white/80 grid place-items-center text-gray-600 hover:bg-white/95 hover:text-gray-900 transition-colors shadow-sm"
          title="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="h-8 px-2 grid place-items-center text-[11px] font-semibold text-gray-600 bg-white/70 backdrop-blur-md border border-white/80 rounded-lg min-w-[48px]">
          {Math.round(transform.scale * 100)}%
        </div>
        <button
          onClick={zoomIn}
          className="w-8 h-8 rounded-lg bg-white/70 backdrop-blur-md border border-white/80 grid place-items-center text-gray-600 hover:bg-white/95 hover:text-gray-900 transition-colors shadow-sm"
          title="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          onClick={reset}
          className="w-8 h-8 rounded-lg bg-white/70 backdrop-blur-md border border-white/80 grid place-items-center text-gray-600 hover:bg-white/95 hover:text-gray-900 transition-colors shadow-sm"
          title="Fit to screen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {onResetPositions && (
          <button
            onClick={() => {
              if (window.confirm("Reset all manual positions to auto-layout? This cannot be undone.")) {
                onResetPositions();
              }
            }}
            className="w-8 h-8 rounded-lg bg-white/70 backdrop-blur-md border border-white/80 grid place-items-center text-gray-500 hover:bg-white/95 hover:text-rose-600 transition-colors shadow-sm"
            title="Reset manual positions to auto-layout"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Legend — tier breakdown (top-right) */}
      <div
        className="absolute top-3 right-3 bg-white/65 backdrop-blur-md border border-white/80 rounded-lg px-3 py-2 z-30 shadow-sm"
        data-no-pan
      >
        <div className="text-[8px] font-bold uppercase tracking-widest text-gray-500 mb-1">
          Tier distribution
        </div>
        <div className="space-y-0.5 text-[10px] font-medium text-gray-800">
          <LegendRow label="Hero" count={tierCounts.hero} color="linear-gradient(90deg, #0d1f5a, #2d7cff)" />
          <LegendRow label="Key" count={tierCounts.key} color="#1a7aff" />
          <LegendRow label="Support" count={tierCounts.support} color="#8592a8" />
          <LegendRow label="Peripheral" count={tierCounts.peripheral} color="#d1d5db" />
        </div>

        {/* Cascade summary — only renders once a cascade report exists */}
        {cascadeData.report && (
          <>
            <div className="mt-2 pt-2 border-t border-gray-200/70">
              <div className="text-[8px] font-bold uppercase tracking-widest text-amber-700 mb-1">
                Cascade reach
              </div>
              <div className="space-y-0.5 text-[10px] font-medium text-gray-800">
                <LegendRow
                  label="Pressure pts"
                  count={cascadeData.pressurePoints.size}
                  color="#fb923c"
                />
                <LegendRow
                  label="Affected"
                  count={cascadeData.totalAffected}
                  color="#fcd34d"
                />
                <LegendRow
                  label="Seeds"
                  count={cascadeData.report.seeds_analyzed}
                  color="#ef4444"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LegendRow({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
      <span>{label}</span>
      <span className="ml-auto text-[9px] font-mono text-gray-400">{count}</span>
    </div>
  );
}

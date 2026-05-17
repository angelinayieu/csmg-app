"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Layers, Eye, EyeOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  nodeColors,
  edgeDimensionStyles,
  graphOverlays,
  getNodeColor,
  getEdgeDimensionStyle,
} from "@/lib/design-tokens";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import { cleanEntityName } from "@/components/intelligence/orbital-graph";
import { useResolvedLayers } from "@/lib/hooks/use-resolved-layers";

// ── Props ──

interface MultiLayerGraphProps {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  synthesisData: SynthesisData | null;
  onEntityClick?: (entity: Entity) => void;
  /**
   * When provided, the component fetches the space's resolved layer
   * ontology (via /api/spaces/[id]/layer-ontology/resolved) and uses
   * the ontology's first three layer labels + colors for the band
   * headers instead of the hardcoded "Data / Relationships /
   * Organizing Principles" trio. Bucketing logic (which entity lands
   * in which band) stays category-driven for this first pass — a
   * future ticket will lift the full N-band layout to match the
   * ontology's cardinality.
   *
   * Optional and backward-compatible: when omitted, the component
   * renders exactly as before. Callers that already pass spaceId
   * unlock the adaptive labels without changing any other prop.
   */
  spaceId?: string;
}

// ── Constants ──

const LAYER_PADDING = 50;
const PERSPECTIVE_ANGLE = 38; // degrees — less extreme than 55

// Default band labels used when no ontology resolves. Kept as the
// historical "Data / Relationships / Organizing Principles" so spaces
// without a layer_ontology see no UI change.
const DEFAULT_LAYER_META = [
  { key: "data", label: "Data", color: "#E5E7EB", accent: "#9CA3AF" },
  { key: "relationships", label: "Relationships", color: "#D1FAE5", accent: "#10B981" },
  { key: "principles", label: "Organizing Principles", color: "#EDE9FE", accent: "#8B5CF6" },
] as const;

/** Convert a hex color into a soft pastel background by stepping it
 *  toward white. Used to derive a band-background tint from the
 *  ontology layer's accent color when one is present. */
function softenForBand(hex: string): string {
  // Naive lift-to-white: parse hex, blend 80% toward white. Works for
  // both 3-digit and 6-digit hex. Falls through to the input string
  // when parsing fails (so CSS color names / vars pass unchanged).
  const m = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return hex;
  const raw = m[1].length === 3
    ? m[1].split("").map((c) => c + c).join("")
    : m[1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const lift = (c: number) => Math.round(c + (255 - c) * 0.8);
  return `#${[lift(r), lift(g), lift(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

type EntityCategory = Entity["entity_category"];
const DATA_CATS: EntityCategory[] = ["concrete", "abstract", "epistemic"];
const REL_CATS: EntityCategory[] = ["process", "relational"];
const EDGE_DIMS = new Set(["causal", "functional", "agentive", "temporal"]);

// ── Node position type ──

interface NodePos {
  x: number;
  y: number;
  layer: number;
}

// ── Layout: arrange entities per layer in a grid ──

function layoutEntities(
  entities: Entity[],
  synthesisData: SynthesisData | null,
  width: number,
  height: number,
): Map<string, NodePos> {
  const positions = new Map<string, NodePos>();

  // Build set of principle-layer entity IDs (by UUID)
  const principleIds = new Set<string>();
  if (synthesisData) {
    for (const lp of synthesisData.leverage_points ?? []) principleIds.add(lp.entity_id);
    for (const rp of synthesisData.risk_points ?? []) principleIds.add(rp.entity_id);
    if (synthesisData.master_bottleneck) principleIds.add(synthesisData.master_bottleneck.entity_id);
  }
  for (const e of entities) {
    if (e.is_leverage_point || e.is_risk_point || e.is_master_bottleneck) {
      // Add both id and entity_id since synthesis data may use either
      principleIds.add(e.id);
      principleIds.add(e.entity_id);
    }
  }

  // Sort entities into layers
  const buckets: Entity[][] = [[], [], []];
  for (const e of entities) {
    if (e.knowledge_layer === "external") continue; // skip external entities
    if (principleIds.has(e.id) || principleIds.has(e.entity_id)) {
      buckets[2].push(e);
    } else if (REL_CATS.includes(e.entity_category)) {
      buckets[1].push(e);
    } else {
      buckets[0].push(e);
    }
  }

  // If a layer is empty, that's fine — it just won't render nodes

  const padX = LAYER_PADDING;
  const padY = LAYER_PADDING;
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;

  for (let li = 0; li < 3; li++) {
    const bucket = buckets[li];
    if (bucket.length === 0) continue;

    const cols = Math.max(1, Math.ceil(Math.sqrt(bucket.length * 1.5)));
    const rows = Math.max(1, Math.ceil(bucket.length / cols));
    const cellW = usableW / cols;
    const cellH = usableH / rows;

    // Sort by importance for consistent positioning
    bucket.sort((a, b) => {
      const imp: Record<string, number> = { fundamental: 0, critical: 1, important: 2, moderate: 3 };
      return (imp[a.importance ?? "moderate"] ?? 3) - (imp[b.importance ?? "moderate"] ?? 3);
    });

    bucket.forEach((e, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      // Use BOTH id and entity_id as keys so edge lookups work with either
      const pos = {
        x: padX + col * cellW + cellW / 2,
        y: padY + row * cellH + cellH / 2,
        layer: li,
      };
      positions.set(e.id, pos); // UUID — what edges reference
      positions.set(e.entity_id, pos); // entity_id — for display lookups
    });
  }

  return positions;
}

// ── Main Component ──

export function MultiLayerGraph({
  entities,
  edges,
  cycles,
  synthesisData,
  onEntityClick,
  spaceId,
}: MultiLayerGraphProps) {
  // E1 — adaptive band labels. When spaceId is provided AND a per-space
  // layer ontology is configured, use its first three layers' labels +
  // accents for the band headers; otherwise fall back to the historical
  // "Data / Relationships / Organizing Principles" trio so spaces
  // without an ontology render unchanged.
  const resolved = useResolvedLayers(spaceId ?? null);
  const layerMeta = useMemo(() => {
    if (!resolved.ontologyPresent || resolved.layers.length === 0) {
      return DEFAULT_LAYER_META;
    }
    // Sample the first three ontology layers by ordinal — bucketing
    // logic is still 3-band by category for this pass, so we only need
    // three labels. The full N-band layout is a future ticket.
    const sample = resolved.layers.slice(0, 3);
    // Pad with defaults if the ontology has fewer than three layers,
    // so the JSX consumers below still see a length-3 array.
    const padded = [
      sample[0] ?? null,
      sample[1] ?? null,
      sample[2] ?? null,
    ];
    return padded.map((l, idx) => {
      if (!l) return DEFAULT_LAYER_META[idx];
      return {
        key: l.id,
        label: l.label,
        color: softenForBand(l.color),
        accent: l.color,
      };
    }) as typeof DEFAULT_LAYER_META;
  }, [resolved.ontologyPresent, resolved.layers]);

  // Container sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(700);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const layerWidth = Math.max(400, containerWidth - 32);
  const layerHeight = Math.max(220, Math.min(350, layerWidth * 0.5));

  // State
  const [hoveredLayer, setHoveredLayer] = useState<number | null>(null);
  const [focusedLayer, setFocusedLayer] = useState<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [layerVisibility, setLayerVisibility] = useState([true, true, true]);

  // Layout
  const positions = useMemo(
    () => layoutEntities(entities, synthesisData, layerWidth, layerHeight),
    [entities, synthesisData, layerWidth, layerHeight]
  );

  // Entity lookup by UUID
  const entityById = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const e of entities) {
      m.set(e.id, e);
      m.set(e.entity_id, e);
    }
    return m;
  }, [entities]);

  // Classify entities by layer
  const layerEntities = useMemo(() => {
    const buckets: Entity[][] = [[], [], []];
    for (const e of entities) {
      if (e.knowledge_layer === "external") continue;
      const pos = positions.get(e.id);
      if (pos) buckets[pos.layer].push(e);
    }
    return buckets;
  }, [entities, positions]);

  // Edges filtered to relevant dimensions
  const visibleEdges = useMemo(
    () => edges.filter((e) => EDGE_DIMS.has(e.dimension) && e.knowledge_layer !== "external"),
    [edges]
  );

  // Neighbor set for hovered node
  const hoveredNeighbours = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>();
    const s = new Set<string>([hoveredNodeId]);
    for (const e of edges) {
      if (e.source_entity_id === hoveredNodeId) s.add(e.target_entity_id);
      if (e.target_entity_id === hoveredNodeId) s.add(e.source_entity_id);
    }
    return s;
  }, [hoveredNodeId, edges]);

  // Feedback loops mapped to entities
  const feedbackByEntity = useMemo(() => {
    const m = new Map<string, string>();
    if (!synthesisData?.feedback_loops) return m;
    for (const loop of synthesisData.feedback_loops) {
      const matchingCycle = cycles.find((c) => c.name === loop.name);
      if (matchingCycle) {
        for (const eid of matchingCycle.entity_ids as string[]) {
          if (!m.has(eid)) m.set(eid, loop.type);
        }
      }
    }
    return m;
  }, [synthesisData, cycles]);

  const toggleLayer = useCallback((idx: number) => {
    setLayerVisibility((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  }, []);

  const isNodeDimmed = useCallback(
    (entityId: string): boolean => {
      if (!hoveredNodeId) return false;
      return !hoveredNeighbours.has(entityId);
    },
    [hoveredNodeId, hoveredNeighbours]
  );

  // ── Compute transform for each layer ──

  const getLayerTransform = useCallback(
    (idx: number): React.CSSProperties => {
      const spacing = Math.min(100, layerHeight * 0.3);
      const baseZ = idx * spacing;
      const isVisible = layerVisibility[idx];
      const isFocused = focusedLayer === idx;
      const isOtherFocused = focusedLayer !== null && focusedLayer !== idx;
      const isHovered = hoveredLayer === idx;
      const isOtherHovered = hoveredLayer !== null && hoveredLayer !== idx;

      let scale = 1;
      let opacity = 1;
      let z = baseZ;

      if (isFocused) {
        scale = 1.04;
        z = spacing * 1.2;
        opacity = 1;
      } else if (isOtherFocused) {
        scale = 0.92;
        opacity = 0.3;
      } else if (isHovered) {
        scale = 1.02;
      } else if (isOtherHovered) {
        opacity = 0.55;
      }

      if (!isVisible) {
        opacity = 0;
        scale = 0.95;
      }

      return {
        transform: `rotateX(${PERSPECTIVE_ANGLE}deg) translateZ(${z}px) scale(${scale})`,
        transformStyle: "preserve-3d" as const,
        position: "absolute" as const,
        left: 0,
        right: 0,
        bottom: 0,
        opacity,
        transition: "transform 400ms cubic-bezier(0.22,1,0.36,1), opacity 300ms ease-out",
        pointerEvents: isVisible ? ("auto" as const) : ("none" as const),
        zIndex: isFocused ? 10 : idx,
      };
    },
    [layerVisibility, focusedLayer, hoveredLayer, layerHeight]
  );

  // ── Render a single layer plane ──

  const renderLayer = (layerIndex: number) => {
    const ents = layerEntities[layerIndex];
    const meta = layerMeta[layerIndex];

    // Edges: show edges where BOTH endpoints are on THIS layer
    const layerEdgeElements: React.ReactNode[] = [];
    for (const edge of visibleEdges) {
      const srcPos = positions.get(edge.source_entity_id);
      const tgtPos = positions.get(edge.target_entity_id);
      if (!srcPos || !tgtPos) continue;
      if (srcPos.layer !== layerIndex || tgtPos.layer !== layerIndex) continue;

      const dimmed =
        hoveredNodeId !== null &&
        edge.source_entity_id !== hoveredNodeId &&
        edge.target_entity_id !== hoveredNodeId;

      const style = getEdgeDimensionStyle(edge.dimension);
      layerEdgeElements.push(
        <line
          key={`e-${edge.id}`}
          x1={srcPos.x}
          y1={srcPos.y}
          x2={tgtPos.x}
          y2={tgtPos.y}
          stroke={style.color}
          strokeWidth={Math.max(1, style.width)}
          strokeDasharray={style.dash || undefined}
          strokeOpacity={dimmed ? 0.08 : 0.6}
          style={{ transition: "stroke-opacity 200ms" }}
        />
      );
    }

    // Cross-layer edges: show dashed lines to ghost dots
    const crossEdgeElements: React.ReactNode[] = [];
    const ghostDots: React.ReactNode[] = [];
    const seenGhosts = new Set<string>();

    for (const edge of visibleEdges) {
      const srcPos = positions.get(edge.source_entity_id);
      const tgtPos = positions.get(edge.target_entity_id);
      if (!srcPos || !tgtPos) continue;

      // One endpoint on this layer, other on different layer
      let localId: string | null = null;
      let remoteId: string | null = null;
      if (srcPos.layer === layerIndex && tgtPos.layer !== layerIndex) {
        localId = edge.source_entity_id;
        remoteId = edge.target_entity_id;
      } else if (tgtPos.layer === layerIndex && srcPos.layer !== layerIndex) {
        localId = edge.target_entity_id;
        remoteId = edge.source_entity_id;
      }
      if (!localId || !remoteId) continue;

      const localPos = positions.get(localId)!;
      const remotePos = positions.get(remoteId)!;

      // Draw ghost dot for remote entity (at its x,y on this plane)
      if (!seenGhosts.has(remoteId)) {
        seenGhosts.add(remoteId);
        ghostDots.push(
          <circle
            key={`ghost-${remoteId}`}
            cx={remotePos.x}
            cy={remotePos.y}
            r={4}
            fill="none"
            stroke="#C4B5FD"
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={hoveredNodeId ? (hoveredNeighbours.has(remoteId) ? 0.6 : 0.1) : 0.3}
          />
        );
      }

      // Draw faint dashed line from local node to ghost position
      const dimmed = hoveredNodeId !== null && !hoveredNeighbours.has(localId);
      crossEdgeElements.push(
        <line
          key={`cx-${edge.id}-${layerIndex}`}
          x1={localPos.x}
          y1={localPos.y}
          x2={remotePos.x}
          y2={remotePos.y}
          stroke="#C4B5FD"
          strokeWidth={0.8}
          strokeDasharray="3 3"
          strokeOpacity={dimmed ? 0.04 : 0.25}
          style={{ transition: "stroke-opacity 200ms" }}
        />
      );
    }

    // Node radii
    const baseR = layerIndex === 0 ? 8 : layerIndex === 1 ? 11 : 15;

    return (
      <svg
        width={layerWidth}
        height={layerHeight}
        viewBox={`0 0 ${layerWidth} ${layerHeight}`}
        className="block"
      >
        {/* Layer background plane */}
        <rect
          x={0}
          y={0}
          width={layerWidth}
          height={layerHeight}
          rx={14}
          fill={meta.color}
          fillOpacity={0.35}
          stroke={meta.accent}
          strokeWidth={1.5}
          strokeOpacity={0.25}
        />

        {/* Layer label */}
        <text
          x={18}
          y={24}
          fill={meta.accent}
          fontSize={11}
          fontWeight={700}
          letterSpacing="0.05em"
          style={{ textTransform: "uppercase", cursor: "pointer" }}
          onClick={() => setFocusedLayer((prev) => (prev === layerIndex ? null : layerIndex))}
        >
          {meta.label}
        </text>
        <text x={18} y={38} fill={meta.accent} fontSize={9} fontWeight={400} opacity={0.6}>
          {ents.length} {layerIndex === 0 ? "entities" : layerIndex === 1 ? "processes" : "findings"}
        </text>

        {/* Cross-layer ghost connections */}
        {crossEdgeElements}
        {ghostDots}

        {/* Same-layer edges */}
        {layerEdgeElements}

        {/* Nodes */}
        {ents.map((entity) => {
          const pos = positions.get(entity.id);
          if (!pos) return null;
          const isHov = hoveredNodeId === entity.id;
          const dimmed = isNodeDimmed(entity.id);
          const r = isHov ? baseR + 3 : baseR;
          const colors = getNodeColor(entity.entity_category);
          const isPrinciple = layerIndex === 2;

          // Truncate name
          const maxChars = layerIndex === 2 ? 16 : 12;
          const cleanName = cleanEntityName(entity);
          const label = cleanName.length > maxChars
            ? cleanName.slice(0, maxChars - 1) + "…"
            : cleanName;

          return (
            <g
              key={entity.id}
              className="cursor-pointer"
              style={{ opacity: dimmed ? 0.2 : 1, transition: "opacity 200ms" }}
              onMouseEnter={() => setHoveredNodeId(entity.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onClick={() => onEntityClick?.(entity)}
            >
              {/* Bottleneck ring */}
              {isPrinciple && entity.is_master_bottleneck && (
                <circle
                  cx={pos.x} cy={pos.y} r={r + 7}
                  fill="none"
                  stroke={graphOverlays.bottleneck.ring}
                  strokeWidth={3}
                />
              )}
              {/* Risk ring */}
              {isPrinciple && entity.is_risk_point && !entity.is_master_bottleneck && (
                <circle
                  cx={pos.x} cy={pos.y} r={r + 6}
                  fill="none"
                  stroke={graphOverlays.risk.ring}
                  strokeWidth={2}
                  strokeDasharray="3 2"
                />
              )}
              {/* Leverage ring */}
              {isPrinciple && entity.is_leverage_point && (
                <circle
                  cx={pos.x} cy={pos.y}
                  r={r + (entity.is_risk_point || entity.is_master_bottleneck ? 10 : 6)}
                  fill="none"
                  stroke={graphOverlays.leverage.ring}
                  strokeWidth={2}
                  strokeDasharray="3 2"
                />
              )}
              {/* Main circle */}
              <circle
                cx={pos.x} cy={pos.y} r={r}
                fill={colors.fill}
                stroke={colors.stroke}
                strokeWidth={isHov ? 2.5 : 1.5}
              />
              {/* Entity ID label (small, inside/near node) */}
              {layerIndex !== 0 && (
                <text
                  x={pos.x} y={pos.y + 3}
                  textAnchor="middle"
                  fontSize={7} fontWeight={700}
                  fill={colors.stroke}
                  style={{ pointerEvents: "none" }}
                >
                  {entity.entity_id}
                </text>
              )}
              {/* Name label */}
              <text
                x={pos.x} y={pos.y + r + 13}
                textAnchor="middle"
                fontSize={9.5} fontWeight={500}
                fill="#374151"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {label}
              </text>

              {/* Feedback loop badge */}
              {isPrinciple && feedbackByEntity.has(entity.id) && (
                <g>
                  <circle
                    cx={pos.x + r + 4} cy={pos.y - r - 2} r={6}
                    fill={
                      feedbackByEntity.get(entity.id) === "positive"
                        ? graphOverlays.cyclePositive
                        : feedbackByEntity.get(entity.id) === "negative"
                          ? graphOverlays.cycleNegative
                          : graphOverlays.cycleBalancing
                    }
                    opacity={0.9}
                  />
                  <text
                    x={pos.x + r + 4} y={pos.y - r + 1}
                    textAnchor="middle" fontSize={8} fontWeight={800} fill="#fff"
                    style={{ pointerEvents: "none" }}
                  >
                    {feedbackByEntity.get(entity.id) === "positive" ? "+" : feedbackByEntity.get(entity.id) === "negative" ? "−" : "~"}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  // ── Empty state ──

  if (entities.filter((e) => e.knowledge_layer !== "external").length < 3) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <Layers className="h-8 w-8 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">
          At least 3 internal entities needed for the multi-layer view.
        </p>
      </div>
    );
  }

  // ── Viewport height: enough to show 3 tilted layers ──

  const viewportHeight = layerHeight + 160;

  return (
    <div ref={containerRef} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <Layers className="h-4 w-4 text-indigo-500" />
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider flex-1">
          Knowledge Layers
        </h3>
        <div className="flex items-center gap-1.5">
          {layerMeta.map((meta, i) => (
            <button
              key={meta.key}
              onClick={() => toggleLayer(i)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors",
                layerVisibility[i]
                  ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  : "bg-transparent text-gray-400 hover:text-gray-500"
              )}
            >
              {layerVisibility[i] ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {meta.label}
            </button>
          ))}
          {focusedLayer !== null && (
            <button
              onClick={() => setFocusedLayer(null)}
              className="ml-1 p-1 rounded hover:bg-gray-100 text-gray-400"
              title="Reset focus"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 3D Viewport */}
      <div
        className="relative overflow-hidden"
        style={{
          height: viewportHeight,
          perspective: "1000px",
          perspectiveOrigin: "50% 30%",
        }}
        onMouseLeave={() => setHoveredLayer(null)}
      >
        {[0, 1, 2].map((li) => (
          <div
            key={li}
            style={getLayerTransform(li)}
            onMouseEnter={() => setHoveredLayer(li)}
          >
            {renderLayer(li)}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-t border-gray-100 bg-gray-50/50">
        {/* Node categories */}
        {(["concrete", "abstract", "epistemic", "process", "relational"] as const).map((cat) => (
          <span key={cat} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full border"
              style={{ backgroundColor: nodeColors[cat].fill, borderColor: nodeColors[cat].stroke }}
            />
            <span className="text-[9px] text-gray-500 capitalize">{cat}</span>
          </span>
        ))}
        <span className="h-3 w-px bg-gray-200" />
        {/* Overlays */}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ border: `2px solid ${graphOverlays.leverage.ring}` }} />
          <span className="text-[9px] text-gray-500">Leverage</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ border: `2px dashed ${graphOverlays.risk.ring}` }} />
          <span className="text-[9px] text-gray-500">Risk</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ border: `2.5px solid ${graphOverlays.bottleneck.ring}` }} />
          <span className="text-[9px] text-gray-500">Bottleneck</span>
        </span>
        <span className="h-3 w-px bg-gray-200" />
        {/* Edge types */}
        {(["causal", "functional", "temporal", "agentive"] as const).map((dim) => (
          <span key={dim} className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ backgroundColor: edgeDimensionStyles[dim].color }} />
            <span className="text-[9px] text-gray-500 capitalize">{dim}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

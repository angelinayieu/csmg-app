"use client";

// ── Root-cause tree shape ────────────────────────────────────────────
//
// Kaufman-style fan-in diagram. Goal(s) anchor the right edge; upstream
// drivers fan LEFTWARD in columns indexed by causal_depth. A node
// reached by multiple goal chains gets a ring + count badge. Root
// candidates (BFS leaves) get a highlighted outline.
//
// Why a composed SVG instead of a bag of tldraw shapes:
//   The fan-in gestalt ("three chains converge HERE") is legible only
//   when the geometry is rendered as one picture with the right
//   columnar math. Spawning individual tldraw shapes per driver would
//   duplicate the kg-node ghosts those drivers already own, and let
//   tldraw's autolayout drift the picture into illegibility. One
//   shape, one SVG, deterministic layout.
//
// Painted by pipeline-event-painter:
//   - `root_cause_identified` → create or update the tree with topRoots.
//   - `why_chain_deepened`    → update header counters only.
//
// Users can click any node inside the SVG. The click fires a CustomEvent
// on window ("root-cause-tree:focus") with the entityId — InteraxisCanvas
// listens and pans/zooms to the corresponding kg-node ghost. This keeps
// the shape self-contained (no prop callback plumbing) while still
// integrating with the canvas selection model.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useState } from "react";
import {
  GitBranch,
  Target,
  AlertCircle,
  Network,
  Loader2,
  Check,
} from "lucide-react";
import type { RootCauseTreeShape } from "./types";

// ── Node record shape (unpacked from nodesJson) ──────────────────────

export interface TreeNode {
  id: string;                 // entity UUID
  name: string;               // display name
  depth: number;              // hops from nearest goal (0 = goal itself)
  convergesCount: number;     // how many goal chains reach this node
  rootScore: number;          // 0..1
  isRoot: boolean;            // BFS leaf
  stopReason?: "external" | "user_controllable" | "continue" | "speculative";
  causeLevel?: 1 | 2 | 3;     // from why_chain drivers
}

export interface TreeEdge {
  source: string; // upstream entity id (driver)
  target: string; // downstream entity id (closer to goal)
}

// ── Layout constants ─────────────────────────────────────────────────

const PADDING = 20;
const HEADER_H = 58;
const COL_W = 170;            // horizontal distance between depth columns
const NODE_H = 36;
const NODE_W = 150;
const ROW_GAP = 10;
const MIN_W = 420;
const MIN_H = 260;

export class RootCauseTreeShapeUtil extends BaseBoxShapeUtil<RootCauseTreeShape> {
  static override type = "root-cause-tree" as const;
  static override props: RecordProps<RootCauseTreeShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    title: T.string,
    goalEntityIds: T.arrayOf(T.string),
    goalNames: T.arrayOf(T.string),
    nodesJson: T.string,
    edgesJson: T.string,
    reachableCount: T.number,
    convergencePoints: T.number,
    rootCandidates: T.number,
    driversTotal: T.number,
    userControllableCount: T.number,
    accent: T.string,
    version: T.number,
  };

  override getDefaultProps(): RootCauseTreeShape["props"] {
    return {
      w: 640,
      h: 400,
      spaceId: "",
      title: "Root-cause tree",
      goalEntityIds: [],
      goalNames: [],
      nodesJson: "[]",
      edgesJson: "[]",
      reachableCount: 0,
      convergencePoints: 0,
      rootCandidates: 0,
      driversTotal: 0,
      userControllableCount: 0,
      accent: "#7C3AED",
      version: 0,
    };
  }

  override canResize = () => true;
  override onResize = (shape: RootCauseTreeShape, info: TLResizeInfo<RootCauseTreeShape>) =>
    resizeBox(shape, info);

  override component(shape: RootCauseTreeShape) {
    const {
      w,
      h,
      spaceId,
      title,
      goalEntityIds,
      goalNames,
      nodesJson,
      edgesJson,
      reachableCount,
      convergencePoints,
      rootCandidates,
      driversTotal,
      userControllableCount,
      accent,
    } = shape.props;

    // ── Parse packed JSON safely (prop validation only checks string-ness) ──
    const nodes = safeParseNodes(nodesJson);
    const edges = safeParseEdges(edgesJson);

    // ── Build column layout: depth 0 = goals (right), depth N = deepest roots (left) ──
    //
    // Columns are keyed by depth; within a column we sort by root_score
    // descending so the "heaviest" roots sit near the top. Convergence
    // points always float to the top regardless of raw score because
    // their gestalt value is higher than a higher-scored solo chain.
    const columns = groupByDepth(nodes, goalEntityIds, goalNames);
    const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));

    // Compute shape's intrinsic content width/height. If the user
    // resized the shape smaller than the content needs, SVG will scroll
    // horizontally; we don't dynamically shrink column width because
    // that would reflow text layout mid-resize.
    const innerW = Math.max(MIN_W, w) - PADDING * 2;
    const innerH = Math.max(MIN_H, h) - PADDING * 2 - HEADER_H;

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
        }}
      >
        <div
          className="rct-enter"
          style={{
            width: "100%",
            height: "100%",
            background: "rgba(255, 255, 255, 0.97)",
            backdropFilter: "blur(12px) saturate(1.3)",
            WebkitBackdropFilter: "blur(12px) saturate(1.3)",
            border: `1px solid color-mix(in srgb, ${accent} 22%, rgba(15,23,42,0.08))`,
            borderRadius: 14,
            boxShadow: `0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -16px color-mix(in srgb, ${accent} 45%, transparent), inset 0 1px 0 0 rgba(255,255,255,0.85)`,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          {/* Top accent rail */}
          <div style={{ height: 3, background: accent, opacity: 0.9 }} />

          {/* Header: title + summary counters */}
          <div
            style={{
              padding: "10px 14px 8px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderBottom: "1px solid rgba(15,23,42,0.06)",
              flex: `0 0 ${HEADER_H - 3}px`,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: `color-mix(in srgb, ${accent} 14%, transparent)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <GitBranch size={12} color={accent} strokeWidth={1.9} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: accent,
                  lineHeight: 1.1,
                }}
              >
                Root-cause tree
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#0f172a",
                  lineHeight: 1.25,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
                title={title}
              >
                {title}
              </span>
            </div>
            {/* Counter chips: convergence pts, roots, drivers, user-controllable */}
            <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center" }}>
              <CounterChip label="reached" value={reachableCount} accent={accent} />
              <CounterChip label="converge" value={convergencePoints} accent={accent} emphasis />
              <CounterChip label="roots" value={rootCandidates} accent={accent} />
              {driversTotal > 0 && (
                <CounterChip label="drivers" value={driversTotal} accent={accent} />
              )}
              {userControllableCount > 0 && (
                <CounterChip
                  label="u-ctrl"
                  value={userControllableCount}
                  accent="#059669"
                  emphasis
                />
              )}
              {/* Phase 4 follow-on — promote the entire reachable
                  subtree to a saved system. Source-tagged as
                  `root_cause_subtree`. Useful for pinning "all
                  drivers reaching this goal" as one unit users can
                  experiment against in the lab. */}
              {spaceId && nodes.length > 0 && (
                <SaveTreeAsSystemButton
                  spaceId={spaceId}
                  nodeIds={nodes.map((n) => n.id)}
                  treeTitle={title}
                  rootCauseTreeId={null}
                />
              )}
            </div>
          </div>

          {/* Tree body */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: PADDING,
              background:
                "linear-gradient(180deg, rgba(248,250,252,0.4) 0%, rgba(255,255,255,0.1) 100%)",
            }}
          >
            {nodes.length === 0 ? (
              <EmptyState accent={accent} />
            ) : (
              <TreeSVG
                columns={columns}
                edges={edges}
                maxDepth={maxDepth}
                innerW={innerW}
                innerH={innerH}
                accent={accent}
              />
            )}
          </div>
        </div>
        <style jsx>{`
          .rct-enter {
            animation: rct-fade-in 520ms cubic-bezier(0.25, 0.8, 0.25, 1) both;
          }
          @keyframes rct-fade-in {
            from {
              opacity: 0;
              transform: scale(0.96) translateY(-4px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }
        `}</style>
      </HTMLContainer>
    );
  }

  override indicator(shape: RootCauseTreeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

// ── Safe JSON parse helpers ──────────────────────────────────────────
//
// Tldraw prop validation doesn't recurse into JSON-encoded strings, so
// we parse defensively. A malformed nodesJson should degrade to empty
// state, not crash the whole canvas.

function safeParseNodes(json: string): TreeNode[] {
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
      .map((n): TreeNode => {
        const stopReason: TreeNode["stopReason"] =
          n.stopReason === "external" ||
          n.stopReason === "user_controllable" ||
          n.stopReason === "continue" ||
          n.stopReason === "speculative"
            ? n.stopReason
            : undefined;
        const causeLevel: TreeNode["causeLevel"] =
          n.causeLevel === 1 || n.causeLevel === 2 || n.causeLevel === 3
            ? (n.causeLevel as 1 | 2 | 3)
            : undefined;
        return {
          id: typeof n.id === "string" ? n.id : "",
          name: typeof n.name === "string" ? n.name : "(unnamed)",
          depth: typeof n.depth === "number" ? n.depth : 0,
          convergesCount: typeof n.convergesCount === "number" ? n.convergesCount : 1,
          rootScore: typeof n.rootScore === "number" ? n.rootScore : 0,
          isRoot: Boolean(n.isRoot),
          stopReason,
          causeLevel,
        };
      })
      .filter((n) => n.id);
  } catch {
    return [];
  }
}

function safeParseEdges(json: string): TreeEdge[] {
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .map((e) => ({
        source: typeof e.source === "string" ? e.source : "",
        target: typeof e.target === "string" ? e.target : "",
      }))
      .filter((e) => e.source && e.target);
  } catch {
    return [];
  }
}

// ── Column grouping ──────────────────────────────────────────────────
//
// Depth 0 = goals. Depth N = upstream at N BFS hops. We inject the
// goal entries as depth-0 nodes so the rightmost column always shows
// the "Problem" labels and the user reads the tree right→left as
// "this → caused by → caused by ..." which matches the Kaufman layout.

interface Column {
  depth: number;
  nodes: TreeNode[];
}

function groupByDepth(
  nodes: TreeNode[],
  goalEntityIds: string[],
  goalNames: string[],
): Column[] {
  const map = new Map<number, TreeNode[]>();

  // Inject goals as depth-0 pseudo-nodes (they aren't in topRoots).
  goalEntityIds.forEach((gid, idx) => {
    const goal: TreeNode = {
      id: gid,
      name: goalNames[idx] ?? `Goal ${idx + 1}`,
      depth: 0,
      convergesCount: 1,
      rootScore: 1,
      isRoot: false,
    };
    const arr = map.get(0) ?? [];
    arr.push(goal);
    map.set(0, arr);
  });

  for (const n of nodes) {
    if (goalEntityIds.includes(n.id)) continue; // don't double-count goals
    const arr = map.get(n.depth) ?? [];
    arr.push(n);
    map.set(n.depth, arr);
  }

  // Sort within each column: convergence points first, then root_score desc.
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.convergesCount !== b.convergesCount)
        return b.convergesCount - a.convergesCount;
      return b.rootScore - a.rootScore;
    });
  }

  return Array.from(map.entries())
    .map(([depth, ns]) => ({ depth, nodes: ns }))
    .sort((a, b) => a.depth - b.depth);
}

// ── SVG tree ─────────────────────────────────────────────────────────

interface TreeSVGProps {
  columns: Column[];
  edges: TreeEdge[];
  maxDepth: number;
  innerW: number;
  innerH: number;
  accent: string;
}

function TreeSVG({ columns, edges, maxDepth, innerW, innerH, accent }: TreeSVGProps) {
  // Column layout: depth 0 (goals) pinned to RIGHT edge; higher depths
  // march leftward. This inverts BFS order visually but matches reading
  // direction for English-speakers (problem on the right, why?, why?).
  const colCount = maxDepth + 1;
  const contentW = Math.max(innerW, colCount * COL_W);
  const contentH = Math.max(
    innerH,
    Math.max(...columns.map((c) => c.nodes.length * (NODE_H + ROW_GAP))) + NODE_H,
  );

  const xForDepth = (depth: number) => {
    // depth=0 (goal) pinned to right side of contentW
    const rightX = contentW - NODE_W - 4;
    return rightX - depth * COL_W;
  };

  const nodePos = new Map<string, { x: number; y: number }>();
  for (const col of columns) {
    const count = col.nodes.length;
    const totalH = count * NODE_H + (count - 1) * ROW_GAP;
    const startY = Math.max(0, (contentH - totalH) / 2);
    col.nodes.forEach((n, idx) => {
      const x = xForDepth(col.depth);
      const y = startY + idx * (NODE_H + ROW_GAP);
      nodePos.set(n.id, { x, y });
    });
  }

  const onFocus = (entityId: string) => {
    try {
      window.dispatchEvent(
        new CustomEvent("root-cause-tree:focus", { detail: { entityId } }),
      );
    } catch {
      /* SSR or restricted context — no-op */
    }
  };

  return (
    <svg
      width={contentW}
      height={contentH}
      style={{ display: "block" }}
      // Stop pointer events from propagating to tldraw's select tool so
      // clicks inside the SVG don't start a drag on the outer shape.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Column headers — depth markers along the top */}
      {columns.map((col) => {
        const x = xForDepth(col.depth) + NODE_W / 2;
        const label = col.depth === 0 ? "Problem" : `Why? × ${col.depth}`;
        return (
          <text
            key={`hdr-${col.depth}`}
            x={x}
            y={14}
            textAnchor="middle"
            fontSize={9}
            fontWeight={700}
            letterSpacing="0.1em"
            fill={`color-mix(in srgb, ${accent} 70%, #475569)`}
            style={{ textTransform: "uppercase", fontFamily: "inherit" }}
          >
            {label}
          </text>
        );
      })}

      {/* Edges — drawn first so nodes paint on top. Upstream node
          connects into the right edge of the downstream node's anchor;
          bezier gives it the "cause flows into effect" visual. */}
      {edges.map((e, idx) => {
        const src = nodePos.get(e.source);
        const tgt = nodePos.get(e.target);
        if (!src || !tgt) return null;
        // source is the UPSTREAM driver (larger depth, leftward).
        // target is the DOWNSTREAM / goal (smaller depth, rightward).
        const sx = src.x + NODE_W;  // right edge of upstream
        const sy = src.y + NODE_H / 2;
        const tx = tgt.x;             // left edge of downstream
        const ty = tgt.y + NODE_H / 2;
        const midX = (sx + tx) / 2;
        return (
          <path
            key={`e-${idx}`}
            d={`M ${sx} ${sy} C ${midX} ${sy} ${midX} ${ty} ${tx} ${ty}`}
            fill="none"
            stroke={`color-mix(in srgb, ${accent} 35%, #cbd5e1)`}
            strokeWidth={1.4}
            strokeLinecap="round"
            opacity={0.85}
          />
        );
      })}

      {/* Nodes */}
      {columns.flatMap((col) =>
        col.nodes.map((n) => {
          const pos = nodePos.get(n.id);
          if (!pos) return null;
          const isGoal = col.depth === 0;
          const isConvergence = n.convergesCount >= 2;
          const isUserCtrl = n.stopReason === "user_controllable";
          const isExternal = n.stopReason === "external";

          const fill = isGoal
            ? `color-mix(in srgb, ${accent} 92%, white)`
            : n.isRoot
            ? `color-mix(in srgb, ${accent} 18%, white)`
            : "white";
          const strokeColor = isConvergence
            ? accent
            : n.isRoot
            ? `color-mix(in srgb, ${accent} 55%, #334155)`
            : `color-mix(in srgb, ${accent} 25%, #94a3b8)`;
          const strokeWidth = isConvergence ? 2.2 : n.isRoot ? 1.6 : 1;
          const textColor = isGoal ? "white" : "#0f172a";

          // Native SVG tooltip payload — browsers render this as a
          // hover overlay on the <g>. No extra React state, no layout
          // math, no z-order headaches with tldraw's shape overlays.
          // Content is terse because the browser tooltip can't style —
          // think of it as the "long name" on hover, not a detail card.
          const tooltipLines: string[] = [n.name];
          if (isGoal) {
            tooltipLines.push("• goal anchor");
          } else {
            if (n.causeLevel) {
              tooltipLines.push(
                `• cause-level ${n.causeLevel} (${
                  n.causeLevel === 1 ? "proximate" : n.causeLevel === 2 ? "intermediate" : "distal"
                })`,
              );
            }
            tooltipLines.push(`• depth ${n.depth} from nearest goal`);
            if (n.convergesCount > 0) {
              tooltipLines.push(
                `• converges ×${n.convergesCount} goal chain${n.convergesCount === 1 ? "" : "s"}`,
              );
            }
            if (n.stopReason === "user_controllable") {
              tooltipLines.push("• lever: user-controllable — inside your locus of action");
            } else if (n.stopReason === "external") {
              tooltipLines.push("• external — outside your locus of action");
            } else if (n.stopReason === "speculative") {
              tooltipLines.push("• speculative — driver inferred with low confidence");
            } else if (n.stopReason === "continue") {
              tooltipLines.push("• continue — deeper upstream drivers likely exist");
            }
            if (n.isRoot) tooltipLines.push("• root candidate (BFS leaf)");
            if (n.rootScore > 0) {
              tooltipLines.push(`• root_score ${n.rootScore.toFixed(2)}`);
            }
          }
          tooltipLines.push("(click to focus this entity on the canvas)");
          const tooltipText = tooltipLines.join("\n");

          return (
            <g
              key={n.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              style={{ cursor: "pointer" }}
              onClick={() => onFocus(n.id)}
            >
              {/* Native SVG tooltip — browsers render on hover. Terse
                  by design; full detail is deferred to the sidecar. */}
              <title>{tooltipText}</title>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                ry={8}
                fill={fill}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
              />
              {/* Convergence ring — extra halo around the rect */}
              {isConvergence && (
                <rect
                  width={NODE_W + 6}
                  height={NODE_H + 6}
                  x={-3}
                  y={-3}
                  rx={11}
                  ry={11}
                  fill="none"
                  stroke={accent}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.55}
                />
              )}
              {/* Text — clipped inner area so long names truncate visually */}
              <foreignObject x={8} y={4} width={NODE_W - 16} height={NODE_H - 8}>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    fontFamily: "inherit",
                    color: textColor,
                    pointerEvents: "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: isGoal ? 600 : 550,
                      lineHeight: 1.2,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                    title={n.name}
                  >
                    {n.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 1,
                      fontSize: 8.5,
                      fontWeight: 600,
                      color: isGoal ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.5)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {isGoal ? (
                      <>
                        <Target size={9} strokeWidth={2.2} /> goal
                      </>
                    ) : (
                      <>
                        {isConvergence && (
                          <span style={{ color: accent, fontWeight: 800 }}>
                            ×{n.convergesCount}
                          </span>
                        )}
                        {isUserCtrl && (
                          <span
                            style={{
                              color: "#059669",
                              fontWeight: 700,
                              letterSpacing: "0.05em",
                            }}
                          >
                            lever
                          </span>
                        )}
                        {isExternal && (
                          <AlertCircle size={9} strokeWidth={2.2} color="#dc2626" />
                        )}
                        {!isUserCtrl && !isExternal && n.rootScore > 0 && (
                          <span>{n.rootScore.toFixed(2)}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        }),
      )}
    </svg>
  );
}

// ── Counter chip in header ───────────────────────────────────────────

function CounterChip({
  label,
  value,
  accent,
  emphasis,
}: {
  label: string;
  value: number;
  accent: string;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        padding: "2px 7px",
        borderRadius: 5,
        background: emphasis
          ? `color-mix(in srgb, ${accent} 16%, transparent)`
          : "rgba(15,23,42,0.04)",
        border: emphasis
          ? `1px solid color-mix(in srgb, ${accent} 30%, transparent)`
          : "1px solid rgba(15,23,42,0.06)",
        display: "flex",
        alignItems: "baseline",
        gap: 4,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: emphasis ? accent : "#0f172a",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "rgba(15,23,42,0.5)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────

function EmptyState({ accent }: { accent: string }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        color: "rgba(15,23,42,0.5)",
      }}
    >
      <GitBranch size={20} color={accent} strokeWidth={1.5} />
      <div style={{ fontSize: 12, fontWeight: 500 }}>
        Tracing root causes…
      </div>
      <div style={{ fontSize: 10, opacity: 0.7 }}>
        Will populate as backward BFS reaches upstream drivers.
      </div>
    </div>
  );
}

// ── Phase 4 follow-on — promote whole subtree to a saved System ──
//
// The button POSTs the tree's full reachable entity set to
// /api/spaces/[id]/systems with source_kind=root_cause_subtree.
// Gives users a one-click way to pin "every driver that flows into
// these goals" as a coherent system they can experiment against
// in the lab. Server-side classification fills in is_open /
// is_probabilistic / is_complex automatically.

function SaveTreeAsSystemButton({
  spaceId,
  nodeIds,
  treeTitle,
  rootCauseTreeId,
}: {
  spaceId: string;
  nodeIds: string[];
  treeTitle: string;
  rootCauseTreeId: string | null;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  const onClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (state === "saving") return;
    setState("saving");
    try {
      const r = await fetch(`/api/spaces/${spaceId}/systems`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: treeTitle ? `Root-cause · ${treeTitle}` : "Root-cause subtree",
          description: `Backward BFS reaching ${nodeIds.length} entit${nodeIds.length === 1 ? "y" : "ies"} from the goal column.`,
          entity_ids: nodeIds,
          source_kind: "root_cause_subtree",
          source_ref_id: rootCauseTreeId,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      setState("saved");
      window.setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      console.warn("[root-cause-tree] save-as-system failed:", err);
      setState("error");
      window.setTimeout(() => setState("idle"), 2200);
    }
  };

  const label =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Failed"
          : "Save tree";
  const Icon =
    state === "saving"
      ? Loader2
      : state === "saved"
        ? Check
        : Network;
  const bg =
    state === "saved"
      ? "#ecfdf5"
      : state === "error"
        ? "#fef2f2"
        : "#eef2ff";
  const fg =
    state === "saved"
      ? "#047857"
      : state === "error"
        ? "#b91c1c"
        : "#4f46e5";
  const border =
    state === "saved"
      ? "#a7f3d0"
      : state === "error"
        ? "#fecaca"
        : "#c7d2fe";

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      disabled={state === "saving"}
      title={
        state === "saved"
          ? "Saved! Browse at /app/space/[id]/systems."
          : "Promote this entire reachable subtree to a saved System (lab-ready)."
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 7px",
        borderRadius: 4,
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        cursor: state === "saving" ? "wait" : "pointer",
      }}
    >
      <Icon
        size={10}
        strokeWidth={2.4}
        className={state === "saving" ? "rct-spin" : undefined}
      />
      {label}
      <style jsx>{`
        :global(.rct-spin) {
          animation: rct-spin 0.8s linear infinite;
        }
        @keyframes rct-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </button>
  );
}

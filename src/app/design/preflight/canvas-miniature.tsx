"use client";

// CanvasMiniature — schematic renderer for storyboard frames.
//
// Mirrors the actual canvas's spatial language:
//   • kg-node tier drives card size (hero 96×56, key 80×48, support 68×40, peripheral 56×32)
//   • Layer drives the left-edge color tag (L0..L4 from LAYERS config)
//   • isGhost = dashed border + reduced opacity (matches pipeline-event-painter)
//   • isCyclePart = subtle red ring (matches the cycle accent)
//   • isBottleneck / isLeverage = corner glyph (matches kg-node-shape badges)
//
// Edges are SVG paths drawn underneath the cards. Cycle edges use the
// reinforcing-loop accent color. Ghost edges are dashed.
//
// This is INTENTIONALLY schematic — not a pixel-perfect kg-node clone.
// Storyboard frames need to read as a glance ("there are 12 nodes,
// one cycle, a strategy hero floating top-left, a probe trail
// unfurling from this node") not as a stress test of the renderer.

import { LAYERS, type LayerId } from "@/lib/whiteboard/layer-config";
import { Zap, Focus, Sparkles, Brain, FileText } from "lucide-react";
import { TrailNode, TrailEdge, TrailBadge } from "@/components/canvas/probe-trail/primitives";
import {
  ModeAddIcon,
  ModeDecomposeIcon,
  ModeSolveIcon,
  ModeProbeIcon,
  LandscapeRoomIcon,
  ProposalRoomIcon,
  NorthStarIcon,
  CycleIcon,
  DivergeForkIcon,
  ConvergeMergeIcon,
} from "@/components/canvas/icons";
import type {
  FrameNode,
  FrameEdge,
  FrameProbeTrail,
  FrameStrategyHero,
  FrameSolveLandscape,
  FrameSolveProposal,
  PromptMode,
  Tier,
} from "./storyboard-data";

const TIER_DIMS: Record<Tier, { w: number; h: number }> = {
  hero: { w: 116, h: 64 },
  key: { w: 96, h: 54 },
  support: { w: 80, h: 44 },
  peripheral: { w: 64, h: 34 },
};

const TIER_FONT: Record<Tier, number> = {
  hero: 11.5,
  key: 10.5,
  support: 9.5,
  peripheral: 8.5,
};

interface CanvasMiniatureProps {
  width: number;
  height: number;
  showPromptInput?: boolean;
  promptText?: string;
  promptMode?: PromptMode;
  showStageBanner?: { stage: string; phase: "enter" | "exit" };
  originPrompt?: { x: number; y: number; text: string };
  nodes?: FrameNode[];
  edges?: FrameEdge[];
  cyclePolygons?: Array<{ nodeIds: string[] }>;
  strategyHero?: FrameStrategyHero;
  probeTrail?: FrameProbeTrail;
  solveLandscape?: FrameSolveLandscape;
  solveProposal?: FrameSolveProposal;
  /** When set, kg-node mini cards + their edges render at this opacity
   *  so foreground artifacts (Solve rooms) read clearly above. */
  backgroundOpacity?: number;
}

export function CanvasMiniature({
  width,
  height,
  showPromptInput,
  promptText,
  promptMode = "decompose",
  showStageBanner,
  originPrompt,
  nodes = [],
  edges = [],
  cyclePolygons,
  strategyHero,
  probeTrail,
  solveLandscape,
  solveProposal,
  backgroundOpacity = 1,
}: CanvasMiniatureProps) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  function center(id: string): { x: number; y: number } | null {
    const n = nodesById.get(id);
    if (!n) return null;
    const dims = TIER_DIMS[n.tier];
    return { x: n.x + dims.w / 2, y: n.y + dims.h / 2 };
  }

  // Probe trail anchor in canvas space (relative to source node center).
  const probeAnchor =
    probeTrail && probeTrail.fromNodeId
      ? center(probeTrail.fromNodeId)
      : null;

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 16,
        overflow: "hidden",
        background:
          "radial-gradient(circle at 30% 20%, #F8FAFF 0%, #F0F4FB 40%, #E9EEF8 100%)",
        border: "1px solid rgba(15,23,42,0.06)",
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.5), 0 1px 3px rgba(0,0,0,0.03)",
      }}
    >
      {/* Stage banner — top-center */}
      {showStageBanner && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(8,108,232,0.06)",
            border: "1px solid rgba(8,108,232,0.18)",
            color: "#086ce8",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          <span
            className="rail-streaming-breath"
            aria-hidden
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: "#086ce8",
              boxShadow: "0 0 4px #086ce8",
            }}
          />
          {showStageBanner.stage} · {showStageBanner.phase}
        </div>
      )}

      {/* Origin prompt sticky — anchors the entire run */}
      {originPrompt && (
        <div
          style={{
            position: "absolute",
            left: originPrompt.x,
            top: originPrompt.y,
            width: 150,
            padding: "8px 10px",
            borderRadius: 10,
            background: "rgba(255,247,200,0.95)",
            border: "1px solid rgba(218,165,32,0.4)",
            boxShadow: "0 4px 12px rgba(180,140,30,0.15)",
            transform: "rotate(-2deg)",
            fontSize: 9,
            lineHeight: 1.35,
            color: "#5b4914",
          }}
        >
          <div
            style={{
              fontSize: 7.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#a16207",
              marginBottom: 3,
            }}
          >
            Prompt
          </div>
          <div
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 5,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {originPrompt.text}
          </div>
        </div>
      )}

      {/* Background substrate (KG nodes + edges + cycles + strategy
          hero) — wrapped so Solve mode can recede them as a group. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: backgroundOpacity,
          transition: "opacity 360ms var(--ease-out-quart)",
          pointerEvents: backgroundOpacity < 0.5 ? "none" : "auto",
        }}
      >
        {/* Cycle polygon underlay — subtle red wash linking cycle members */}
        {cyclePolygons && cyclePolygons.length > 0 && (
          <svg
            width={width}
            height={height}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            {cyclePolygons.map((c, i) => {
              const pts = c.nodeIds.map(center).filter(Boolean) as Array<{ x: number; y: number }>;
              if (pts.length < 3) return null;
              const path =
                "M " +
                pts.map((p) => `${p.x},${p.y}`).join(" L ") +
                " Z";
              return (
                <path
                  key={i}
                  d={path}
                  fill="rgba(239,68,68,0.06)"
                  stroke="rgba(239,68,68,0.4)"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              );
            })}
          </svg>
        )}

        {/* Edges — under nodes */}
        <svg
          width={width}
          height={height}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {edges.map((e, i) => {
            const a = center(e.from);
            const b = center(e.to);
            if (!a || !b) return null;
            const stroke = e.isCycle
              ? "rgba(239,68,68,0.55)"
              : e.polarity === "negative"
                ? "rgba(239,68,68,0.35)"
                : e.polarity === "positive"
                  ? "rgba(34,197,94,0.35)"
                  : "rgba(85,100,121,0.35)";
            return (
              <path
                key={i}
                d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                fill="none"
                stroke={stroke}
                strokeWidth={e.isCycle ? 1.5 : 1}
                strokeLinecap="round"
                strokeDasharray={e.isGhost ? "3 3" : "0 0"}
                opacity={e.isGhost ? 0.7 : 1}
              />
            );
          })}
        </svg>

        {/* Strategy hero card — floats above the field */}
        {strategyHero && <StrategyHeroMini hero={strategyHero} />}

        {/* Nodes */}
        {nodes.map((n) => (
          <KGNodeMini key={n.id} node={n} />
        ))}
      </div>

      {/* Probe trail tether — visible connector from source kg-node card
          edge to the first probe node, so the user reads "this trail
          came out of THIS card." */}
      {probeTrail && probeTrail.sourceCardNodeId && (
        <ProbeTether
          source={center(probeTrail.sourceCardNodeId)}
          firstProbeNode={
            probeAnchor && probeTrail.nodes[0]
              ? {
                  x: probeAnchor.x + probeTrail.nodes[0].dx,
                  y: probeAnchor.y + probeTrail.nodes[0].dy,
                }
              : null
          }
        />
      )}

      {/* Probe trail overlay (positioned relative to its source node) */}
      {probeTrail && probeAnchor && (
        <ProbeTrailOverlay
          anchor={probeAnchor}
          trail={probeTrail}
        />
      )}

      {/* Solve mode — Landscape (diverge) + Proposal (converge) rooms */}
      {solveLandscape && <SolveLandscapeRoom data={solveLandscape} />}
      {solveProposal && <SolveProposalRoom data={solveProposal} />}

      {/* Prompt input — bottom-center, refined version with mode selector */}
      {showPromptInput && (
        <PromptInputMini
          text={promptText ?? ""}
          mode={promptMode}
        />
      )}
    </div>
  );
}

// ── Probe tether — visible link from source card edge to first probe node ─

function ProbeTether({
  source,
  firstProbeNode,
}: {
  source: { x: number; y: number } | null;
  firstProbeNode: { x: number; y: number } | null;
}) {
  if (!source || !firstProbeNode) return null;
  // Use a smooth bezier so the line reads as "extends from" rather than
  // "snaps to," matching the lab/probe aesthetic.
  const dx = firstProbeNode.x - source.x;
  const c1x = source.x + dx * 0.4;
  const c1y = source.y;
  const c2x = firstProbeNode.x - dx * 0.4;
  const c2y = firstProbeNode.y;
  return (
    <svg
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <path
        d={`M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${firstProbeNode.x} ${firstProbeNode.y}`}
        fill="none"
        stroke="rgba(8,108,232,0.45)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray="3 3"
      />
      {/* Origin pip — small filled dot at the source card edge */}
      <circle
        cx={source.x}
        cy={source.y}
        r={2.5}
        fill="rgba(8,108,232,0.85)"
      />
    </svg>
  );
}

// ── Solve room — Landscape (diverge) ───────────────────────────────

function SolveLandscapeRoom({ data }: { data: FrameSolveLandscape }) {
  return (
    <div
      style={{
        position: "absolute",
        left: data.x,
        top: data.y,
        width: data.w,
        height: data.h,
        borderRadius: 16,
        background:
          "linear-gradient(180deg, rgba(8,145,178,0.06) 0%, rgba(8,145,178,0.015) 100%)",
        border: "1px solid rgba(8,145,178,0.22)",
        backdropFilter: "blur(10px)",
        boxShadow:
          "0 18px 48px -16px rgba(8,145,178,0.18), inset 0 1px 0 rgba(255,255,255,0.5)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "#0e7490",
        }}
      >
        <DivergeForkIcon size={11} />
        <span
          style={{
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Landscape · diverge
        </span>
        <span style={{ flex: 1 }} />
        <LandscapeRoomIcon size={11} />
      </div>
      <div
        style={{
          fontSize: 9.5,
          color: "#0a1020",
          fontWeight: 600,
          lineHeight: 1.4,
          marginBottom: 2,
        }}
      >
        {data.query.length > 80
          ? data.query.slice(0, 78) + "…"
          : data.query}
      </div>
      <div style={{ display: "flex", gap: 4, flex: 1, minHeight: 0 }}>
        {data.axes.map((axis, i) => {
          const isScored = axis.state === "scored";
          return (
            <div
              key={i}
              style={{
                flex: 1,
                padding: "6px 7px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.7)",
                border: `1px solid ${isScored ? "rgba(8,145,178,0.25)" : "rgba(15,23,42,0.06)"}`,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                opacity: isScored ? 1 : 0.78,
              }}
            >
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#0e7490",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {isScored ? (
                  <span
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "#0e7490",
                    }}
                  />
                ) : (
                  <span
                    className="rail-streaming-breath"
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "#0e7490",
                    }}
                  />
                )}
                {axis.label}
              </div>
              <div
                style={{
                  fontSize: 8.5,
                  color: "#556479",
                  lineHeight: 1.3,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  flex: 1,
                }}
              >
                {axis.description}
              </div>
              {isScored && (
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#0e7490",
                    fontVariantNumeric: "tabular-nums",
                    fontFamily: '"SF Mono", ui-monospace, monospace',
                    marginTop: "auto",
                  }}
                >
                  {axis.score.toFixed(2)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Solve room — Proposal (converge) ───────────────────────────────

function SolveProposalRoom({ data }: { data: FrameSolveProposal }) {
  return (
    <div
      style={{
        position: "absolute",
        left: data.x,
        top: data.y,
        width: data.w,
        height: data.h,
        borderRadius: 16,
        background:
          "linear-gradient(180deg, rgba(217,119,6,0.06) 0%, rgba(217,119,6,0.015) 100%)",
        border: "1px solid rgba(217,119,6,0.22)",
        backdropFilter: "blur(10px)",
        boxShadow:
          "0 18px 48px -16px rgba(217,119,6,0.18), inset 0 1px 0 rgba(255,255,255,0.5)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "#a16207",
        }}
      >
        <ConvergeMergeIcon size={11} />
        <span
          style={{
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Proposal · converge
        </span>
        <span style={{ flex: 1 }} />
        <ProposalRoomIcon size={11} />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: 1,
          minHeight: 0,
        }}
      >
        {data.solutions.map((s) => (
          <div
            key={s.rank}
            style={{
              padding: "5px 8px",
              borderRadius: 8,
              background:
                s.rank === 1 ? "rgba(217,119,6,0.08)" : "rgba(255,255,255,0.7)",
              border: `1px solid ${s.rank === 1 ? "rgba(217,119,6,0.32)" : "rgba(15,23,42,0.06)"}`,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {s.rank === 1 && (
                <span style={{ color: "#a16207" }}>
                  <NorthStarIcon size={9} />
                </span>
              )}
              <span
                style={{
                  fontSize: 7.5,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "#a16207",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                #{s.rank}
              </span>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: "#0a1020",
                  flex: 1,
                  letterSpacing: "-0.005em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.title}
              </span>
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 700,
                  color: "#a16207",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round(s.confidence * 100)}%
              </span>
            </div>
            <div
              style={{
                fontSize: 8.5,
                color: "#556479",
                lineHeight: 1.35,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {s.summary}
            </div>
            <div
              style={{
                marginTop: 1,
                fontSize: 7.5,
                fontWeight: 600,
                color: "#86868B",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              from {s.drawnFrom.join(" + ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Mini kg-node card ───────────────────────────────────────────────

function KGNodeMini({ node }: { node: FrameNode }) {
  const dims = TIER_DIMS[node.tier];
  const layerCfg = LAYERS[node.layer as LayerId];
  const layerColor = layerCfg?.color ?? "#86868B";
  const isHero = node.tier === "hero";

  const Icon = node.isLeverage
    ? Zap
    : node.isBottleneck
      ? Focus
      : node.category === "process"
        ? Sparkles
        : node.category === "epistemic"
          ? Brain
          : null;

  return (
    <div
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: dims.w,
        height: dims.h,
        borderRadius: 8,
        background: node.isGhost
          ? "rgba(255,255,255,0.6)"
          : isHero
            ? `linear-gradient(135deg, ${layerColor}28 0%, ${layerColor}10 100%)`
            : "rgba(255,255,255,0.92)",
        backdropFilter: "blur(8px)",
        border: node.isGhost
          ? `1px dashed ${layerColor}80`
          : isHero
            ? `1.5px solid ${layerColor}`
            : `1px solid rgba(15,23,42,0.08)`,
        boxShadow: node.isGhost
          ? "none"
          : isHero
            ? `0 6px 18px -8px ${layerColor}66, 0 1px 2px rgba(8,30,80,0.04)`
            : "0 1px 3px rgba(0,0,0,0.04)",
        outline: node.isCyclePart ? `2px dashed rgba(239,68,68,0.4)` : undefined,
        outlineOffset: node.isCyclePart ? 2 : 0,
        opacity: node.isGhost ? 0.78 : 1,
        padding: "5px 7px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflow: "hidden",
        transition: "all 240ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span
          style={{
            fontSize: 7,
            fontWeight: 700,
            letterSpacing: "0.12em",
            padding: "1px 4px",
            borderRadius: 3,
            background: layerCfg?.bg ?? `${layerColor}14`,
            color: layerColor,
            border: `1px solid ${layerCfg?.border ?? layerColor + "33"}`,
            flexShrink: 0,
          }}
        >
          {layerCfg?.shortLabel ?? node.layer}
        </span>
        {Icon && (
          <Icon
            style={{
              width: 8,
              height: 8,
              color: node.isLeverage
                ? "#d97706"
                : node.isBottleneck
                  ? "#b42318"
                  : "#556479",
              flexShrink: 0,
            }}
          />
        )}
      </div>
      <div
        style={{
          fontSize: TIER_FONT[node.tier],
          fontWeight: 700,
          color: "#0a1020",
          lineHeight: 1.2,
          letterSpacing: "-0.01em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
        title={node.name}
      >
        {node.name}
      </div>
      {node.hasProbeTrail && (
        <div
          style={{
            position: "absolute",
            top: -10,
            right: 4,
            transform: "scale(0.8)",
            transformOrigin: "right top",
          }}
        >
          <TrailBadge
            label={node.trailLabel ?? "Probe"}
            resultCount={node.trailResultCount}
          />
        </div>
      )}
    </div>
  );
}

// ── Strategy hero mini ──────────────────────────────────────────────

function StrategyHeroMini({ hero }: { hero: FrameStrategyHero }) {
  return (
    <div
      style={{
        position: "absolute",
        left: hero.x,
        top: hero.y,
        width: 200,
        padding: "8px 10px",
        borderRadius: 10,
        background: "linear-gradient(135deg, rgba(8,108,232,0.06) 0%, rgba(8,108,232,0.02) 100%)",
        border: "1.5px solid rgba(8,108,232,0.4)",
        boxShadow: "0 8px 22px -8px rgba(8,108,232,0.32), 0 1px 2px rgba(8,30,80,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 3,
        }}
      >
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "#086ce8",
          }}
        >
          #{hero.rank} · STRATEGY
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 8.5,
            fontWeight: 700,
            color: "#086ce8",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(hero.confidence * 100)}%
        </span>
      </div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          color: "#0a1020",
          lineHeight: 1.25,
          letterSpacing: "-0.01em",
        }}
      >
        {hero.title}
      </div>
      <div
        style={{
          fontSize: 8.5,
          color: "#556479",
          lineHeight: 1.35,
          marginTop: 3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {hero.summary}
      </div>
    </div>
  );
}

// ── Probe trail overlay ─────────────────────────────────────────────

function ProbeTrailOverlay({
  anchor,
  trail,
}: {
  anchor: { x: number; y: number };
  trail: FrameProbeTrail;
}) {
  // Compute absolute trail node positions from anchor + dx/dy.
  type Pt = { id: string; x: number; y: number };
  const positions: Pt[] = trail.nodes.map((n) => ({
    id: n.id,
    x: anchor.x + n.dx,
    y: anchor.y + n.dy,
  }));
  const posById = new Map(positions.map((p) => [p.id, p]));
  // Each TrailNode is 56×40, we render with center=(x,y) so subtract half.
  const NW = 56, NH = 40;

  return (
    <>
      {/* Edges — SVG layer, full canvas size so paths match coords */}
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {trail.edges.map((e, i) => {
          const a = posById.get(e.from);
          const b = posById.get(e.to);
          if (!a || !b) return null;
          return (
            <TrailEdge
              key={i}
              from={{ x: a.x, y: a.y }}
              to={{ x: b.x, y: b.y }}
              phase={e.phase}
            />
          );
        })}
      </svg>
      {/* Nodes */}
      {trail.nodes.map((n) => {
        const p = posById.get(n.id)!;
        return (
          <TrailNode
            key={n.id}
            phase={n.phase}
            icon={n.icon}
            label={n.label}
            x={p.x - NW / 2}
            y={p.y - NH / 2}
          />
        );
      })}
    </>
  );
}

// ── Prompt input mini ───────────────────────────────────────────────

// Mode taxonomy:
//   Add       — single concept (calls /api/canvas/materialize, today's default)
//   Decompose — substrate-build: many entities + edges (calls /api/pipeline/decompose)
//   Solve     — use-the-graph to answer (re-fires Landscape → Proposal rooms)
//   Probe     — drill into ONE selected card (anchored, requires selection)
const MODES: Array<{
  id: PromptMode;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  enabled: (ctx: { hasKg: boolean; hasSelection: boolean }) => boolean;
  placeholder: string;
  cta: string;
}> = [
  {
    id: "add",
    label: "Add",
    icon: ModeAddIcon,
    enabled: () => true,
    placeholder: "Drop one concept onto canvas…",
    cta: "Add",
  },
  {
    id: "decompose",
    label: "Decompose",
    icon: ModeDecomposeIcon,
    enabled: () => true,
    placeholder: "Type a concept, paste a URL, or drop a file…",
    cta: "Decompose",
  },
  {
    id: "solve",
    label: "Solve",
    icon: ModeSolveIcon,
    enabled: ({ hasKg }) => hasKg,
    placeholder: "Ask a question — uses the existing graph…",
    cta: "Solve",
  },
  {
    id: "probe",
    label: "Probe",
    icon: ModeProbeIcon,
    enabled: ({ hasSelection }) => hasSelection,
    placeholder: "Probe the selected card with a question…",
    cta: "Probe",
  },
];

function PromptInputMini({
  text,
  mode = "decompose",
}: {
  text: string;
  mode?: PromptMode;
}) {
  // For storyboard purposes — derive enable state from the active mode:
  // if mode is "solve" we assume hasKg=true; if "probe" we assume
  // hasSelection=true. In production, those come from the canvas state.
  const ctx = {
    hasKg: mode === "solve" || mode === "decompose" || mode === "add",
    hasSelection: mode === "probe",
  };
  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[1];

  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 6px 5px 5px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.94)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(15,23,42,0.08)",
        boxShadow:
          "0 18px 48px -12px rgba(8,30,80,0.16), inset 0 1px 0 rgba(255,255,255,0.5)",
        minWidth: 460,
        maxWidth: 580,
      }}
    >
      {/* Mode segment — leading control. 4 chips, only one active. */}
      <div
        role="tablist"
        aria-label="Prompt mode"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0,
          padding: 2,
          borderRadius: 999,
          background: "rgba(8,30,80,0.04)",
        }}
      >
        {MODES.map((m) => {
          const isActive = m.id === mode;
          const isEnabled = m.enabled(ctx);
          const IconComp = m.icon;
          return (
            <span
              key={m.id}
              role="tab"
              aria-selected={isActive}
              aria-disabled={!isEnabled}
              title={
                isEnabled
                  ? m.label
                  : m.id === "solve"
                    ? "Solve enabled when KG has ≥10 entities"
                    : "Probe enabled when a card is selected"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "3px 8px",
                borderRadius: 999,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: isActive
                  ? "#0a1020"
                  : isEnabled
                    ? "#556479"
                    : "rgba(85,100,121,0.4)",
                background: isActive ? "white" : "transparent",
                boxShadow: isActive
                  ? "0 1px 2px rgba(8,30,80,0.08), 0 0 0 0.5px rgba(15,23,42,0.06)"
                  : "none",
                cursor: isEnabled ? "pointer" : "not-allowed",
                transition:
                  "color var(--dur-rail-micro) var(--ease-out-quart), background var(--dur-rail-micro) var(--ease-out-quart)",
              }}
            >
              <IconComp size={10} />
              {m.label}
            </span>
          );
        })}
      </div>

      <FileText
        style={{
          width: 11,
          height: 11,
          strokeWidth: 1.5,
          color: "#556479",
          flexShrink: 0,
          marginLeft: 4,
        }}
      />
      <span
        style={{
          flex: 1,
          fontSize: 10.5,
          fontWeight: 500,
          color: text ? "#0a1020" : "#86868B",
          letterSpacing: "0.005em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: '-apple-system, "SF Pro Text", system-ui',
        }}
      >
        {text || activeMode.placeholder}
      </span>
      <button
        type="button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 10px",
          borderRadius: 999,
          background: "linear-gradient(135deg, #086ce8 0%, #0856b8 100%)",
          color: "white",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.02em",
          border: 0,
          boxShadow: "0 2px 6px rgba(8,108,232,0.32)",
          cursor: "pointer",
        }}
      >
        <activeMode.icon size={9} />
        {activeMode.cta}
      </button>
    </div>
  );
}

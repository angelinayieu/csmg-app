"use client";

// ── WhiteboardNode ──
//
// Tier-based node card. The tier classification is applied externally (via
// lib/whiteboard/tier-classifier) and passed in — this component just
// renders faithfully per tier. Each tier has a fundamentally different
// visual treatment, not just a size/color tweak.

import React, { useState } from "react";
import { Zap, TrendingUp, Target, AlertTriangle, Share2, BookOpen, Cog, CircleDot, GitBranch, Focus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Entity } from "@/types";
import type { LayerConfig } from "@/lib/whiteboard/layer-config";
import type { WhiteboardTier } from "@/lib/whiteboard/tier-classifier";
import { WhiteboardSparkline, synthesizeSparkline } from "./whiteboard-sparkline";

// ── Geometry per tier ──
// These govern width; height is content-driven but bounded.
const TIER_WIDTH: Record<WhiteboardTier, number> = {
  hero: 300,
  key: 260,
  support: 220,
  peripheral: 170,
};

const TIER_GAUGE_SIZE: Record<WhiteboardTier, number> = {
  hero: 44,
  key: 34,
  support: 28,
  peripheral: 22,
};

// ── Type icon — signals the role an entity plays at a glance ──

function TypeIcon({ entity, className }: { entity: Entity; className?: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isFault = (entity.entity_category as string) === "fault";
  if (isFault) return <AlertTriangle className={className} />;
  if (entity.is_leverage_point) return <Zap className={className} />;
  if (entity.is_master_bottleneck) return <Focus className={className} />;
  if (entity.is_risk_point) return <AlertTriangle className={className} />;

  const category = entity.entity_category;
  if (category === "process") return <Cog className={className} />;
  if (category === "relational") return <Share2 className={className} />;
  if (category === "epistemic") return <BookOpen className={className} />;
  if (category === "concrete") return <CircleDot className={className} />;

  const type = (entity.entity_type ?? "").toLowerCase();
  if (type.includes("system")) return <GitBranch className={className} />;
  if (type.includes("thread")) return <TrendingUp className={className} />;
  if (type.includes("metric") || type.includes("evidence")) return <Target className={className} />;
  return <FileText className={className} />;
}

// ── Main node ──

export interface WhiteboardNodeProps {
  entity: Entity;
  tier: WhiteboardTier;
  weight: number;             // 0..100
  layer: LayerConfig;
  isConvergence: boolean;
  /**
   * Non-null when this entity is a systemic pressure point in the latest
   * cascade run — i.e. downstream from ≥3 strategic seeds. The value is
   * the number of seeds hitting it (intensity). Drives a distinct amber
   * ring, orthogonal to the convergence ring (which reflects incoming-edge
   * count, not multi-hop reach).
   */
  pressureSeeds?: number | null;
  /**
   * When this entity grounds one or more axioms. Drives a violet ring that
   * sits FURTHER OUT than pressureSeeds, with intensity tied to the highest
   * visibility (HIDDEN > IMPLICIT > EXPLICIT) and load-bearing (critical > important).
   * Purpose: surface "here's where the reasoning rests" directly on the graph,
   * so users can see which entities are load-bearing for the whole analysis.
   */
  axiomGrounding?: {
    count: number;
    highest_visibility: "HIDDEN" | "IMPLICIT" | "EXPLICIT";
    highest_load_bearing: "critical" | "important" | "moderate";
  } | null;
  /**
   * When this entity has been expanded via the whiteboard decompose action,
   * this is { depth, subComponentCount }. Drives a small badge in the top-left
   * corner indicating expansion state ("L2 · 7" meaning depth 2, 7 sub-components).
   */
  expansionInfo?: { depth: number; subComponentCount: number } | null;
  x: number;
  y: number;
  onClick?: (entity: Entity) => void;
  onDecompose?: (entity: Entity, depthLevel?: number) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  selected?: boolean;
  /** True while this node is being actively dragged — disables transitions. */
  dragging?: boolean;
  /** True for newly-spawned nodes — triggers scale+fade spawn animation. */
  spawning?: boolean;
  className?: string;
}

export function WhiteboardNode({
  entity,
  tier,
  weight,
  layer,
  isConvergence,
  pressureSeeds,
  axiomGrounding,
  expansionInfo,
  x,
  y,
  onClick,
  onDecompose,
  onPointerDown,
  selected,
  dragging,
  spawning,
  className,
}: WhiteboardNodeProps) {
  const width = TIER_WIDTH[tier];
  const gauge = TIER_GAUGE_SIZE[tier];
  const gaugeR = gauge * 0.41;
  const gaugeCircumference = 2 * Math.PI * gaugeR;
  const gaugeOffset = gaugeCircumference * (1 - weight / 100);

  const isHero = tier === "hero";
  const isKey = tier === "key";
  const isSupport = tier === "support";
  const isPeripheral = tier === "peripheral";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isFault = (entity.entity_category as string) === "fault";

  const gaugeColor = (() => {
    if (isHero) return weight >= 85 ? "#4ade80" : "#fbbf24";
    if (weight >= 85) return "#24c36e";
    if (weight >= 65) return layer.color;
    return "#ff9500";
  })();

  const showBody = tier !== "peripheral";
  const showSparkline = tier === "hero" || tier === "key";
  const showDecomposeButton = tier !== "peripheral" && entity.knowledge_layer !== "external";

  const sparkline = showSparkline
    ? synthesizeSparkline({
        weight,
        confidence: typeof entity.confidence === "number" ? entity.confidence : 0.7,
        isConvergence,
        layerColor: layer.color,
        hasPrediction: tier === "hero" || (tier === "key" && weight >= 75),
      })
    : null;

  return (
    <div
      data-entity-id={entity.id}
      data-no-pan
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(entity);
      }}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute group transition-shadow duration-300",
        dragging ? "cursor-grabbing" : "cursor-grab",
        selected && "ring-2 ring-offset-2 ring-blue-500",
        isPeripheral && "opacity-70 hover:opacity-100",
        spawning && "wb-spawning",
        dragging && "wb-dragging",
        className,
      )}
      style={{
        left: x,
        top: y,
        width,
        zIndex: dragging ? 20 : isHero ? 5 : isKey ? 4 : 3,
        // Smooth position transitions for non-drag movements (sibling shifts,
        // repositioning after decompose). Disabled during drag so the node
        // follows the cursor 1:1.
        transition: dragging ? "none" : "left 0.35s cubic-bezier(0.22, 1, 0.36, 1), top 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.3s",
      }}
    >
      {/* Convergence pulsing ring (outside border) */}
      {isConvergence && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none animate-pulse"
          style={{
            outline: `2px dashed ${isHero ? "rgba(255,255,255,0.5)" : layer.color}`,
            outlineOffset: "4px",
            opacity: 0.5,
          }}
        />
      )}

      {/* Systemic pressure point ring — amber, further out than convergence so
          the two can coexist. Intensity (seeds reaching) drives opacity. */}
      {pressureSeeds && pressureSeeds > 0 && (
        <>
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{
              outline: `2px solid rgba(251, 146, 60, ${Math.min(0.85, 0.35 + pressureSeeds * 0.1)})`,
              outlineOffset: "9px",
              boxShadow: `0 0 ${8 + pressureSeeds * 2}px rgba(251, 146, 60, 0.4)`,
            }}
            title={`Systemic pressure point: downstream of ${pressureSeeds} strategic seeds`}
          />
          <div
            className="absolute -top-2 -right-2 z-10 rounded-full bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 shadow-md pointer-events-none"
            title={`Reached by ${pressureSeeds} seeds in the latest cascade`}
          >
            ×{pressureSeeds}
          </div>
        </>
      )}

      {/* Axiom grounding ring — violet, placed furthest out so it coexists with
          convergence + pressure rings. Intensity tied to visibility + load-bearing.
          HIDDEN axiom grounding is the strongest signal (entire reasoning rests on
          it without user having stated it). Vision-Pro-style: soft glow, no harsh
          outline, subtle radial feel. */}
      {axiomGrounding && axiomGrounding.count > 0 && (() => {
        const v = axiomGrounding.highest_visibility;
        const lb = axiomGrounding.highest_load_bearing;
        const isHidden = v === "HIDDEN";
        const isCritical = lb === "critical";
        // Color: HIDDEN → deep violet, IMPLICIT → indigo, EXPLICIT → sky (less urgent)
        const ringColor = isHidden ? "rgba(139, 92, 246, " : v === "IMPLICIT" ? "rgba(99, 102, 241, " : "rgba(14, 165, 233, ";
        const intensity = isHidden && isCritical ? 0.75 : isHidden ? 0.6 : isCritical ? 0.5 : 0.35;
        const glowSize = isHidden && isCritical ? 16 : isHidden ? 12 : 8;
        return (
          <>
            <div
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{
                outline: `1.5px solid ${ringColor}${intensity})`,
                outlineOffset: "14px",
                boxShadow: `0 0 ${glowSize}px ${ringColor}${intensity * 0.6})`,
              }}
              title={`Grounds ${axiomGrounding.count} axiom${axiomGrounding.count === 1 ? "" : "s"} · highest visibility: ${v.toLowerCase()} · ${lb}`}
            />
            {/* Tiny pill anchored to top-left — signals axiom count, defers to the ring for color story */}
            <div
              className="absolute -top-2 -left-2 z-10 rounded-full text-white text-[9px] font-semibold px-1.5 py-[2px] shadow-sm pointer-events-none tracking-wide"
              style={{
                background: isHidden ? "rgb(139, 92, 246)" : v === "IMPLICIT" ? "rgb(99, 102, 241)" : "rgb(14, 165, 233)",
              }}
              title={`Grounds ${axiomGrounding.count} axiom${axiomGrounding.count === 1 ? "" : "s"}`}
            >
              A{axiomGrounding.count > 1 ? `×${axiomGrounding.count}` : ""}{isHidden && <span className="ml-[2px]">◆</span>}
            </div>
          </>
        );
      })()}

      {/* Expansion depth badge — top-right if entity has been decomposed via whiteboard.
          Sits inside the pressure-badge position only if pressureSeeds is null. If both
          exist, expansion badge shifts below. Glass-pill aesthetic. */}
      {expansionInfo && expansionInfo.depth > 0 && (
        <div
          className={cn(
            "absolute z-10 rounded-full bg-white/90 backdrop-blur-sm border border-sky-300/60 text-sky-700 text-[9px] font-semibold px-1.5 py-[1px] shadow-sm pointer-events-none tabular-nums",
            pressureSeeds && pressureSeeds > 0 ? "-bottom-2 -right-2" : "-top-2 -right-2",
          )}
          title={`Expanded to depth ${expansionInfo.depth} · ${expansionInfo.subComponentCount} sub-component${expansionInfo.subComponentCount === 1 ? "" : "s"}`}
        >
          L{expansionInfo.depth}
          {expansionInfo.subComponentCount > 0 && (
            <span className="ml-[2px] text-sky-400">·{expansionInfo.subComponentCount}</span>
          )}
        </div>
      )}

      {/* Main card */}
      <div
        className={cn(
          "relative rounded-2xl overflow-hidden backdrop-blur-md transition-all",
          isHero && "border-2",
          isKey && "border-l-[3px]",
          isSupport && "border shadow-sm",
          isPeripheral && "border",
          isFault && !isHero && "border-rose-300",
        )}
        style={{
          background: isHero
            ? layer.heroGradient
            : isPeripheral
              ? "rgba(255,255,255,0.55)"
              : "rgba(255,255,255,0.85)",
          borderColor: isHero
            ? "rgba(255,255,255,0.3)"
            : isKey
              ? layer.color
              : isFault
                ? "rgba(244, 63, 94, 0.35)"
                : "rgba(0,0,0,0.06)",
          boxShadow: isHero
            ? `0 0 0 1px ${layer.color}44, 0 14px 40px -8px ${layer.color}66, 0 4px 14px rgba(8,60,180,0.1)`
            : isKey
              ? `0 6px 20px -6px ${layer.color}55, 0 3px 10px rgba(8,60,180,0.08)`
              : undefined,
        }}
      >
        {/* Subtle corner glow for non-hero tiers */}
        {!isHero && !isPeripheral && (
          <div
            className="absolute bottom-0 right-0 rounded-br-2xl pointer-events-none"
            style={{
              width: "65%",
              height: "55%",
              background: `radial-gradient(ellipse at 100% 100%, ${layer.color}20, transparent 70%)`,
              filter: "blur(12px)",
              opacity: 0.5,
            }}
          />
        )}

        {/* Inner content */}
        <div className="relative z-10" style={{ padding: isPeripheral ? "10px 12px 8px" : "12px 14px 10px" }}>
          {/* Head row: gauge + title */}
          <div className="flex items-start gap-2">
            {/* Gauge ring */}
            <div className="flex-shrink-0 relative" style={{ width: gauge, height: gauge }}>
              <svg
                viewBox={`0 0 ${gauge} ${gauge}`}
                style={{ transform: "rotate(-90deg)", display: "block" }}
              >
                <circle
                  cx={gauge / 2}
                  cy={gauge / 2}
                  r={gaugeR}
                  fill="none"
                  stroke={isHero ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.06)"}
                  strokeWidth={3}
                />
                <circle
                  cx={gauge / 2}
                  cy={gauge / 2}
                  r={gaugeR}
                  fill="none"
                  stroke={gaugeColor}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeDasharray={gaugeCircumference}
                  strokeDashoffset={gaugeOffset}
                  style={{ filter: `drop-shadow(0 0 3px ${gaugeColor}55)` }}
                />
              </svg>
              <div
                className="absolute inset-0 grid place-items-center font-bold tracking-tight"
                style={{
                  fontSize: isPeripheral ? 8 : isSupport ? 9 : 10,
                  color: isHero ? "white" : "#0a1020",
                }}
              >
                {weight}
              </div>
            </div>

            {/* Title block */}
            <div className="flex-1 min-w-0">
              {/* Layer tag + type */}
              <div className="flex items-center gap-1.5 flex-wrap" style={{ marginBottom: 3 }}>
                <span
                  className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] font-bold tracking-widest uppercase"
                  style={{
                    fontSize: 7.5,
                    background: isHero ? layer.heroTagBg : layer.bg,
                    color: isHero ? "white" : layer.color,
                    border: `1px solid ${isHero ? "rgba(255,255,255,0.3)" : layer.border}`,
                    letterSpacing: "0.14em",
                  }}
                >
                  {layer.shortLabel}
                </span>
                {!isPeripheral && (
                  <span
                    className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] font-bold uppercase"
                    style={{
                      fontSize: 7.5,
                      letterSpacing: "0.1em",
                      background: isHero ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.04)",
                      color: isHero ? "rgba(255,255,255,0.8)" : "#556479",
                    }}
                  >
                    <TypeIcon
                      entity={entity}
                      className="opacity-80"
                    />
                    {isFault ? "Fault" : (entity.entity_category ?? "concept")}
                  </span>
                )}
              </div>

              {/* Title */}
              <div
                className="font-bold leading-tight truncate"
                style={{
                  fontSize: isHero ? 14.5 : isKey ? 13.5 : isSupport ? 12.5 : 11.5,
                  color: isHero ? "white" : isPeripheral ? "#556479" : "#0a1020",
                  letterSpacing: "-0.015em",
                }}
                title={entity.name}
              >
                {entity.name}
              </div>
            </div>
          </div>

          {/* Body (description) */}
          {showBody && entity.description && (
            <div
              className="mt-1.5 leading-snug font-medium"
              style={{
                fontSize: 10,
                color: isHero ? "rgba(255,255,255,0.7)" : "#556479",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {entity.description}
            </div>
          )}

          {/* Sparkline */}
          {sparkline && (
            <div
              className="mt-1.5"
              style={{
                paddingTop: 4,
                borderTop: `1px solid ${isHero ? "rgba(255,255,255,0.12)" : "rgba(10,30,80,0.05)"}`,
              }}
            >
              <WhiteboardSparkline data={sparkline} dark={isHero} height={30} />
            </div>
          )}

          {/* Meta footer (non-peripheral) */}
          {!isPeripheral && (
            <div
              className="mt-1.5 flex items-center gap-1.5 font-semibold"
              style={{
                fontSize: 9,
                paddingTop: 5,
                borderTop: `1px solid ${isHero ? "rgba(255,255,255,0.12)" : "rgba(10,30,80,0.05)"}`,
                color: isHero ? "rgba(255,255,255,0.55)" : "#8592a8",
              }}
            >
              <span>{entity.importance ?? "moderate"}</span>
              <span
                className="inline-block rounded-full"
                style={{
                  width: 2,
                  height: 2,
                  background: isHero ? "rgba(255,255,255,0.3)" : "#b4bfd0",
                }}
              />
              <span className="italic truncate" style={{ color: isHero ? "rgba(255,255,255,0.45)" : "#b4bfd0" }}>
                {entity.entity_type ?? "concept"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Decompose button with depth picker (appears on hover) */}
      {showDecomposeButton && onDecompose && (
        <DecomposeButton entity={entity} layer={layer} onDecompose={onDecompose} />
      )}
    </div>
  );
}

/**
 * Decompose button with integrated depth picker. Default click = depth 1 (fast).
 * Right-click or long-hover reveals a mini menu with depth 1-5 options + tooltips
 * describing what each level produces. Persists user's last-chosen depth per session.
 */
function DecomposeButton({
  entity,
  layer,
  onDecompose,
}: {
  entity: Entity;
  layer: LayerConfig;
  onDecompose: (entity: Entity, depthLevel?: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastDepth, setLastDepth] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const saved = window.localStorage.getItem("interaxis:whiteboard-depth");
    const n = saved ? parseInt(saved, 10) : 1;
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1;
  });

  const rememberDepth = (d: number) => {
    setLastDepth(d);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("interaxis:whiteboard-depth", String(d));
    }
  };

  const DEPTH_OPTIONS: Array<{ level: number; label: string; sub: string }> = [
    { level: 1, label: "Quick", sub: "8–15 major sub-processes" },
    { level: 2, label: "Mechanisms", sub: "6–12 internal mechanisms" },
    { level: 3, label: "Atomic", sub: "6–10 measurable variables" },
    { level: 4, label: "Cascades", sub: "6–10 second-order effects" },
    { level: 5, label: "Boundary", sub: "5–8 thresholds + phase transitions" },
  ];

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 z-20"
      style={{ bottom: -11 }}
      data-no-pan
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDecompose(entity, lastDepth);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="grid place-items-center opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-md"
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "white",
          border: `1.5px solid ${layer.color}`,
          color: layer.color,
        }}
        title={`Decompose (depth ${lastDepth}) — right-click for depth options`}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      {menuOpen && (
        <div
          className="absolute left-1/2 -translate-x-1/2 mt-2 rounded-lg border border-gray-200 bg-white shadow-lg p-1 min-w-[200px]"
          style={{ top: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Decomposition depth
          </div>
          {DEPTH_OPTIONS.map((opt) => (
            <button
              key={opt.level}
              onClick={(e) => {
                e.stopPropagation();
                rememberDepth(opt.level);
                setMenuOpen(false);
                onDecompose(entity, opt.level);
              }}
              className={cn(
                "w-full rounded px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-gray-50",
                opt.level === lastDepth && "bg-gray-50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-800">
                  L{opt.level} · {opt.label}
                </span>
                {opt.level === lastDepth && (
                  <span className="text-[9px] text-interaxis-600">default</span>
                )}
              </div>
              <div className="text-[10px] text-gray-500 leading-tight">{opt.sub}</div>
            </button>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
            }}
            className="w-full rounded px-2 py-1.5 text-left text-[10px] text-gray-400 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

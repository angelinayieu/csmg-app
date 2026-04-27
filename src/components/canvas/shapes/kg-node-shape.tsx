"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Zap, AlertTriangle, Focus, Cog, Share2, BookOpen, CircleDot, FileText, FlaskConical, Ruler } from "lucide-react";
import { LAYERS, type LayerId } from "@/lib/whiteboard/layer-config";
import { useCanvasReactions } from "../canvas-reactions-context";
import { useCanvasHierarchy } from "../canvas-hierarchy-context";
import { ReactionHoverPreview } from "@/components/shared/reaction-preview";
import type { ReactionType, Reaction } from "@/types/reactions";
import type { Entity } from "@/types";
import type { KGNodeShape } from "./types";
import { NodeSignatureRing } from "@/components/signatures/node-signature-ring";
import type { NodeSignature } from "@/types/node-signature";

// Phase 49 — deterministic seeded RNG for sparkline generation. We don't
// have real per-entity time-series data yet (Phase 50+), so we derive a
// stable, visually convincing trend curve from the entity id. Same id →
// same curve, so zoom/pan don't re-shuffle the visuals.
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

function seededRandom(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Phase 49 — build a trend SVG path anchored at `current` weight. Points
 * start ~12% below current and drift toward it over N samples so the
 * trend visually reads "growing confidence." Projected next-value is
 * returned so the card can show `current → next` as a trend delta.
 */
function buildSparkline(
  entityId: string | undefined,
  current: number,
  width: number,
  height: number,
  pointCount: number = 14,
): { path: string; area: string; projected: number } {
  const seed = hashString(entityId ?? "anon");
  const rnd = seededRandom(seed);
  const vals: number[] = [];
  let v = Math.max(5, current - 12);
  for (let i = 0; i < pointCount; i++) {
    vals.push(v);
    const noise = (rnd() - 0.5) * 6;
    v += (current - v) * 0.28 + noise;
  }
  vals[pointCount - 1] = current;
  const projected = Math.max(
    0,
    Math.min(100, Math.round(current + (rnd() * 3 + 0.5))),
  );
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 100);
  const range = Math.max(1, max - min);
  const parts: string[] = [];
  const areaParts: string[] = [];
  for (let i = 0; i < vals.length; i++) {
    const x = (i / (pointCount - 1)) * width;
    const y = height - ((vals[i] - min) / range) * height;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    if (i === 0) areaParts.push(`M${x.toFixed(1)},${height}`);
    areaParts.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
  }
  areaParts.push(`L${width.toFixed(1)},${height} Z`);
  return { path: parts.join(" "), area: areaParts.join(" "), projected };
}

// Phase 30 — reaction-type → color matches lab-chamber-3d legend.
const REACTION_TYPE_COLOR: Record<ReactionType, string> = {
  emergent: "#4ade80",
  reinforcing: "#22d3ee",
  tension: "#f472b6",
  trivial: "#94a3b8",
};

const TIER_WIDTH = { hero: 300, key: 260, support: 220, peripheral: 170 } as const;
const TIER_HEIGHT = { hero: 156, key: 132, support: 112, peripheral: 76 } as const;

const LAYER_IDS: LayerId[] = ["L0", "L1", "L2", "L3", "L4"];
const CATEGORIES = ["concrete", "abstract", "process", "relational", "epistemic", "fault"];
const TIERS = ["hero", "key", "support", "peripheral"] as const;

function iconFor(category: string, isLeverage: boolean, isBottleneck: boolean, isRisk: boolean) {
  if (isLeverage) return Zap;
  if (isBottleneck) return Focus;
  if (isRisk) return AlertTriangle;
  if (category === "process") return Cog;
  if (category === "relational") return Share2;
  if (category === "epistemic") return BookOpen;
  if (category === "concrete") return CircleDot;
  return FileText;
}

// Shared stylesheet for kg-node animations. Rendered once per shape but
// tldraw's HTMLContainer isolates each shape's tree, so each instance
// gets its own <style> tag. That's fine — browsers dedupe identical
// stylesheet content, and it keeps the animations co-located with the
// shape definition rather than scattered across a global CSS file.
function KGNodeAnimationStyles() {
  return (
    <style>{`
      /* P1 #5 — kg-node enter animation. Fires once on mount so every
         entity (ghost or real) fades+scales in instead of snapping.
         320ms matches proposal-snapshot cadence. */
      .kg-node-enter {
        animation: kg-node-enter 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      @keyframes kg-node-enter {
        from { opacity: 0; transform: scale(0.94) translateY(-4px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      /* P0 #4 — preview→real identity-confirm pulse. Saturation spike +
         subtle scale pop marks the moment a speculative card locks into
         the real entity. */
      .kg-node-confirm-pulse {
        animation: kg-node-confirm 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
      @keyframes kg-node-confirm {
        0%   { filter: saturate(1) brightness(1); transform: scale(1); }
        45%  { filter: saturate(1.35) brightness(1.08); transform: scale(1.035); }
        100% { filter: saturate(1) brightness(1); transform: scale(1); }
      }
    `}</style>
  );
}

export class KGNodeShapeUtil extends BaseBoxShapeUtil<KGNodeShape> {
  static override type = "kg-node" as const;
  static override props: RecordProps<KGNodeShape> = {
    w: T.number,
    h: T.number,
    entityId: T.string,
    name: T.string,
    description: T.string,
    layer: T.literalEnum(...LAYER_IDS),
    category: T.literalEnum(...(CATEGORIES as [string, ...string[]])),
    tier: T.literalEnum(...TIERS),
    weight: T.number,
    isLeverage: T.boolean,
    isRisk: T.boolean,
    isBottleneck: T.boolean,
    isConvergence: T.boolean,
    isGhost: T.boolean,
    // P0 #4 — monotonic counter bumped whenever a preview kg-node is
    // upgraded to a real entity (Pass 1 speculative → Pass 2 confirmed).
    // The view component watches this prop via useEffect and plays a
    // one-shot "identity-confirm" CSS animation when it increments, so
    // the user sees a subtle pulse marking the moment a tentative
    // entity becomes real. Default 0 for never-upgraded shapes.
    confirmedPulse: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override hideRotateHandle = () => false;

  override onResize = (shape: KGNodeShape, info: TLResizeInfo<KGNodeShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): KGNodeShape["props"] {
    return {
      w: TIER_WIDTH.support,
      h: TIER_HEIGHT.support,
      entityId: "",
      name: "Untitled entity",
      description: "",
      layer: "L2",
      category: "concrete",
      tier: "support",
      weight: 70,
      isLeverage: false,
      isRisk: false,
      isBottleneck: false,
      isConvergence: false,
      isGhost: false,
      confirmedPulse: 0,
    };
  }

  component(shape: KGNodeShape) {
    return <KGNodeShapeView shape={shape} />;
  }

  indicator(shape: KGNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

function KGNodeShapeView({ shape }: { shape: KGNodeShape }) {
  const { name, description, layer, category, tier, weight, isLeverage, isRisk, isBottleneck, isConvergence, isGhost, entityId, confirmedPulse } =
    shape.props;

  // P1 #5 — one-shot enter animation. Tldraw keeps the same React
  // instance mounted for the life of a shape, so this ref tracks
  // "first render" and we apply the class only on that render cycle.
  // The CSS animation runs once and self-cleans via `animation-fill-mode: both`.
  const enteredRef = useRef(false);
  const [showEnter, setShowEnter] = useState(true);
  useEffect(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    const t = setTimeout(() => setShowEnter(false), 400);
    return () => clearTimeout(t);
  }, []);

  // P0 #4 — identity-confirm pulse. Watches confirmedPulse for changes
  // (the painter bumps it on preview→real upgrade). On increment, plays
  // a 320ms saturate-pop animation. Skips the first render so newly-
  // created shapes with confirmedPulse=0 don't accidentally fire.
  const lastPulseRef = useRef(confirmedPulse);
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (confirmedPulse === lastPulseRef.current) return;
    lastPulseRef.current = confirmedPulse;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 360);
    return () => clearTimeout(t);
  }, [confirmedPulse]);
  const layerCfg = LAYERS[layer];
  const Icon = iconFor(category, isLeverage, isBottleneck, isRisk);
  const isHero = tier === "hero";
  const isKey = tier === "key";
  const isPeripheral = tier === "peripheral";
  const gauge = isHero ? 44 : isKey ? 34 : 28;
  const gaugeR = gauge * 0.41;
  const circ = 2 * Math.PI * gaugeR;
  const offset = circ * (1 - weight / 100);
  const gaugeColor = weight >= 85 ? "#24c36e" : weight >= 65 ? layerCfg.color : "#ff9500";
  const textColor = isHero ? "#ffffff" : "#0a1020";
  const subColor = isHero ? "rgba(255,255,255,0.7)" : "#556479";

  // Phase 30: read the space-wide reactions index from context. When this
  // entity participates in any saved reactions, render a badge that deep-
  // links into the lab with that reaction pre-focused.
  const { spaceId, index } = useCanvasReactions();
  const summary = entityId ? index.byEntity.get(entityId) : undefined;

  // Phase 32: hierarchy index — how many decomposed proxy indicators does
  // this entity contain? Drives the ambient depth glyph so every card
  // signals "there's a probability space inside me" at rest.
  const { byEntity: hierarchyByEntity, entityLookup } = useCanvasHierarchy();
  const hierarchy = entityId ? hierarchyByEntity.get(entityId) : undefined;
  const subunitCount = hierarchy?.subunitCount ?? 0;

  // Phase 49 — richer card footer. Pull the full Entity from the lookup
  // for provenance + analysis metadata. Missing gracefully to sensible
  // defaults so the card still renders when the entity hasn't hydrated.
  const entity = entityId ? entityLookup.get(entityId) : undefined;
  // Leave ~72px of right-side clearance for the reaction badge when it's
  // present; otherwise stretch to normal card padding.
  const hasReactionBadge = !!summary && !!spaceId && !!entityId && !isPeripheral;
  const sparkWidth = Math.max(
    80,
    shape.props.w - 32 - (hasReactionBadge ? 64 : 0),
  );
  const sparkHeight = 20;
  const spark = useMemo(
    () => buildSparkline(entityId, weight, sparkWidth, sparkHeight),
    [entityId, weight, sparkWidth],
  );
  const version = entity?.analysis_count ?? 1;
  const provenance = entity?.provenance as
    | { source_type?: string; source_endpoint?: string; author?: string }
    | null
    | undefined;
  const citation =
    provenance?.author ||
    (provenance?.source_type
      ? provenance.source_type.replace(/_/g, " ")
      : entity?.source_tag ?? "InterAxis");
  const showFooter = !isPeripheral;
  const showSparkline = isHero || isKey;
  const sparkColor = isHero ? "rgba(255,255,255,0.85)" : layerCfg.color;
  const sparkFill = isHero ? "rgba(255,255,255,0.18)" : `${layerCfg.color}22`;

  const containerClasses = [
    showEnter ? "kg-node-enter" : "",
    pulsing ? "kg-node-confirm-pulse" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
      <HTMLContainer
        className={containerClasses || undefined}
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
          opacity: isGhost ? 0.68 : 1,
          filter: isGhost ? "saturate(0.85)" : undefined,
          transition: "opacity 200ms ease, filter 200ms ease",
        }}
      >
        <KGNodeAnimationStyles />
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 18,
            overflow: "hidden",
            background: isHero
              ? layerCfg.heroGradient
              : isPeripheral
                ? "rgba(255,255,255,0.6)"
                : "rgba(255,255,255,0.92)",
            backdropFilter: "blur(12px)",
            border: isGhost
              ? `1.5px dashed ${layerCfg.color}`
              : isHero
                ? "1.5px solid rgba(255,255,255,0.3)"
                : isKey
                  ? `2px solid ${layerCfg.color}`
                  : "1px solid rgba(10,30,80,0.08)",
            boxShadow: isGhost
              ? `0 0 0 1px ${layerCfg.color}22, 0 6px 18px -8px ${layerCfg.color}55`
              : isHero
                ? `0 0 0 1px ${layerCfg.color}44, 0 18px 48px -10px ${layerCfg.color}66, 0 4px 14px rgba(8,60,180,0.1)`
                : isKey
                  ? `0 8px 22px -8px ${layerCfg.color}55, 0 3px 10px rgba(8,60,180,0.08)`
                  : "0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
            padding: isPeripheral ? "10px 12px" : "14px 16px",
            color: textColor,
            fontFamily:
              '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          }}
        >
          {isGhost && (
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 10,
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: layerCfg.color,
                background: layerCfg.bg,
                border: `1px solid ${layerCfg.border}`,
                padding: "2px 6px",
                borderRadius: 4,
                textTransform: "uppercase",
              }}
            >
              Ghost
            </div>
          )}
          {isConvergence && (
            <div
              style={{
                position: "absolute",
                inset: -4,
                borderRadius: 22,
                outline: `2px dashed ${isHero ? "rgba(255,255,255,0.5)" : layerCfg.color}`,
                outlineOffset: 4,
                opacity: 0.45,
                animation: "pulse 2.4s ease-in-out infinite",
                pointerEvents: "none",
              }}
            />
          )}

          {/* Canonical signature rings — read off the entity row, render
              top-right of the card. The whole point of materializing
              NodeSignature is to surface a node's basis of resolution
              ("this dot has a category ring, an axis ring, a dominant
              relation ring, a leverage ring") at a glance. Without this
              overlay, that reasoning structure exists in the DB but is
              invisible on the canvas. Skip on peripheral cards (too
              little real estate for a meaningful ring stack) and skip
              ghost cards (their dashed border already telegraphs
              "speculative — no resolved variables yet"). */}
          <SignatureRingOverlay entity={entity} isHero={isHero} hidden={isPeripheral || isGhost} />

          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            {/* gauge */}
            <div style={{ position: "relative", width: gauge, height: gauge, flexShrink: 0 }}>
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
                  strokeDasharray={circ}
                  strokeDashoffset={offset}
                />
              </svg>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: isHero ? 11 : 10,
                  fontWeight: 700,
                  color: textColor,
                }}
              >
                {weight}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: isHero ? "rgba(255,255,255,0.18)" : layerCfg.bg,
                    color: isHero ? "#fff" : layerCfg.color,
                    border: `1px solid ${isHero ? "rgba(255,255,255,0.3)" : layerCfg.border}`,
                  }}
                >
                  {layerCfg.shortLabel}
                </span>
                {!isPeripheral && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: isHero ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.04)",
                      color: isHero ? "rgba(255,255,255,0.85)" : "#556479",
                    }}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {category}
                  </span>
                )}
                {/* Phase 32: ambient depth glyph. Tiny dots indicate this
                    entity's decomposed subunits — signals "probability
                    space inside" before the user clicks to expand. */}
                {subunitCount > 0 && (
                  <DepthGlyph count={subunitCount} isHero={isHero} layerColor={layerCfg.color} />
                )}
                {spaceId && entityId && !isPeripheral && (
                  <OpenLabPill
                    spaceId={spaceId}
                    entityId={entityId}
                    isHero={isHero}
                    layerColor={layerCfg.color}
                  />
                )}
                {/* D1 — measurement spec badge. Either:
                    • measured: small green pill showing "unit · scale"
                      so you can see at a glance what variable the entity
                      represents
                    • unmeasured (only for fundamental/critical entities
                      in measurable categories): orange "❓ unmeasured"
                      pill flagging the gap
                    • neither rendered for moderate/important entities or
                      relational/epistemic categories — nothing to flag */}
                {!isPeripheral && entity && (
                  <MeasurementBadge
                    measurementUnit={entity.measurement_unit ?? null}
                    measurementScale={entity.measurement_scale ?? null}
                    importance={entity.importance ?? null}
                    entityCategory={entity.entity_category ?? null}
                    isHero={isHero}
                  />
                )}
                {/* D3 — controllability badge. Reads
                    manifold.operational.controllability and renders
                    a compact "kind · cost · lag · reversibility"
                    pill so the user can see at a glance which
                    levers are cheap-fast vs expensive-slow without
                    opening any drawer. Silent when the manifold
                    doesn't carry a controllability profile. */}
                {!isPeripheral && entity && (
                  <ControllabilityBadge
                    manifold={
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (entity as any).manifold ?? null
                    }
                    importance={entity.importance ?? null}
                    isHero={isHero}
                  />
                )}
              </div>
              <div
                style={{
                  fontSize: isHero ? 15 : isKey ? 13.5 : isPeripheral ? 11.5 : 12.5,
                  fontWeight: 700,
                  letterSpacing: "-0.015em",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={name}
              >
                {name}
              </div>
            </div>
          </div>

          {!isPeripheral && description && (
            <div
              style={{
                marginTop: 8,
                fontSize: 10.5,
                lineHeight: 1.45,
                color: subColor,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {description}
            </div>
          )}

          {/* Phase 49 — sparkline footer. Hero + key tiers get a trend
              curve with current → projected delta + citation line.
              Support tier gets only the citation line. Peripheral keeps
              its bare treatment. */}
          {showFooter && (
            <div
              style={{
                position: "absolute",
                left: isPeripheral ? 10 : 16,
                right:
                  (isPeripheral ? 10 : 16) + (hasReactionBadge ? 64 : 0),
                bottom: isPeripheral ? 8 : 10,
                pointerEvents: "none",
              }}
            >
              {/* Phase 2E · Tier 1 honesty pass — the previous sparkline
                  was a seeded-RNG "projected next" trend with no real
                  time-series backing. Replaced with a static weight
                  bar (actually reflects the current weight value) +
                  the current weight label. Honest surface: the bar
                  length is data, nothing is pretending to predict
                  the future. When real pulse-event timeseries lands
                  (Phase 50+), swap this back for an actual sparkline. */}
              {showSparkline && (
                <div
                  style={{
                    position: "relative",
                    marginBottom: 4,
                    height: sparkHeight,
                    width: sparkWidth,
                  }}
                >
                  {/* Static weight bar — width proportional to weight. */}
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      bottom: 2,
                      width: "100%",
                      height: 3,
                      borderRadius: 2,
                      background: isHero
                        ? "rgba(255,255,255,0.18)"
                        : "rgba(15,23,42,0.06)",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, weight))}%`,
                        height: "100%",
                        borderRadius: 2,
                        background: sparkColor,
                        opacity: 0.9,
                      }}
                    />
                  </div>
                  {/* Current weight label */}
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      bottom: sparkHeight - 2,
                      fontSize: 8.5,
                      fontWeight: 700,
                      color: isHero
                        ? "rgba(255,255,255,0.9)"
                        : layerCfg.color,
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                      letterSpacing: "0.02em",
                      textShadow: isHero
                        ? "0 0 4px rgba(0,0,0,0.2)"
                        : "none",
                    }}
                  >
                    {weight}%
                  </span>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 8.5,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: isHero
                    ? "rgba(255,255,255,0.6)"
                    : "rgba(85,100,121,0.75)",
                  letterSpacing: "0.04em",
                }}
              >
                <span aria-hidden style={{ fontWeight: 700 }}>
                  V
                </span>
                <span>·</span>
                <span style={{ fontWeight: 600 }}>{version}</span>
                <span>·</span>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    fontStyle: "italic",
                    opacity: 0.85,
                  }}
                  title={citation}
                >
                  {citation}
                </span>
              </div>
            </div>
          )}

          {/* Phase 30 — reaction badge. Clickable deep-link into the lab
              with the first touching reaction pre-focused. Phase 35 adds
              a hover preview of the most-recent reaction so users can
              scan without navigating. */}
          {summary && spaceId && entityId && !isPeripheral && (
            <ReactionBadge
              spaceId={spaceId}
              entityId={entityId}
              count={summary.count}
              types={summary.types}
              firstId={summary.firstId}
              allReactions={summary.all}
              isHero={isHero}
            />
          )}
        </div>
      </HTMLContainer>
  );
}

function ReactionBadge({
  spaceId,
  entityId,
  count,
  types,
  firstId,
  allReactions,
  isHero,
}: {
  spaceId: string;
  entityId: string;
  count: number;
  types: ReactionType[];
  firstId: string;
  allReactions: Reaction[];
  isHero: boolean;
}) {
  const href = `/app/space/${spaceId}/entity/${entityId}/lab?rxn=${firstId}`;
  const tooltip =
    count === 1
      ? `1 reaction · hover to preview · click to open in lab`
      : `${count} reactions · hover to preview · click to open first`;

  // Phase 35: resolve participants for the newest reaction using the
  // canvas entity lookup context — no extra fetch.
  const { entityLookup } = useCanvasHierarchy();
  const newest = allReactions[0];
  const participants: Array<Entity | null> = newest
    ? newest.entity_ids.map((id) => entityLookup.get(id) ?? null)
    : [];

  const badge = (
    <a
      href={href}
      title={tooltip}
      aria-label={tooltip}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        bottom: 8,
        right: 8,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 7px 3px 5px",
        borderRadius: 999,
        background: isHero
          ? "rgba(255,255,255,0.18)"
          : "rgba(10,30,80,0.04)",
        border: `1px solid ${
          isHero ? "rgba(255,255,255,0.35)" : "rgba(10,30,80,0.12)"
        }`,
        color: isHero ? "#fff" : "#0a1020",
        textDecoration: "none",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.04em",
        lineHeight: 1,
        cursor: "pointer",
        transition: "transform 140ms ease, box-shadow 140ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 3px 10px rgba(10,30,80,0.18)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <FlaskConical
        style={{ width: 10, height: 10, opacity: isHero ? 0.95 : 0.7 }}
      />
      <span>{count}</span>
      <span
        aria-hidden
        style={{ display: "inline-flex", gap: 2, marginLeft: 2 }}
      >
        {types.slice(0, 3).map((t, i) => (
          <span
            key={`${t}-${i}`}
            style={{
              display: "inline-block",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: REACTION_TYPE_COLOR[t],
              boxShadow: `0 0 4px ${REACTION_TYPE_COLOR[t]}`,
            }}
          />
        ))}
      </span>
    </a>
  );

  // Phase 35: wrap in hover preview. When there's no resolvable newest
  // reaction (shouldn't happen since count > 0 implies ≥1 reaction) we
  // fall through without the popover.
  if (!newest) return badge;
  return (
    <ReactionHoverPreview
      reaction={newest}
      participants={participants}
      focalEntityId={entityId}
      openInLabHref={href}
    >
      {badge}
    </ReactionHoverPreview>
  );
}

/**
 * Phase 32 — ambient depth glyph. Tiny inline indicator showing the count
 * of direct subunits this entity has. Designed to be silent at a glance
 * (just dots + a number) but informative on hover (tooltip: "N subunits
 * · click to open rings").
 *
 * Visual grammar: up to 5 dots representing actual subunits, a "+N"
 * overflow chip when there are more, and a total count. The dots use
 * the layer color so the glyph sits comfortably with the layer badge it
 * appears next to.
 */
function DepthGlyph({
  count,
  isHero,
  layerColor,
}: {
  count: number;
  isHero: boolean;
  layerColor: string;
}) {
  const dots = Math.min(count, 5);
  const overflow = count - dots;
  const dotColor = isHero ? "rgba(255,255,255,0.85)" : layerColor;
  return (
    <span
      title={`${count} proxy ${count === 1 ? "indicator" : "indicators"} inside — click card to open rings`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        borderRadius: 4,
        background: isHero ? "rgba(255,255,255,0.1)" : `${layerColor}14`,
        border: `1px solid ${isHero ? "rgba(255,255,255,0.25)" : `${layerColor}33`}`,
        color: isHero ? "rgba(255,255,255,0.9)" : layerColor,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: "0.08em",
        lineHeight: 1,
      }}
    >
      <span
        aria-hidden
        style={{ display: "inline-flex", gap: 2 }}
      >
        {Array.from({ length: dots }).map((_, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: dotColor,
              opacity: 0.55 + (i / Math.max(1, dots - 1)) * 0.45,
            }}
          />
        ))}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {overflow > 0 ? `${dots}+` : count}
      </span>
    </span>
  );
}

/**
 * Card-level "Open Lab" affordance. Sits in the header chip row alongside
 * the layer badge / category / depth glyph so it's always discoverable —
 * not gated on the entity having saved reactions (that's the
 * ReactionBadge's job in the bottom-right). Navigates to the same NodeLab
 * route the rings + reaction badge already use.
 */
function OpenLabPill({
  spaceId,
  entityId,
  isHero,
  layerColor,
}: {
  spaceId: string;
  entityId: string;
  isHero: boolean;
  layerColor: string;
}) {
  const href = `/app/space/${spaceId}/entity/${entityId}/lab`;
  return (
    <a
      href={href}
      title="Open in lab"
      aria-label="Open in lab"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px 2px 5px",
        borderRadius: 4,
        background: isHero ? "rgba(255,255,255,0.14)" : `${layerColor}14`,
        border: `1px solid ${isHero ? "rgba(255,255,255,0.3)" : `${layerColor}33`}`,
        color: isHero ? "rgba(255,255,255,0.95)" : layerColor,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        textDecoration: "none",
        lineHeight: 1,
        cursor: "pointer",
        transition: "transform 140ms ease, background 140ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-0.5px)";
        e.currentTarget.style.background = isHero
          ? "rgba(255,255,255,0.22)"
          : `${layerColor}22`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.background = isHero
          ? "rgba(255,255,255,0.14)"
          : `${layerColor}14`;
      }}
    >
      <FlaskConical style={{ width: 8, height: 8 }} />
      Lab
    </a>
  );
}

/**
 * D1 — Measurement spec badge.
 *
 * Renders one of three states based on the entity's measurement_unit /
 * measurement_scale columns plus its importance + category:
 *
 *   • measured   → green pill "unit · scale" (e.g. "users/wk · cont")
 *   • unmeasured → orange pill "?? unmeasured" — only shown for
 *                  fundamental/critical entities in measurable categories
 *                  (concrete | abstract | process), matching the gate's
 *                  requiresMeasurement() rule
 *   • silent     → renders nothing for important/moderate entities OR for
 *                  relational/epistemic categories (no unit expected)
 *
 * See docs/KG_DEPTH_CRITIQUE.md §9 D1, src/types/measurement.ts, and
 * src/lib/validation/measurement-coverage-gate.ts.
 */
function MeasurementBadge({
  measurementUnit,
  measurementScale,
  importance,
  entityCategory,
  isHero,
}: {
  measurementUnit: string | null;
  measurementScale: string | null;
  importance: string | null;
  entityCategory: string | null;
  isHero: boolean;
}) {
  const hasUnit =
    typeof measurementUnit === "string" && measurementUnit.trim().length > 0;
  const hasScale =
    typeof measurementScale === "string" && measurementScale.trim().length > 0;
  const measured = hasUnit && hasScale;

  const REQUIRED_IMPORTANCE = ["fundamental", "critical"];
  const MEASURABLE_CATEGORIES = ["concrete", "abstract", "process"];
  const requires =
    importance != null &&
    entityCategory != null &&
    REQUIRED_IMPORTANCE.includes(importance) &&
    MEASURABLE_CATEGORIES.includes(entityCategory);

  // Silent for non-measured, non-required entities — avoids visual clutter
  // on the 80% of entities that legitimately don't need measurement (e.g.
  // moderate-importance scaffolding, epistemic claims, relational tradeoffs).
  if (!measured && !requires) return null;

  const compactScale = measured
    ? measurementScale === "continuous"
      ? "cont"
      : measurementScale === "categorical"
        ? "cat"
        : measurementScale === "ordinal"
          ? "ord"
          : measurementScale === "binary"
            ? "bin"
            : measurementScale
    : null;

  if (measured) {
    return (
      <span
        title={`Measured · unit "${measurementUnit}", scale ${measurementScale}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: "2px 6px",
          borderRadius: 4,
          background: isHero
            ? "rgba(74,222,128,0.18)"
            : "rgba(34,197,94,0.10)",
          border: `1px solid ${isHero ? "rgba(74,222,128,0.45)" : "rgba(34,197,94,0.35)"}`,
          color: isHero ? "rgba(220,252,231,0.95)" : "#15803d",
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: "0.06em",
          lineHeight: 1,
          maxWidth: 140,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <Ruler style={{ width: 8, height: 8, flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {measurementUnit}
        </span>
        <span
          aria-hidden
          style={{
            opacity: 0.65,
            fontWeight: 600,
          }}
        >
          · {compactScale}
        </span>
      </span>
    );
  }

  // requires === true and !measured: render the gap flag. This is the
  // visual analog of the warn that the validator emits when a
  // fundamental/critical quantifiable entity has no spec.
  return (
    <span
      title={`Unmeasured — this ${importance} ${entityCategory} entity should have a unit + scale (D1 measurement gate). Run the backfill agent or add a [MEASUREMENT: ...] block in re-decomposition.`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 4,
        background: isHero
          ? "rgba(251,146,60,0.18)"
          : "rgba(251,146,60,0.10)",
        border: `1px solid ${isHero ? "rgba(251,146,60,0.5)" : "rgba(251,146,60,0.4)"}`,
        color: isHero ? "rgba(254,243,199,0.95)" : "#c2410c",
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      <Ruler style={{ width: 8, height: 8, opacity: 0.7 }} />
      Unmeasured
    </span>
  );
}

/**
 * D3 — Controllability badge.
 *
 * Reads `entity.manifold.operational.controllability` (D3 schema —
 * src/types/controllability.ts) and renders a compact pill summarizing
 * the lever's cost / lag / reversibility profile so the user can scan
 * the canvas and immediately see which levers are cheap-and-fast vs.
 * expensive-and-slow without opening any drawer.
 *
 * Three states:
 *   • full profile (kind set + cost or lag) → green/blue/amber pill
 *     showing "kind · $cost · lag · rev"
 *   • kind-only → small kind chip ("FULL", "PART", "GATED", "OBS")
 *   • no profile → silent (no badge rendered)
 *
 * Color coding: green for fully-controllable + low-cost, blue for
 * partially-controllable, amber for gated/high-cost, gray for
 * observable_only. Opportunity-cost-dominated levers get a subtle
 * yellow-orange to visually flag the hidden-cost framing.
 *
 * Defensive everywhere — manifold JSONB walking can hit malformed
 * shapes; we silently degrade rather than throw.
 */
function ControllabilityBadge({
  manifold,
  importance,
  isHero,
}: {
  manifold: Record<string, unknown> | null | undefined;
  importance: string | null;
  isHero: boolean;
}) {
  // Defensive walk: manifold → operational → controllability
  if (!manifold || typeof manifold !== "object") return null;
  const operational = (manifold as Record<string, unknown>).operational;
  if (!operational || typeof operational !== "object") return null;
  const ctrl = (operational as Record<string, unknown>).controllability;
  if (!ctrl || typeof ctrl !== "object") return null;
  const c = ctrl as Record<string, unknown>;

  const kind = typeof c.kind === "string" ? c.kind : null;
  const ic = (c.intervention_cost ?? null) as Record<string, unknown> | null;
  const oc = (c.opportunity_cost ?? null) as Record<string, unknown> | null;
  const tte = (c.time_to_effect ?? null) as Record<string, unknown> | null;
  const rev = typeof c.reversibility === "string" ? c.reversibility : null;
  const costKind = typeof c.cost_kind === "string" ? c.cost_kind : null;

  // Silent when there's literally nothing to show.
  if (!kind && !ic && !oc && !tte && !rev) return null;

  // Pick the dominant color frame. Opportunity-dominated framings get
  // a yellow-orange tint to visually distinguish the hidden-cost
  // story from direct-cost levers. Otherwise, color follows kind.
  const palette = (() => {
    if (costKind === "opportunity_dominated") {
      return {
        bg: isHero ? "rgba(250,204,21,0.18)" : "rgba(250,204,21,0.10)",
        border: isHero ? "rgba(250,204,21,0.5)" : "rgba(250,204,21,0.4)",
        fg: isHero ? "rgba(254,249,195,0.95)" : "#a16207",
      };
    }
    if (
      costKind === "hidden_externalities" ||
      costKind === "risk_adjusted_dominated" ||
      kind === "gated"
    ) {
      return {
        bg: isHero ? "rgba(251,146,60,0.18)" : "rgba(251,146,60,0.10)",
        border: isHero ? "rgba(251,146,60,0.5)" : "rgba(251,146,60,0.4)",
        fg: isHero ? "rgba(254,243,199,0.95)" : "#c2410c",
      };
    }
    if (kind === "observable_only") {
      return {
        bg: isHero ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.12)",
        border: isHero ? "rgba(148,163,184,0.45)" : "rgba(148,163,184,0.35)",
        fg: isHero ? "rgba(241,245,249,0.85)" : "#475569",
      };
    }
    if (kind === "partially_controllable") {
      return {
        bg: isHero ? "rgba(96,165,250,0.18)" : "rgba(59,130,246,0.10)",
        border: isHero ? "rgba(96,165,250,0.5)" : "rgba(59,130,246,0.35)",
        fg: isHero ? "rgba(219,234,254,0.95)" : "#1d4ed8",
      };
    }
    // fully_controllable + direct → green by default
    return {
      bg: isHero ? "rgba(74,222,128,0.18)" : "rgba(34,197,94,0.10)",
      border: isHero ? "rgba(74,222,128,0.45)" : "rgba(34,197,94,0.35)",
      fg: isHero ? "rgba(220,252,231,0.95)" : "#15803d",
    };
  })();

  // Compose the visible parts. Order: kind chip → cost → lag →
  // reversibility hint. Each is shown only when known; the badge
  // gracefully shrinks when fields are missing.
  const kindShort = (() => {
    switch (kind) {
      case "fully_controllable":
        return "FULL";
      case "partially_controllable":
        return "PART";
      case "gated":
        return "GATE";
      case "observable_only":
        return "OBS";
      default:
        return null;
    }
  })();

  const costStr = (() => {
    if (!ic) return null;
    const est = ic.estimate;
    if (typeof est !== "number" || !Number.isFinite(est)) return null;
    const recurrence =
      typeof ic.recurrence === "string" ? ic.recurrence : null;
    const formatted = formatUSD(est);
    if (recurrence === "recurring_monthly") return `${formatted}/mo`;
    if (recurrence === "recurring_yearly") return `${formatted}/yr`;
    if (recurrence === "recurring_continuous") return `${formatted}+`;
    return formatted;
  })();

  const oppCostStr = (() => {
    if (!oc) return null;
    const est = oc.estimate;
    if (typeof est !== "number" || !Number.isFinite(est)) return null;
    return `opp ${formatUSD(est)}`;
  })();

  const lagStr = (() => {
    if (!tte) return null;
    const lag = tte.lag;
    return typeof lag === "string" && lag.trim().length > 0
      ? lag.trim().slice(0, 14)
      : null;
  })();

  const revStr = (() => {
    if (!rev) return null;
    if (rev === "easily_reversible") return "rev";
    if (rev === "costly_to_reverse") return "↺costly";
    if (rev === "irreversible") return "1-way";
    return null;
  })();

  // Build the tooltip — full structured profile for hover details.
  const tooltipParts: string[] = [];
  if (kind) tooltipParts.push(`Kind: ${kind.replace(/_/g, " ")}`);
  if (ic && typeof ic.estimate === "number") {
    const conf = typeof ic.confidence === "string" ? ` (${ic.confidence})` : "";
    const recur = typeof ic.recurrence === "string" ? ` ${ic.recurrence}` : "";
    const sunk = ic.is_sunk ? " · sunk" : "";
    tooltipParts.push(
      `Cost: ${formatUSD(ic.estimate as number)}${recur}${conf}${sunk}`,
    );
  }
  if (oc && typeof oc.estimate === "number") {
    const alt =
      typeof oc.alternative === "string" ? ` · alt: ${oc.alternative}` : "";
    tooltipParts.push(
      `Opportunity cost: ${formatUSD(oc.estimate as number)}${alt}`,
    );
  }
  if (costKind) tooltipParts.push(`Dominant cost: ${costKind.replace(/_/g, " ")}`);
  if (tte && typeof tte.lag === "string")
    tooltipParts.push(`Time to effect: ${tte.lag}`);
  if (rev) tooltipParts.push(`Reversibility: ${rev.replace(/_/g, " ")}`);
  const tooltip = tooltipParts.join("\n") || "Controllability profile";

  void importance; // available for future thresholding

  return (
    <span
      title={tooltip}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        borderRadius: 4,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: "0.06em",
        lineHeight: 1,
        maxWidth: 200,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Cog style={{ width: 8, height: 8, flexShrink: 0 }} />
      {kindShort && <span>{kindShort}</span>}
      {costStr && (
        <span style={{ opacity: 0.75 }}>
          · {costStr}
        </span>
      )}
      {oppCostStr && (
        <span style={{ opacity: 0.75 }}>
          · {oppCostStr}
        </span>
      )}
      {lagStr && (
        <span style={{ opacity: 0.65 }}>
          · {lagStr}
        </span>
      )}
      {revStr && (
        <span style={{ opacity: 0.6, fontStyle: "italic" }}>
          · {revStr}
        </span>
      )}
    </span>
  );
}

function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return "?";
  if (n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

/**
 * Canvas-side ring overlay. Reads the entity's persisted node_signature
 * (written by the signature_materializer pipeline) and renders the
 * NodeSignatureRing primitive at a tile-appropriate size in the top-
 * right corner of the card.
 *
 * Static for now — when a `signature_deepened` event lands and the
 * executor calls persistSignature(), the entity row updates and the
 * canvas's entity lookup re-fetches; React re-renders the card with
 * the new ring count. Ring-growth animation (motion-wrapped circles)
 * is a follow-up; the first move that earns the "movie unravel" feel
 * is just MAKING the rings visible at all.
 *
 * Click does NOT open the detail drawer here — that drawer is mounted
 * on the constellation widget / app detail page, not the canvas. The
 * overlay's hover title is the affordance: it shows the canonical_code
 * + ring count + residual_uncertainty so the user gets the headline
 * without navigating away.
 */
function SignatureRingOverlay({
  entity,
  isHero,
  hidden,
}: {
  entity: Entity | undefined;
  isHero: boolean;
  hidden: boolean;
}) {
  if (hidden) return null;
  const sig = entity?.node_signature as NodeSignature | null | undefined;
  if (!sig || !sig.basis || sig.basis.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        width: 36,
        height: 36,
        pointerEvents: "auto",
        // Hero cards have a saturated gradient background; lift the ring
        // onto a translucent disc so the strokes stay legible against
        // any color underneath.
        borderRadius: "50%",
        background: isHero ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.6)",
        backdropFilter: "blur(4px)",
        boxShadow: isHero
          ? "0 0 0 1px rgba(255,255,255,0.18)"
          : "0 0 0 1px rgba(10,30,80,0.06)",
        display: "grid",
        placeItems: "center",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <NodeSignatureRing
        signature={sig}
        size={32}
        showCode={false}
        showLabel={false}
      />
    </div>
  );
}

export const KG_NODE_TIER_SIZE = { TIER_WIDTH, TIER_HEIGHT };

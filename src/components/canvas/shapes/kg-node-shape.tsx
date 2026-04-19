"use client";

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Zap, AlertTriangle, Focus, Cog, Share2, BookOpen, CircleDot, FileText, FlaskConical } from "lucide-react";
import { LAYERS, type LayerId } from "@/lib/whiteboard/layer-config";
import { useCanvasReactions } from "../canvas-reactions-context";
import { useCanvasHierarchy } from "../canvas-hierarchy-context";
import { ReactionHoverPreview } from "@/components/shared/reaction-preview";
import type { ReactionType, Reaction } from "@/types/reactions";
import type { Entity } from "@/types";
import type { KGNodeShape } from "./types";

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
  const { name, description, layer, category, tier, weight, isLeverage, isRisk, isBottleneck, isConvergence, isGhost, entityId } =
    shape.props;
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
  const { byEntity: hierarchyByEntity } = useCanvasHierarchy();
  const hierarchy = entityId ? hierarchyByEntity.get(entityId) : undefined;
  const subunitCount = hierarchy?.subunitCount ?? 0;

  return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          pointerEvents: "all",
          opacity: isGhost ? 0.68 : 1,
          filter: isGhost ? "saturate(0.85)" : undefined,
          transition: "opacity 200ms ease, filter 200ms ease",
        }}
      >
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

export const KG_NODE_TIER_SIZE = { TIER_WIDTH, TIER_HEIGHT };

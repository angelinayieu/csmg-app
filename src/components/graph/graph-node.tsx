"use client";

import React from "react";
import { getNodeColor, getDomainColor, graphOverlays, connectivityTiers, getConnectivityTier } from "@/lib/design-tokens";
import type { ConnectivityTier } from "@/lib/design-tokens";
import type { Entity } from "@/types";
import type { LayoutType } from "@/lib/graph/layout-engine";

// ── Atom role classification ──
// Uses causal_role (from LLM) when available, falls back to category-based inference
export type AtomRole = "truth" | "proof" | "deliverable" | "outcome" | "goal" | null;

const ATOM_ROLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  truth: { label: "TRUTH", color: "#7C3AED", bg: "#EDE9FE" },
  proof: { label: "PROOF", color: "#059669", bg: "#D1FAE5" },
  deliverable: { label: "DELIV", color: "#D97706", bg: "#FEF3C7" },
  outcome: { label: "RESULT", color: "#0891B2", bg: "#ECFEFF" },
  goal: { label: "GOAL", color: "#E11D48", bg: "#FFF1F2" },
};

export function getAtomRole(entity: Entity): AtomRole {
  // Phase 9: Use causal_role from LLM when available
  const causalRole = (entity as Record<string, unknown>).causal_role as string | null;
  if (causalRole) {
    if (causalRole === "truth") return "truth";
    if (causalRole === "evidence") return "proof";
    if (causalRole === "deliverable") return "deliverable";
    if (causalRole === "application") return "deliverable"; // application → renders as deliverable
    if (causalRole === "outcome") return "outcome";
    if (causalRole === "goal") return "goal";
  }

  // Fallback: category-based inference (pre-Phase 9 entities)
  if (entity.knowledge_layer === "external") return null;
  if (entity.entity_category === "epistemic") return "truth";
  if (entity.entity_category === "abstract" && (entity.importance === "fundamental" || entity.importance === "critical")) return "truth";
  if (entity.entity_category === "concrete") return "deliverable";
  if (entity.entity_category === "process" && entity.importance === "moderate") return "deliverable";
  if (entity.entity_category === "relational" && entity.confidence >= 0.8) return "proof";
  return null;
}

interface GraphNodeProps {
  entity: Entity;
  x: number;
  y: number;
  radius?: number;
  domainIndex?: number; // If set, color by domain instead of category
  isHovered: boolean;
  isNeighbor: boolean;
  isDimmed: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
  /** Double-click handler — typically used to navigate to the entity detail page */
  onDoubleClick?: () => void;
  /** Layout type — affects node shape/size */
  layoutType?: LayoutType;
  /** When true, external entities render at full opacity/saturation */
  externalAsPrimary?: boolean;
  /** Cycle intervention point — entity is the leverage point of a detected cycle */
  isCycleInterventionPoint?: boolean;
  /** Classification of the cycle this entity is an intervention point for */
  cycleClassification?: "reinforcing_positive" | "reinforcing_negative" | "balancing";
  /** Interaction field strength (0-1) — renders as radial glow scaled by strength */
  fieldStrength?: number;
  /** Whether this entity is in a tension zone (opposing forces) */
  isTensionZone?: boolean;
  /** Tension magnitude (0-1) for sizing the tension indicator */
  tensionMagnitude?: number;
  /** Number of connections (edges) this node has */
  degree?: number;
  /** Maximum degree across all nodes in the graph */
  maxDegree?: number;
  /** Signal strength (0-1): 0 = noise, 1 = strong signal. Fades/shrinks low-signal nodes. */
  signalStrength?: number;
}

function GraphNodeInner({
  entity,
  x,
  y,
  radius = 20,
  domainIndex,
  isHovered,
  isNeighbor,
  isDimmed,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onDoubleClick,
  layoutType = "force",
  externalAsPrimary = false,
  isCycleInterventionPoint = false,
  cycleClassification,
  fieldStrength = 0,
  isTensionZone = false,
  tensionMagnitude = 0,
  degree = 0,
  maxDegree = 1,
  signalStrength = 1,
}: GraphNodeProps) {
  // Signal strength multipliers: fade/shrink noise nodes so true structure dominates
  const clampedSignal = signalStrength < 0 ? 0 : signalStrength > 1 ? 1 : signalStrength;
  const signalOpacityMult = 0.4 + 0.6 * clampedSignal;
  const signalRadiusMult = 0.75 + 0.25 * clampedSignal;
  // Use domain color if in unified view, otherwise category color
  const colors = domainIndex !== undefined
    ? getDomainColor(domainIndex)
    : getNodeColor(entity.entity_category);
  const isExternal = entity.knowledge_layer === "external";
  const isBridgeLayer = entity.knowledge_layer === "bridge";
  // When external entities ARE the primary content, don't fade them
  const fadeExternal = isExternal && !externalAsPrimary;
  const confidenceOpacity =
    entity.confidence >= 0.8 ? 1 : entity.confidence >= 0.5 ? 0.7 : 0.5;
  // Evidence grounding — entities with evidence_strength (populated from claims) appear more prominent
  const evidenceStrength = (entity as Record<string, unknown>).evidence_strength as number | null;
  const evidenceOpacityMod = evidenceStrength != null && evidenceStrength > 0 ? 1 : 0.85;

  // Source provenance — visually distinguishes user-stated from inferred/assumed entities
  // EXPLICIT: no indicator (default/trusted), IMPLICIT: amber dot, ASSUMED: gray dot
  const sourceTag = entity.source_tag as "explicit" | "implicit" | "assumed" | undefined;
  const sourceDotColor =
    sourceTag === "implicit" ? "#fbbf24" /* amber-400 */ :
    sourceTag === "assumed" ? "#9ca3af" /* gray-400 */ :
    null;
  const isDagre = layoutType !== "force";

  // ── Connectivity tier — PRIMARY sizing factor ──
  const tier: ConnectivityTier = getConnectivityTier(degree, maxDegree);
  const tierConfig = connectivityTiers[tier];

  // Base radius from connectivity tier (hub=32, bridge=24, leaf=15, orphan=11)
  const tierRadius = Math.round(radius * tierConfig.radiusMult);

  // Importance as SECONDARY modifier (+/- 15%)
  const importanceMod =
    entity.importance === "fundamental" ? 1.15
    : entity.importance === "critical" ? 1.08
    : entity.importance === "important" ? 1.0
    : 0.92;
  const baseRadius = Math.round(tierRadius * importanceMod);

  // Special roles get slightly larger
  const roleBonus = entity.is_master_bottleneck ? 3 : entity.is_leverage_point ? 2 : entity.is_risk_point ? 1 : 0;
  // Apply signal strength to radius — noise nodes shrink to 75% size
  const scaledRadius = Math.round((baseRadius + roleBonus) * signalRadiusMult);

  const displayRadius = fadeExternal ? scaledRadius - 4 : isHovered ? scaledRadius + 3 : scaledRadius;
  const strokeWidth = fadeExternal ? 0.8 : isHovered ? tierConfig.strokeWidth + 0.5 : tierConfig.strokeWidth;
  // Apply signal strength to opacity — noise nodes fade to 40% visibility
  const dimOpacity = isDimmed
    ? 0.15
    : fadeExternal
      ? 0.65 * signalOpacityMult
      : tierConfig.opacityMult * evidenceOpacityMod * signalOpacityMult;
  // Solid fills — external entities use lighter but still visible fills
  const fillColor = fadeExternal ? `${colors.fill}90` : isBridgeLayer ? `${colors.fill}CC` : colors.fill;

  // Dagre layouts use rounded rectangles instead of circles.
  // Apply signalRadiusMult so noise nodes shrink in Dagre views too (consistent with circle branch).
  const boxW = isDagre ? Math.round(120 * signalRadiusMult) : 0;
  const boxH = isDagre ? Math.round(44 * signalRadiusMult) : 0;
  const truncName = entity.name.length > (isDagre ? 20 : 18)
    ? entity.name.slice(0, isDagre ? 18 : 16) + "..."
    : entity.name;

  return (
    <g
      transform={`translate(${x},${y})`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        cursor: "pointer",
        opacity: dimOpacity,
        transition: "opacity 250ms ease",
      }}
    >
      {/* Interaction field strength glow — outermost, behind everything */}
      {fieldStrength > 0.1 && !isDimmed && (
        isDagre ? (
          <rect
            x={-boxW / 2 - 10 - fieldStrength * 8}
            y={-boxH / 2 - 10 - fieldStrength * 8}
            width={boxW + 20 + fieldStrength * 16}
            height={boxH + 20 + fieldStrength * 16}
            rx={16}
            fill={graphOverlays.fieldStrength.color}
            opacity={fieldStrength * graphOverlays.fieldStrength.maxOpacity}
            style={{ pointerEvents: "none", filter: "blur(4px)" }}
          />
        ) : (
          <circle
            r={displayRadius + 10 + fieldStrength * 12}
            fill={graphOverlays.fieldStrength.color}
            opacity={fieldStrength * graphOverlays.fieldStrength.maxOpacity}
            style={{ pointerEvents: "none", filter: "blur(4px)" }}
          />
        )
      )}

      {/* Tension zone indicator — red dashed ring for entities under opposing forces */}
      {isTensionZone && !isDimmed && (
        isDagre ? (
          <rect
            x={-boxW / 2 - 8}
            y={-boxH / 2 - 8}
            width={boxW + 16}
            height={boxH + 16}
            rx={14}
            fill="none"
            stroke={graphOverlays.tensionZone.ring}
            strokeWidth={graphOverlays.tensionZone.width}
            strokeDasharray={graphOverlays.tensionZone.dash}
            opacity={Math.min(0.3 + tensionMagnitude * 0.4, graphOverlays.tensionZone.opacity)}
          />
        ) : (
          <circle
            r={displayRadius + 10}
            fill="none"
            stroke={graphOverlays.tensionZone.ring}
            strokeWidth={graphOverlays.tensionZone.width}
            strokeDasharray={graphOverlays.tensionZone.dash}
            opacity={Math.min(0.3 + tensionMagnitude * 0.4, graphOverlays.tensionZone.opacity)}
          />
        )
      )}

      {isDagre ? (
        /* ═══ DAGRE NODE — rounded rectangle ═══ */
        <>
          {/* Role indicator rings — outside the box */}
          {entity.is_master_bottleneck && (
            <rect
              x={-boxW / 2 - 4}
              y={-boxH / 2 - 4}
              width={boxW + 8}
              height={boxH + 8}
              rx={10}
              fill="none"
              stroke={graphOverlays.bottleneck.ring}
              strokeWidth={graphOverlays.bottleneck.width}
              opacity={0.8}
            />
          )}
          {entity.is_leverage_point && !entity.is_master_bottleneck && (
            <rect
              x={-boxW / 2 - 3}
              y={-boxH / 2 - 3}
              width={boxW + 6}
              height={boxH + 6}
              rx={10}
              fill="none"
              stroke={graphOverlays.leverage.ring}
              strokeWidth={graphOverlays.leverage.width}
              strokeDasharray={graphOverlays.leverage.dash}
              opacity={0.7}
            />
          )}
          {entity.is_risk_point && !entity.is_master_bottleneck && (
            <rect
              x={-boxW / 2 - 3}
              y={-boxH / 2 - 3}
              width={boxW + 6}
              height={boxH + 6}
              rx={10}
              fill="none"
              stroke={graphOverlays.risk.ring}
              strokeWidth={graphOverlays.risk.width}
              strokeDasharray={graphOverlays.risk.dash}
              opacity={0.7}
            />
          )}

          {/* Cycle intervention point — Dagre layout */}
          {isCycleInterventionPoint && (
            <>
              <rect
                x={-boxW / 2 - 6}
                y={-boxH / 2 - 6}
                width={boxW + 12}
                height={boxH + 12}
                rx={12}
                fill="none"
                stroke={graphOverlays.cycleIntervention.ring}
                strokeWidth={graphOverlays.cycleIntervention.width}
                strokeDasharray={graphOverlays.cycleIntervention.dash}
                opacity={0.65}
              />
              <g transform={`translate(${boxW / 2 + 2},${-boxH / 2 - 2})`}>
                <circle r={5} fill={
                  cycleClassification === "reinforcing_positive" ? graphOverlays.cyclePositive :
                  cycleClassification === "reinforcing_negative" ? graphOverlays.cycleNegative :
                  graphOverlays.cycleBalancing
                } stroke="white" strokeWidth={0.8} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={6} fontWeight={700} fill="white" style={{ pointerEvents: "none" }}>
                  {cycleClassification === "reinforcing_positive" ? "+" :
                   cycleClassification === "reinforcing_negative" ? "−" : "~"}
                </text>
              </g>
            </>
          )}

          {/* External indicator */}
          {isExternal && (
            <rect
              x={-boxW / 2 - 2}
              y={-boxH / 2 - 2}
              width={boxW + 4}
              height={boxH + 4}
              rx={9}
              fill="none"
              stroke="#86868B"
              strokeWidth={0.5}
              strokeDasharray="3 2"
              opacity={0.5}
            />
          )}

          {/* Main box */}
          <rect
            x={-boxW / 2}
            y={-boxH / 2}
            width={boxW}
            height={boxH}
            rx={8}
            fill={fillColor}
            stroke={isHovered ? colors.stroke : `${colors.stroke}80`}
            strokeWidth={isHovered ? 2 : 1.2}
            strokeOpacity={confidenceOpacity}
            strokeDasharray={
              isExternal ? "4 2" : entity.confidence < 0.5 ? "3 2" : ""
            }
          />

          {/* Entity prefix badge — top-left, shows prefix only (e.g. C1, X2) */}
          <text
            x={-boxW / 2 + 8}
            y={-boxH / 2 + 14}
            fontSize={8}
            fontWeight={700}
            letterSpacing="0.04em"
            fill={colors.stroke}
            opacity={0.5}
            style={{ pointerEvents: "none" }}
          >
            {entity.entity_id.length > 6 ? entity.entity_id.split("_").slice(0, 2).join("_") : entity.entity_id}
          </text>

          {/* Entity name — centered in box */}
          <text
            x={0}
            y={6}
            textAnchor="middle"
            fontSize={10}
            fontWeight={500}
            fill="#374151"
            style={{ pointerEvents: "none" }}
          >
            {truncName}
          </text>

          {/* Atom role badge — dagre layout */}
          {(() => {
            const role = getAtomRole(entity);
            if (!role || isDimmed) return null;
            const cfg = ATOM_ROLE_CONFIG[role];
            return (
              <g transform={`translate(${boxW / 2 - 20},${-boxH / 2 + 14})`}>
                <rect x={-12} y={-5} width={24} height={10} rx={3} fill={cfg.bg} stroke={cfg.color} strokeWidth={0.5} opacity={0.85} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={6} fontWeight={700} letterSpacing="0.06em" fill={cfg.color} style={{ pointerEvents: "none" }}>
                  {cfg.label}
                </text>
              </g>
            );
          })()}

          {/* Decomposable indicator */}
          {entity.is_decomposable && (
            <g transform={`translate(${boxW / 2 - 8},${-boxH / 2 + 8})`}>
              <circle r={6} fill="white" stroke="#86868B" strokeWidth={0.5} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={8}
                fill="#86868B"
              >
                {entity.has_sub_space ? "●" : "⊕"}
              </text>
            </g>
          )}
          {/* Source provenance dot — top-left of Dagre rect */}
          {sourceDotColor && !isDimmed && (
            <circle
              cx={-boxW / 2 + 4}
              cy={-boxH / 2 + 4}
              r={2.5}
              fill={sourceDotColor}
              opacity={0.9}
            >
              <title>{sourceTag === "implicit" ? "Implicit — inferred from context" : "Assumed — domain pattern"}</title>
            </circle>
          )}
        </>
      ) : (
        /* ═══ FORCE NODE — circle (original) ═══ */
        <>
          {/* Master bottleneck ring */}
          {entity.is_master_bottleneck && (
            <circle
              r={displayRadius + 6}
              fill="none"
              stroke={graphOverlays.bottleneck.ring}
              strokeWidth={graphOverlays.bottleneck.width}
              opacity={0.8}
            />
          )}

          {/* Leverage point ring */}
          {entity.is_leverage_point && !entity.is_master_bottleneck && (
            <circle
              r={displayRadius + 5}
              fill="none"
              stroke={graphOverlays.leverage.ring}
              strokeWidth={graphOverlays.leverage.width}
              strokeDasharray={graphOverlays.leverage.dash}
              opacity={0.7}
            />
          )}

          {/* Risk point ring */}
          {entity.is_risk_point && !entity.is_master_bottleneck && (
            <circle
              r={displayRadius + 5}
              fill="none"
              stroke={graphOverlays.risk.ring}
              strokeWidth={graphOverlays.risk.width}
              strokeDasharray={graphOverlays.risk.dash}
              opacity={0.7}
            />
          )}

          {/* Cycle intervention point — distinct pulsing ring showing this entity is the leverage point of a feedback loop */}
          {isCycleInterventionPoint && (
            <>
              <circle
                r={displayRadius + 8}
                fill="none"
                stroke={graphOverlays.cycleIntervention.ring}
                strokeWidth={graphOverlays.cycleIntervention.width}
                strokeDasharray={graphOverlays.cycleIntervention.dash}
                opacity={0.65}
              />
              {/* Tiny cycle-type indicator */}
              <g transform={`translate(${displayRadius + 3},${-displayRadius - 3})`}>
                <circle r={5} fill={
                  cycleClassification === "reinforcing_positive" ? graphOverlays.cyclePositive :
                  cycleClassification === "reinforcing_negative" ? graphOverlays.cycleNegative :
                  graphOverlays.cycleBalancing
                } stroke="white" strokeWidth={0.8} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={6} fontWeight={700} fill="white" style={{ pointerEvents: "none" }}>
                  {cycleClassification === "reinforcing_positive" ? "+" :
                   cycleClassification === "reinforcing_negative" ? "−" : "~"}
                </text>
              </g>
            </>
          )}

          {/* External entity indicator — dotted ring (only when faded, not when primary) */}
          {fadeExternal && (
            <circle
              r={displayRadius + 4}
              fill="none"
              stroke="#86868B"
              strokeWidth={0.8}
              strokeDasharray="2 3"
              opacity={0.4}
            />
          )}

          {/* Bridge entity indicator — double ring, blue tint */}
          {isBridgeLayer && !isExternal && (
            <>
              <circle
                r={displayRadius + 4}
                fill="none"
                stroke="#378ADD"
                strokeWidth={0.8}
                strokeDasharray="4 2"
                opacity={0.6}
              />
              <circle
                r={displayRadius + 7}
                fill="none"
                stroke="#378ADD"
                strokeWidth={0.4}
                strokeDasharray="2 3"
                opacity={0.3}
              />
            </>
          )}

          {/* Deliverable glow ring — warm amber halo for actionable atoms */}
          {getAtomRole(entity) === "deliverable" && !isDimmed && (
            <circle
              r={displayRadius + 5}
              fill="none"
              stroke={ATOM_ROLE_CONFIG.deliverable.color}
              strokeWidth={1.5}
              strokeDasharray="6 3"
              opacity={0.55}
            />
          )}

          {/* Goal ring — rose halo for master objectives */}
          {getAtomRole(entity) === "goal" && !isDimmed && (
            <circle
              r={displayRadius + 6}
              fill="none"
              stroke={ATOM_ROLE_CONFIG.goal.color}
              strokeWidth={2}
              strokeDasharray="4 2"
              opacity={0.6}
            />
          )}

          {/* Outcome ring — cyan halo for measurable results */}
          {getAtomRole(entity) === "outcome" && !isDimmed && (
            <circle
              r={displayRadius + 5}
              fill="none"
              stroke={ATOM_ROLE_CONFIG.outcome.color}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.45}
            />
          )}

          {entity.entity_category === "relational" ? (
            /* Diamond shape for relational entities */
            <rect
              x={-displayRadius * 0.7}
              y={-displayRadius * 0.7}
              width={displayRadius * 1.4}
              height={displayRadius * 1.4}
              rx={3}
              fill={fillColor}
              stroke={colors.stroke}
              strokeWidth={strokeWidth}
              strokeOpacity={confidenceOpacity}
              strokeDasharray={fadeExternal ? "4 2" : entity.confidence < 0.5 ? "3 2" : ""}
              transform="rotate(45)"
            />
          ) : entity.entity_category === "process" ? (
            /* Rounded rectangle for process entities */
            <rect
              x={-displayRadius * 1.1}
              y={-displayRadius * 0.65}
              width={displayRadius * 2.2}
              height={displayRadius * 1.3}
              rx={displayRadius * 0.35}
              fill={fillColor}
              stroke={colors.stroke}
              strokeWidth={strokeWidth}
              strokeOpacity={confidenceOpacity}
              strokeDasharray={fadeExternal ? "4 2" : entity.confidence < 0.5 ? "3 2" : ""}
            />
          ) : entity.entity_category === "epistemic" ? (
            /* Triangle-ish (inverted rounded rect) for epistemic entities */
            <circle
              r={displayRadius}
              fill={fillColor}
              stroke={colors.stroke}
              strokeWidth={strokeWidth}
              strokeOpacity={confidenceOpacity}
              strokeDasharray="4 2"
            />
          ) : (
            /* Circle for concrete, abstract */
            <circle
              r={displayRadius}
              fill={fillColor}
              stroke={colors.stroke}
              strokeWidth={strokeWidth}
              strokeOpacity={confidenceOpacity}
              strokeDasharray={
                fadeExternal
                  ? "4 2"
                  : entity.confidence < 0.5
                    ? "3 2"
                    : ""
              }
            />
          )}

          {/* Short name label inside node — white text on solid fill */}
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.min(tier === "hub" ? 12 : 10, Math.max(7, 120 / Math.max(entity.name.length, 1)))}
            fontWeight={tier === "hub" || tier === "bridge" ? 700 : 600}
            letterSpacing="0.01em"
            fill={fadeExternal ? colors.stroke : "#FFFFFF"}
            opacity={fadeExternal ? 0.85 : tier === "orphan" ? 0.9 : 1}
            style={{ pointerEvents: "none" }}
          >
            {entity.name.length > (tier === "orphan" ? 8 : 12) ? entity.name.slice(0, tier === "orphan" ? 6 : 10) + "..." : entity.name}
          </text>

          {/* Full name label below node */}
          <text
            y={displayRadius + 14}
            textAnchor="middle"
            fontSize={fadeExternal ? 9.5 : tier === "hub" ? 11 : 10}
            fill={fadeExternal ? "#6B7280" : tier === "hub" || tier === "bridge" ? "#1D1D1F" : "#6B7280"}
            fontWeight={tier === "hub" ? 600 : tier === "bridge" ? 500 : 400}
            style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "white", strokeWidth: 3, strokeLinejoin: "round" }}
          >
            {truncName}
          </text>

          {/* Category + layer indicator badge */}
          {(fadeExternal || isBridgeLayer) && (
            <text
              y={displayRadius + 25}
              textAnchor="middle"
              fontSize={7}
              fill={fadeExternal ? "#AEAEB2" : "#378ADD"}
              fontWeight={500}
              letterSpacing="0.05em"
              style={{ pointerEvents: "none", textTransform: "uppercase" }}
            >
              {isExternal ? "EXT" : "BRIDGE"}
            </text>
          )}

          {/* Atom role badge — TRUTH / PROOF / DELIV */}
          {(() => {
            const role = getAtomRole(entity);
            if (!role || isDimmed) return null;
            const cfg = ATOM_ROLE_CONFIG[role];
            const badgeY = (fadeExternal || isBridgeLayer)
              ? displayRadius + 35
              : displayRadius + 25;
            return (
              <g transform={`translate(0,${badgeY})`}>
                <rect
                  x={-14}
                  y={-5}
                  width={28}
                  height={10}
                  rx={3}
                  fill={cfg.bg}
                  stroke={cfg.color}
                  strokeWidth={0.5}
                  opacity={0.85}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={6}
                  fontWeight={700}
                  letterSpacing="0.06em"
                  fill={cfg.color}
                  style={{ pointerEvents: "none" }}
                >
                  {cfg.label}
                </text>
              </g>
            );
          })()}

          {/* Decomposable indicator */}
          {entity.is_decomposable && (
            <g transform={`translate(${displayRadius - 4},${displayRadius - 4})`}>
              <circle r={6} fill="white" stroke="#86868B" strokeWidth={0.5} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={9}
                fill="#86868B"
              >
                {entity.has_sub_space ? "●" : "⊕"}
              </text>
            </g>
          )}
          {/* Source provenance dot — top-left of force circle */}
          {sourceDotColor && !isDimmed && (
            <circle
              cx={-displayRadius * 0.7}
              cy={-displayRadius * 0.7}
              r={2.5}
              fill={sourceDotColor}
              opacity={0.9}
            >
              <title>{sourceTag === "implicit" ? "Implicit — inferred from context" : "Assumed — domain pattern"}</title>
            </circle>
          )}
        </>
      )}
    </g>
  );
}

export const GraphNode = React.memo(GraphNodeInner);

"use client";

// ── Hidden signal shape (2026-05-19) ──
//
// Surfaces a single structural-analysis finding from extractSignals()
// — cascade vulnerability, structural hole, hidden mediating variable,
// or flip-prone loop — as a first-class tldraw shape anchored near the
// entities it concerns.
//
// Distinct from `signal-flag-shape.tsx` which surfaces external radar
// intelligence (new entity discovered, authority shift). This one is
// about structural findings INSIDE the user's own graph — the things
// the system spotted that the user couldn't see by reading entities
// individually.
//
// The painter spawns one per high-priority signal emitted by the
// `signal_detected` pipeline event (see src/lib/synthesis/emit-signal-
// events.ts for the filter logic that decides which signals get
// individual shapes vs roll up into the cluster shape).
//
// Visual contract:
//   - Hexagonal accent rail (vs flag's rectangular rail) so users
//     immediately recognize it as a different artifact type
//   - Severity drives color + glow intensity
//   - Type icon distinguishes the 4 kinds at a glance
//   - Primary entity codes in the header so the user can trace which
//     graph nodes this finding is about
//
// Interaction:
//   - Hover dispatches `strategy-hover:entities` (re-uses the existing
//     CanvasEntityGlowResponder infrastructure) to pulse the related
//     kg-node shapes
//   - Click toggles the expanded view (reasoning + validation action +
//     "investigate" / "dismiss" affordances)
//   - onDoubleClick reserved for future signal-detail panel

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useCallback, useState } from "react";
import {
  AlertTriangle,
  Hexagon,
  Link2Off,
  RefreshCw,
  TrendingDown,
  X as XIcon,
} from "lucide-react";
import type {
  HiddenSignalShape,
  HiddenSignalClusterShape,
} from "./types";

export const HIDDEN_SIGNAL_DEFAULT_W = 240;
export const HIDDEN_SIGNAL_DEFAULT_H = 88;
export const HIDDEN_SIGNAL_EXPANDED_W = 340;
export const HIDDEN_SIGNAL_EXPANDED_H = 260;

type SignalType = HiddenSignalShape["props"]["signalType"];
type Severity = HiddenSignalShape["props"]["severity"];
type Status = HiddenSignalShape["props"]["status"];

// Color + label per severity. Mirrors the radar SignalFlag palette so
// the two surfaces feel related; both use red for critical, amber for
// moderate, slate for low. Each entry includes background tints used
// by the accent rail glow when severity=critical AND status=active.
const SEVERITY_META: Record<
  Severity,
  { color: string; bg: string; ring: string; label: string }
> = {
  critical: {
    color: "#dc2626",
    bg: "#fee2e2",
    ring: "rgba(220, 38, 38, 0.45)",
    label: "Critical",
  },
  moderate: {
    color: "#d97706",
    bg: "#fef3c7",
    ring: "rgba(217, 119, 6, 0.35)",
    label: "Moderate",
  },
  low: {
    color: "#64748b",
    bg: "#f1f5f9",
    ring: "rgba(100, 116, 139, 0.25)",
    label: "Low",
  },
};

// Per-type label + glyph. Glyph chosen to read semantically:
//   - cascade: AlertTriangle (warning, downstream blast)
//   - structural_hole: Link2Off (missing connection)
//   - hidden_variable: Hexagon (the unknown intermediary node)
//   - flip_prone_loop: RefreshCw (cycle that could invert)
const TYPE_META: Record<
  SignalType,
  { label: string; Glyph: typeof Hexagon }
> = {
  cascade_vulnerability: { label: "Cascade risk", Glyph: AlertTriangle },
  structural_hole: { label: "Missing link", Glyph: Link2Off },
  hidden_variable: { label: "Hidden mediator", Glyph: Hexagon },
  flip_prone_loop: { label: "Flip-prone loop", Glyph: RefreshCw },
};

// Validators for the tldraw RecordProps. Must match the union members
// declared on HiddenSignalShape in types.ts exactly.
const VALID_SIGNAL_TYPES: readonly SignalType[] = [
  "cascade_vulnerability",
  "structural_hole",
  "hidden_variable",
  "flip_prone_loop",
] as const;

const VALID_SEVERITIES: readonly Severity[] = [
  "critical",
  "moderate",
  "low",
] as const;

const VALID_STATUSES: readonly Status[] = [
  "active",
  "dismissed",
  "investigating",
  "resolved",
] as const;

export class HiddenSignalShapeUtil extends BaseBoxShapeUtil<HiddenSignalShape> {
  static override type = "hidden-signal" as const;
  static override props: RecordProps<HiddenSignalShape> = {
    w: T.number,
    h: T.number,
    signalId: T.string,
    spaceId: T.string,
    signalType: T.literalEnum(...VALID_SIGNAL_TYPES),
    signalName: T.string,
    description: T.string,
    trajectoryImpact: T.number,
    confidence: T.number,
    severity: T.literalEnum(...VALID_SEVERITIES),
    // tldraw shape props must be primitives — arrays of strings are
    // allowed via T.arrayOf, so primary/secondary entity IDs are
    // stored as native arrays (NOT JSON strings).
    primaryEntityIds: T.arrayOf(T.string),
    secondaryEntityIds: T.arrayOf(T.string),
    reasoning: T.string,
    validationAction: T.string,
    status: T.literalEnum(...VALID_STATUSES),
    emittedAt: T.string,
    expanded: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: HiddenSignalShape,
    info: TLResizeInfo<HiddenSignalShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): HiddenSignalShape["props"] {
    return {
      w: HIDDEN_SIGNAL_DEFAULT_W,
      h: HIDDEN_SIGNAL_DEFAULT_H,
      signalId: "",
      spaceId: "",
      signalType: "cascade_vulnerability",
      signalName: "Untitled signal",
      description: "",
      trajectoryImpact: 0,
      confidence: 0,
      severity: "low",
      primaryEntityIds: [],
      secondaryEntityIds: [],
      reasoning: "",
      validationAction: "",
      status: "active",
      emittedAt: new Date().toISOString(),
      expanded: 0,
    };
  }

  component(shape: HiddenSignalShape) {
    return <HiddenSignalShapeView shape={shape} />;
  }

  indicator(shape: HiddenSignalShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />;
  }
}

function HiddenSignalShapeView({ shape }: { shape: HiddenSignalShape }) {
  const {
    w,
    h,
    signalType,
    signalName,
    description,
    trajectoryImpact,
    confidence,
    severity,
    primaryEntityIds,
    secondaryEntityIds,
    reasoning,
    validationAction,
    status,
    expanded,
  } = shape.props;

  const sevMeta = SEVERITY_META[severity];
  const typeMeta = TYPE_META[signalType];
  const isExpanded = expanded === 1;
  const isDismissed = status === "dismissed";
  const isCritical = severity === "critical" && status === "active";

  // ── Local hover dispatch ──
  // Reuses the existing `strategy-hover:entities` event the
  // CanvasEntityGlowResponder listens for so kg-node shapes whose
  // entityId matches a primary or secondary id light up briefly.
  // Decoupled via window events so this shape doesn't need the
  // editor instance.
  const handleHoverEnter = useCallback(() => {
    if (typeof window === "undefined") return;
    const allEntityIds = [...primaryEntityIds, ...secondaryEntityIds].filter(
      Boolean,
    );
    if (allEntityIds.length === 0) return;
    window.dispatchEvent(
      new CustomEvent("strategy-hover:entities", {
        detail: { entity_ids: allEntityIds },
      }),
    );
  }, [primaryEntityIds, secondaryEntityIds]);

  // Click — pan camera to the primary anchor entity. Uses the same
  // `strategy-click:entity` event the strategy tactics already
  // dispatch; the responder handles smooth easing.
  const handleEntityClick = useCallback(
    (entityId: string) => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("strategy-click:entity", {
          detail: { entity_id: entityId },
        }),
      );
    },
    [],
  );

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
      }}
    >
      <div
        onMouseEnter={handleHoverEnter}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 10,
          overflow: "hidden",
          background: isCritical
            ? `linear-gradient(180deg, ${sevMeta.bg}, rgba(255, 255, 255, 0.96))`
            : "rgba(255, 255, 255, 0.96)",
          backdropFilter: "blur(10px)",
          border: `1px solid ${sevMeta.color}${isCritical ? "55" : "30"}`,
          boxShadow: isCritical
            ? `0 0 0 3px ${sevMeta.ring}, 0 10px 24px -8px ${sevMeta.color}44`
            : `0 4px 14px -6px ${sevMeta.color}22, 0 1px 3px rgba(8, 60, 180, 0.04)`,
          opacity: isDismissed ? 0.45 : 1,
          padding: "10px 12px 10px 16px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          display: "flex",
          flexDirection: "column",
          gap: 6,
          transition: "opacity 200ms ease",
        }}
      >
        {/* Left accent rail — hexagonal-feel via the rounded radius
            on the rail end. Mirrors signal-flag-shape's rail. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 3,
            background: sevMeta.color,
            borderRadius: 2,
            boxShadow: isCritical ? `0 0 14px ${sevMeta.color}88` : "none",
          }}
        />

        {/* Header row: type label + entity chips + severity pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexWrap: "wrap",
          }}
        >
          <typeMeta.Glyph
            style={{
              width: 11,
              height: 11,
              color: sevMeta.color,
              flexShrink: 0,
            }}
            aria-hidden
            strokeWidth={2.4}
          />
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            {typeMeta.label}
          </span>
          {primaryEntityIds.slice(0, 2).map((eid) => (
            <button
              key={eid}
              data-no-expand
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleEntityClick(eid);
              }}
              style={{
                padding: "1px 5px",
                borderRadius: 3,
                background: `${sevMeta.color}14`,
                color: sevMeta.color,
                fontSize: 9,
                fontWeight: 700,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                border: "none",
                cursor: "pointer",
              }}
              title={`Click to pan camera to ${eid}`}
            >
              {eid}
            </button>
          ))}
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "1px 6px",
              borderRadius: 3,
              background: sevMeta.bg,
              color: sevMeta.color,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {sevMeta.label}
          </span>
        </div>

        {/* Title — the signal name (e.g. "Cascade risk: User Trust") */}
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.3,
            color: "#1e293b",
            display: "-webkit-box",
            WebkitLineClamp: isExpanded ? 3 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          title={signalName}
        >
          {signalName}
        </div>

        {/* Description — only shown collapsed if there's room (small
            footprint), and always shown expanded */}
        {(description && (isExpanded || h >= 100)) && (
          <div
            style={{
              fontSize: 10.5,
              lineHeight: 1.45,
              color: "#475569",
              display: "-webkit-box",
              WebkitLineClamp: isExpanded ? 4 : 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {description}
          </div>
        )}

        {/* Expanded-only body: reasoning + validation + actions */}
        {isExpanded && (
          <ExpandedBody
            reasoning={reasoning}
            validationAction={validationAction}
            trajectoryImpact={trajectoryImpact}
            confidence={confidence}
            sevColor={sevMeta.color}
            secondaryEntityIds={secondaryEntityIds}
            onEntityClick={handleEntityClick}
            status={status}
            shapeId={shape.id}
          />
        )}

        {/* Footer: impact + confidence meters + dismiss action */}
        {!isExpanded && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: "auto",
              fontSize: 9,
              color: "#94a3b8",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "0.04em",
            }}
          >
            <TrendingDown
              style={{ width: 9, height: 9, color: sevMeta.color }}
              aria-hidden
              strokeWidth={2.4}
            />
            <span title="trajectory_impact × confidence">
              {(trajectoryImpact * confidence * 100).toFixed(0)}% urgency
            </span>
            {isDismissed && (
              <span
                style={{
                  marginLeft: "auto",
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  fontSize: 8,
                  letterSpacing: "0.12em",
                }}
              >
                Dismissed
              </span>
            )}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

// ── ExpandedBody ──
//
// The detail-view content shown when expanded === 1. Renders the
// reasoning, validation action CTA, urgency meters, secondary
// entity chips, and dismiss/investigate buttons. Pulled out as a
// component so the collapsed render path stays cheap.

function ExpandedBody({
  reasoning,
  validationAction,
  trajectoryImpact,
  confidence,
  sevColor,
  secondaryEntityIds,
  onEntityClick,
  status,
  shapeId,
}: {
  reasoning: string;
  validationAction: string;
  trajectoryImpact: number;
  confidence: number;
  sevColor: string;
  secondaryEntityIds: string[];
  onEntityClick: (eid: string) => void;
  status: Status;
  shapeId: string;
}) {
  const [pendingStatus, setPendingStatus] = useState<Status | null>(null);

  // Dismiss / investigate update the shape's status prop. The painter
  // doesn't re-emit on user actions — the change lives entirely on the
  // tldraw shape meta (persisted with the canvas snapshot). Future:
  // could write a `hidden_signal_dismissals` table for cross-session
  // dismissals, but not needed for Phase 1.
  const handleStatusChange = useCallback(
    (next: Status) => {
      setPendingStatus(next);
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("hidden-signal:status-change", {
          detail: { shapeId, status: next },
        }),
      );
    },
    [shapeId],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>
      {/* Reasoning */}
      {reasoning && (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            color: "rgba(11,13,18,0.78)",
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(248, 250, 252, 0.7)",
            border: "1px solid rgba(15, 23, 42, 0.05)",
          }}
        >
          {reasoning}
        </div>
      )}

      {/* Secondary entity chips — usually downstream entities for
          cascade, or cycle members for flip-prone loops. Each is
          clickable to pan camera. */}
      {secondaryEntityIds.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#94a3b8",
            }}
          >
            Related entities
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {secondaryEntityIds.slice(0, 6).map((eid) => (
              <button
                key={eid}
                data-no-expand
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onEntityClick(eid);
                }}
                style={{
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(241, 245, 249, 0.8)",
                  color: "#475569",
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  border: "1px solid rgba(15, 23, 42, 0.06)",
                  cursor: "pointer",
                }}
                title={`Pan camera to ${eid}`}
              >
                {eid}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Validation action — green pill, the "what to do" CTA */}
      {validationAction && (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.45,
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(16, 185, 129, 0.06)",
            color: "#047857",
            border: "1px solid rgba(16, 185, 129, 0.18)",
          }}
        >
          <span style={{ fontWeight: 700 }}>Validate: </span>
          {validationAction}
        </div>
      )}

      {/* Urgency meter — bar showing trajectory_impact × confidence */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 9,
          color: "#64748b",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        <span>impact {(trajectoryImpact * 100).toFixed(0)}%</span>
        <span style={{ color: "#cbd5e1" }}>·</span>
        <span>confidence {(confidence * 100).toFixed(0)}%</span>
      </div>

      {/* Action row: investigate / dismiss */}
      <div
        style={{
          display: "flex",
          gap: 5,
          paddingTop: 6,
          borderTop: "1px solid rgba(15, 23, 42, 0.06)",
        }}
      >
        <button
          data-no-expand
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleStatusChange("investigating");
          }}
          disabled={status === "investigating" || pendingStatus !== null}
          style={{
            flex: 1,
            padding: "5px 8px",
            borderRadius: 5,
            fontSize: 10,
            fontWeight: 700,
            color: status === "investigating" ? "#fff" : sevColor,
            background:
              status === "investigating" ? sevColor : `${sevColor}14`,
            border: `1px solid ${sevColor}55`,
            cursor:
              status === "investigating" || pendingStatus !== null
                ? "default"
                : "pointer",
          }}
        >
          {status === "investigating" ? "Investigating" : "Investigate"}
        </button>
        <button
          data-no-expand
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleStatusChange(status === "dismissed" ? "active" : "dismissed");
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "5px 8px",
            borderRadius: 5,
            fontSize: 10,
            fontWeight: 600,
            color: "#64748b",
            background: "rgba(248, 250, 252, 0.7)",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            cursor: "pointer",
          }}
          title={status === "dismissed" ? "Restore" : "Dismiss this signal"}
        >
          <XIcon style={{ width: 10, height: 10 }} strokeWidth={2.4} />
          {status === "dismissed" ? "Restore" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}

// ── Hidden signal cluster shape ──
//
// Aggregates the long tail of suppressed lower-priority signals into
// one compact chip parked in the canvas margin. Click expands a
// side-panel listing the suppressed signals individually (Phase 2
// work; the side-panel ships separately).
//
// One per space per run; the painter upserts on clusterId so Pass 2's
// cluster replaces Pass 1's rather than stacking. Small static
// footprint — no expand toggle, no per-signal data, just a count +
// type breakdown.

export const HIDDEN_SIGNAL_CLUSTER_W = 220;
export const HIDDEN_SIGNAL_CLUSTER_H = 56;

export class HiddenSignalClusterShapeUtil extends BaseBoxShapeUtil<HiddenSignalClusterShape> {
  static override type = "hidden-signal-cluster" as const;
  static override props: RecordProps<HiddenSignalClusterShape> = {
    w: T.number,
    h: T.number,
    clusterId: T.string,
    spaceId: T.string,
    suppressedCount: T.number,
    topTypes: T.arrayOf(T.string),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: HiddenSignalClusterShape,
    info: TLResizeInfo<HiddenSignalClusterShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): HiddenSignalClusterShape["props"] {
    return {
      w: HIDDEN_SIGNAL_CLUSTER_W,
      h: HIDDEN_SIGNAL_CLUSTER_H,
      clusterId: "",
      spaceId: "",
      suppressedCount: 0,
      topTypes: [],
    };
  }

  component(shape: HiddenSignalClusterShape) {
    return <HiddenSignalClusterShapeView shape={shape} />;
  }

  indicator(shape: HiddenSignalClusterShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }
}

function HiddenSignalClusterShapeView({
  shape,
}: {
  shape: HiddenSignalClusterShape;
}) {
  const { w, h, suppressedCount, topTypes } = shape.props;

  // Dispatch an event a future side-panel can listen for to open the
  // full suppressed-signals list. No panel exists yet; click for now
  // just fires the event so the wiring is in place for Phase 2.
  const handleClick = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("hidden-signal-cluster:open", {
        detail: { clusterId: shape.props.clusterId, spaceId: shape.props.spaceId },
      }),
    );
  }, [shape.props.clusterId, shape.props.spaceId]);

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
      }}
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 8,
          background: "rgba(255, 255, 255, 0.92)",
          border: "1px dashed rgba(100, 116, 139, 0.3)",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
          cursor: "pointer",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          color: "#475569",
        }}
        title="Click to view all suppressed signals"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Hexagon
            style={{ width: 11, height: 11, color: "#64748b" }}
            aria-hidden
            strokeWidth={2.2}
          />
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#94a3b8",
            }}
          >
            +{suppressedCount} more signals
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            lineHeight: 1.4,
            color: "#64748b",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {topTypes.length > 0
            ? topTypes.join(" · ")
            : "Lower-priority structural findings"}
        </div>
      </div>
    </HTMLContainer>
  );
}

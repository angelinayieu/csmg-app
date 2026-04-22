"use client";

// ── Bridge link shape (Phase A1.3) ──
//
// Cross-space shared-variable link, surfaced as a two-endpoint ribbon
// card. Reuses the Phase 37 synthesis-feed visual grammar: coupling
// strength shown as a 3-bar indicator, direction arrow encodes
// source→target / source←target / bidirectional, confidence as a
// right-aligned percent.
//
// Click → navigates to the partner entity's node lab.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Network } from "lucide-react";
import type { BridgeLinkShape } from "./types";

const COUPLING_BARS: Record<string, number> = {
  strong: 3,
  moderate: 2,
  weak: 1,
};

const VALID_STRENGTH = ["strong", "moderate", "weak"] as const;
const VALID_DIRECTION = [
  "source_to_target",
  "target_to_source",
  "bidirectional",
] as const;

const BRIDGE_ACCENT = "#22d3ee"; // cyan — matches the Phase 37 synthesis palette

export class BridgeLinkShapeUtil extends BaseBoxShapeUtil<BridgeLinkShape> {
  static override type = "bridge-link" as const;
  static override props: RecordProps<BridgeLinkShape> = {
    w: T.number,
    h: T.number,
    bridgeId: T.string,
    spaceId: T.string,
    sharedVariable: T.string,
    sourceLabel: T.string,
    targetLabel: T.string,
    couplingStrength: T.literalEnum(...VALID_STRENGTH),
    couplingDirection: T.literalEnum(...VALID_DIRECTION),
    confidence: T.number,
    partnerEntityId: T.string.nullable(),
    partnerSpaceId: T.string.nullable(),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: BridgeLinkShape, info: TLResizeInfo<BridgeLinkShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): BridgeLinkShape["props"] {
    return {
      w: 260,
      h: 128,
      bridgeId: "",
      spaceId: "",
      sharedVariable: "(shared variable)",
      sourceLabel: "This space",
      targetLabel: "Partner",
      couplingStrength: "moderate",
      couplingDirection: "bidirectional",
      confidence: 0.7,
      partnerEntityId: null,
      partnerSpaceId: null,
    };
  }

  component(shape: BridgeLinkShape) {
    return <BridgeLinkShapeView shape={shape} />;
  }

  indicator(shape: BridgeLinkShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function BridgeLinkShapeView({ shape }: { shape: BridgeLinkShape }) {
  const {
    sharedVariable,
    sourceLabel,
    targetLabel,
    couplingStrength,
    couplingDirection,
    confidence,
    partnerEntityId,
    partnerSpaceId,
  } = shape.props;

  const strengthBars = COUPLING_BARS[couplingStrength] ?? 1;
  const arrow =
    couplingDirection === "source_to_target"
      ? "→"
      : couplingDirection === "target_to_source"
        ? "←"
        : "↔";

  const navHref =
    partnerEntityId && partnerSpaceId
      ? `/app/space/${partnerSpaceId}/entity/${partnerEntityId}/lab`
      : partnerSpaceId
        ? `/app/space/${partnerSpaceId}/whiteboard`
        : "";

  const confPct = Math.round(confidence * 100);

  return (
    <HTMLContainer
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 14,
          overflow: "hidden",
          background: "rgba(255, 255, 255, 0.94)",
          backdropFilter: "blur(12px)",
          border: `1px solid ${BRIDGE_ACCENT}40`,
          boxShadow: `0 8px 22px -8px ${BRIDGE_ACCENT}33, 0 3px 10px rgba(8, 60, 180, 0.06)`,
          padding: "12px 14px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          cursor: navHref ? "pointer" : "default",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (!navHref) return;
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey || e.button === 1) {
            window.open(navHref, "_blank");
          } else {
            window.location.href = navHref;
          }
        }}
      >
        {/* Left accent rail */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: BRIDGE_ACCENT,
            boxShadow: `0 0 12px ${BRIDGE_ACCENT}66`,
          }}
        />

        {/* Header: chip + strength bars + confidence */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: 3,
              background: `${BRIDGE_ACCENT}22`,
              color: BRIDGE_ACCENT,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            <Network style={{ width: 9, height: 9 }} />
            Bridge
          </span>
          <span
            aria-label={`${couplingStrength} coupling`}
            style={{ display: "inline-flex", gap: 2 }}
            title={`${couplingStrength} coupling`}
          >
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 4,
                  height: 10,
                  borderRadius: 1,
                  background:
                    i <= strengthBars
                      ? BRIDGE_ACCENT
                      : "rgba(34, 211, 238, 0.18)",
                  boxShadow:
                    i <= strengthBars ? `0 0 3px ${BRIDGE_ACCENT}55` : "none",
                }}
              />
            ))}
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              fontWeight: 700,
              color: BRIDGE_ACCENT,
              fontVariantNumeric: "tabular-nums",
            }}
            title="Confidence"
          >
            {confPct}%
          </span>
        </div>

        {/* Endpoints */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            fontWeight: 700,
            lineHeight: 1.3,
            color: "#0a1020",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              color: "#16a34a",
              maxWidth: "45%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={sourceLabel}
          >
            {sourceLabel}
          </span>
          <span
            style={{ color: "#475569", fontWeight: 500, fontSize: 13 }}
            aria-hidden
          >
            {arrow}
          </span>
          <span
            style={{
              color: BRIDGE_ACCENT,
              maxWidth: "45%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={targetLabel}
          >
            {targetLabel}
          </span>
        </div>

        {/* Shared variable */}
        <div
          style={{
            fontSize: 10.5,
            lineHeight: 1.45,
            color: "#64748b",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            marginTop: "auto",
          }}
          title={sharedVariable}
        >
          <span style={{ color: "#94a3b8", marginRight: 4 }}>shared:</span>
          <span style={{ color: "#0a1020", fontWeight: 600 }}>
            {sharedVariable}
          </span>
        </div>

        {navHref && (
          <span
            style={{
              position: "absolute",
              right: 12,
              bottom: 10,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: BRIDGE_ACCENT,
            }}
          >
            Open partner →
          </span>
        )}
      </div>
    </HTMLContainer>
  );
}

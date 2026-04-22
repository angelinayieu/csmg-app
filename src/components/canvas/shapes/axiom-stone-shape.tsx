"use client";

// ── Axiom stone shape (Phase A1.4a) ──
//
// Axioms are load-bearing reasoning statements — the foundations the
// synthesis is built on. Visual treatment: typographic block,
// monument-like. Accent by load_bearing (critical/important/moderate),
// visibility badge (EXPLICIT/IMPLICIT/HIDDEN), and an "if false →"
// consequence line because the whole point of naming axioms is to
// stress-test them.
//
// Axioms regenerate on synthesis passes so there's no reliable deep
// link; the shape renders the full claim + if_false + rests_on at drop
// time so it survives future re-synthesis.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Anchor, Eye, EyeOff, AlertTriangle } from "lucide-react";
import type { AxiomStoneShape } from "./types";

type Visibility = AxiomStoneShape["props"]["visibility"];
type LoadBearing = AxiomStoneShape["props"]["loadBearing"];
type Scope = AxiomStoneShape["props"]["scope"];
type Confidence = AxiomStoneShape["props"]["confidence"];

const LOAD_META: Record<
  LoadBearing,
  { label: string; color: string; bg: string }
> = {
  critical: { label: "Critical", color: "#d97706", bg: "#fef3c7" },
  important: { label: "Important", color: "#0891b2", bg: "#cffafe" },
  moderate: { label: "Moderate", color: "#64748b", bg: "#f1f5f9" },
};

const VISIBILITY_META: Record<
  Visibility,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  }
> = {
  EXPLICIT: { label: "Explicit", color: "#16a34a", icon: Eye },
  IMPLICIT: { label: "Implicit", color: "#d97706", icon: Eye },
  HIDDEN: { label: "Hidden", color: "#db2777", icon: EyeOff },
};

const VALID_VISIBILITY: readonly Visibility[] = [
  "EXPLICIT",
  "IMPLICIT",
  "HIDDEN",
] as const;
const VALID_LOAD: readonly LoadBearing[] = [
  "critical",
  "important",
  "moderate",
] as const;
const VALID_SCOPE: readonly Scope[] = [
  "node",
  "edge",
  "chain",
  "frame",
] as const;
const VALID_CONFIDENCE: readonly Confidence[] = [
  "high",
  "medium",
  "low",
] as const;

export class AxiomStoneShapeUtil extends BaseBoxShapeUtil<AxiomStoneShape> {
  static override type = "axiom-stone" as const;
  static override props: RecordProps<AxiomStoneShape> = {
    w: T.number,
    h: T.number,
    axiomId: T.string,
    spaceId: T.string,
    claim: T.string,
    ifFalse: T.string,
    visibility: T.literalEnum(...VALID_VISIBILITY),
    loadBearing: T.literalEnum(...VALID_LOAD),
    scope: T.literalEnum(...VALID_SCOPE),
    confidence: T.literalEnum(...VALID_CONFIDENCE),
    restsOn: T.arrayOf(T.string),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: AxiomStoneShape, info: TLResizeInfo<AxiomStoneShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): AxiomStoneShape["props"] {
    return {
      w: 280,
      h: 160,
      axiomId: "A?",
      spaceId: "",
      claim: "Untitled axiom",
      ifFalse: "",
      visibility: "EXPLICIT",
      loadBearing: "moderate",
      scope: "frame",
      confidence: "medium",
      restsOn: [],
    };
  }

  component(shape: AxiomStoneShape) {
    return <AxiomStoneShapeView shape={shape} />;
  }

  indicator(shape: AxiomStoneShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} ry={10} />;
  }
}

function AxiomStoneShapeView({ shape }: { shape: AxiomStoneShape }) {
  const {
    axiomId,
    claim,
    ifFalse,
    visibility,
    loadBearing,
    scope,
    confidence,
    restsOn,
  } = shape.props;

  const loadMeta = LOAD_META[loadBearing];
  const visMeta = VISIBILITY_META[visibility];
  const VisIcon = visMeta.icon;

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
          borderRadius: 10,
          overflow: "hidden",
          // Monument-style treatment: warmer background, heavier border
          // + inner top highlight so it feels more "stone" than "card".
          background:
            "linear-gradient(180deg, rgba(254, 252, 248, 0.98) 0%, rgba(247, 244, 237, 0.96) 100%)",
          border: `1px solid ${loadMeta.color}40`,
          boxShadow: `0 8px 24px -10px ${loadMeta.color}33, inset 0 1px 0 rgba(255, 255, 255, 0.9)`,
          padding: "14px 16px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={
          restsOn.length > 0
            ? `Rests on: ${restsOn.join(", ")}`
            : undefined
        }
      >
        {/* Top accent bar (full width, load-bearing-colored) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 2,
            background: loadMeta.color,
          }}
        />

        {/* Header: axiom id stone + load + visibility */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              borderRadius: 3,
              background: loadMeta.color,
              color: "#ffffff",
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "0.16em",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            <Anchor style={{ width: 9, height: 9 }} />
            {axiomId}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 6px",
              borderRadius: 3,
              background: loadMeta.bg,
              color: loadMeta.color,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            {loadMeta.label}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              borderRadius: 3,
              background: "#f1f5f9",
              color: visMeta.color,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
            title={`Visibility: ${visMeta.label}`}
          >
            <VisIcon style={{ width: 8, height: 8 }} />
            {visibility}
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 8.5,
              color: "#94a3b8",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
            title={`Scope · Confidence`}
          >
            {scope} · {confidence}
          </span>
        </div>

        {/* Claim — the axiom itself */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.4,
            color: "#1e293b",
            letterSpacing: "-0.005em",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            flex: 1,
          }}
          title={claim}
        >
          {claim}
        </div>

        {/* If-false consequence — the stress-test */}
        {ifFalse && (
          <div
            style={{
              display: "flex",
              gap: 5,
              fontSize: 10,
              lineHeight: 1.4,
              color: "#94a3b8",
              fontStyle: "italic",
              paddingTop: 6,
              borderTop: "1px dashed rgba(148, 163, 184, 0.3)",
              alignItems: "flex-start",
            }}
            title={ifFalse}
          >
            <AlertTriangle
              style={{
                width: 10,
                height: 10,
                color: "#d97706",
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <span
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              <span style={{ color: "#475569", fontWeight: 600, marginRight: 4 }}>
                If false:
              </span>
              {ifFalse}
            </span>
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

"use client";

// ── Mechanism spec card shape (v3 — Step 19) ──
//
// The whiteboard-side representation of a v3 mechanism artifact
// (library_objects.object_type === "mechanism"). User drags this in
// from the LibraryPanel; the card lands on the whiteboard with the
// mechanism's title, design-intent caption, accent band, and an
// evidence chip — a compact "this is the designed mechanism" tile
// you can compose other shapes around.
//
// Distinct from MechanismCardShapeUtil (which is keyed to the
// legacy `mechanisms` table for twin/strategy flow). Both can
// coexist on the same canvas because tldraw shape types are
// namespaced by their static `type` string.
//
// Click → opens the entity drawer at the Experience tab so the
// user can read the full Claude-composed design artifact.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import type { MechanismSpecCardShape } from "./types";

type AccentIntent = MechanismSpecCardShape["props"]["accentIntent"];
type HeroPattern = MechanismSpecCardShape["props"]["heroPattern"];
type EvidenceStrength = MechanismSpecCardShape["props"]["evidenceStrength"];

const VALID_ACCENT: readonly AccentIntent[] = [
  "signal",
  "warning",
  "growth",
  "insight",
  "neutral",
] as const;

const VALID_HERO: readonly HeroPattern[] = [
  "metric",
  "flow",
  "cycle",
  "before_after",
  "evidence",
  "decision",
] as const;

const VALID_EVIDENCE: readonly EvidenceStrength[] = [
  "established",
  "plausible",
  "speculative",
] as const;

// Color tokens — match the Step 16 design-artifact view + the brief
// renderer (one accent at a time, hairline borders, glass card).
const ACCENT_META: Record<
  AccentIntent,
  { primary: string; tint: string; ink: string }
> = {
  signal: {
    primary: "rgba(10,132,255,1)",
    tint: "rgba(10,132,255,0.10)",
    ink: "rgba(28,71,135,0.95)",
  },
  warning: {
    primary: "rgba(217,119,6,1)",
    tint: "rgba(217,119,6,0.10)",
    ink: "rgba(146,64,14,0.95)",
  },
  growth: {
    primary: "rgba(22,163,74,1)",
    tint: "rgba(22,163,74,0.10)",
    ink: "rgba(22,101,52,0.95)",
  },
  insight: {
    primary: "rgba(124,58,237,1)",
    tint: "rgba(124,58,237,0.10)",
    ink: "rgba(67,33,138,0.95)",
  },
  neutral: {
    primary: "rgba(15,23,42,0.78)",
    tint: "rgba(15,23,42,0.05)",
    ink: "rgba(15,23,42,0.62)",
  },
};

const HERO_LABEL: Record<HeroPattern, string> = {
  metric: "Moves a metric",
  flow: "Transforms in a flow",
  cycle: "Feedback loop",
  before_after: "Changes a state",
  evidence: "Grounds in evidence",
  decision: "Branches by decision",
};

const EVIDENCE_META: Record<
  EvidenceStrength,
  { label: string; color: string }
> = {
  established: { label: "Established", color: "rgba(22,101,52,0.95)" },
  plausible: { label: "Plausible", color: "rgba(15,23,42,0.55)" },
  speculative: { label: "Speculative", color: "rgba(146,64,14,0.95)" },
};

export const MECHANISM_SPEC_CARD_DEFAULT_W = 248;
export const MECHANISM_SPEC_CARD_DEFAULT_H = 132;

export class MechanismSpecCardShapeUtil extends BaseBoxShapeUtil<MechanismSpecCardShape> {
  static override type = "mechanism-spec-card" as const;
  static override props: RecordProps<MechanismSpecCardShape> = {
    w: T.number,
    h: T.number,
    objectId: T.string,
    sourceEntityId: T.string.nullable(),
    sourceSubObjectiveId: T.string.nullable(),
    title: T.string,
    caption: T.string,
    accentIntent: T.literalEnum(...VALID_ACCENT),
    heroPattern: T.literalEnum(...VALID_HERO),
    evidenceStrength: T.literalEnum(...VALID_EVIDENCE),
    sectionCount: T.number,
    designArtifactJson: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: MechanismSpecCardShape,
    info: TLResizeInfo<MechanismSpecCardShape>,
  ) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): MechanismSpecCardShape["props"] {
    return {
      w: MECHANISM_SPEC_CARD_DEFAULT_W,
      h: MECHANISM_SPEC_CARD_DEFAULT_H,
      objectId: "",
      sourceEntityId: null,
      sourceSubObjectiveId: null,
      title: "Mechanism",
      caption: "Designed mechanism",
      accentIntent: "neutral",
      heroPattern: "flow",
      evidenceStrength: "plausible",
      sectionCount: 0,
      designArtifactJson: "",
    };
  }

  component(shape: MechanismSpecCardShape) {
    const accent = ACCENT_META[shape.props.accentIntent];
    const heroLabel = HERO_LABEL[shape.props.heroPattern];
    const evidence = EVIDENCE_META[shape.props.evidenceStrength];
    const hasArtifact = shape.props.sectionCount > 0;

    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          background: "rgba(255,255,255,0.86)",
          backdropFilter: "blur(18px) saturate(1.5)",
          WebkitBackdropFilter: "blur(18px) saturate(1.5)",
          border: "1px solid rgba(255,255,255,0.55)",
          borderRadius: 18,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.72) inset, 0 12px 30px -14px rgba(11,18,40,0.20)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          position: "relative",
          overflow: "hidden",
          pointerEvents: "all",
        }}
      >
        {/* Accent band — top, full-width, hairline */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: accent.primary,
            opacity: 0.85,
          }}
        />
        {/* Ambient corner halo in the accent tint */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -28,
            right: -28,
            width: 100,
            height: 100,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accent.tint} 0%, transparent 70%)`,
            filter: "blur(8px)",
            pointerEvents: "none",
          }}
        />

        {/* Eyebrow — hero pattern caption */}
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: accent.ink,
            lineHeight: 1.2,
          }}
        >
          {heroLabel}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.25,
            color: "rgba(15,23,42,0.92)",
            letterSpacing: "-0.01em",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {shape.props.title}
        </div>

        {/* Caption — design intent */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 300,
            lineHeight: 1.4,
            color: "rgba(15,23,42,0.62)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {shape.props.caption}
        </div>

        {/* Footer row — evidence + artifact chip */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              color: evidence.color,
            }}
          >
            {evidence.label}
          </span>
          {hasArtifact && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: accent.ink,
                background: accent.tint,
                padding: "2px 6px",
                borderRadius: 999,
              }}
            >
              {shape.props.sectionCount} sections
            </span>
          )}
        </div>
      </HTMLContainer>
    );
  }

  indicator(shape: MechanismSpecCardShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={18}
        ry={18}
        fill="none"
      />
    );
  }
}

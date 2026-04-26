"use client";

// ── Convergent fan shape (Phase A1.4b) ──
//
// A convergent point = (focal, interactors, conditions) → outcome.
// Visual metaphor: a fan — focal on the left, interactors fanning in
// from the right, outcome at the bottom. Polarity drives accent color:
// positive = green, negative = pink, neutral = slate, conditional =
// amber.
//
// Click → opens the focal entity's lab (the outcome is scoped to it).

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Focus, ArrowRight } from "lucide-react";
import type { ConvergentFanShape } from "./types";
import type { OutcomePolarity } from "@/types/convergent-point";
import { GroundingBadge } from "@/components/ui/grounding-badge";

const POLARITY_META: Record<
  OutcomePolarity,
  { color: string; bg: string; symbol: string }
> = {
  positive: { color: "#16a34a", bg: "#dcfce7", symbol: "+" },
  negative: { color: "#db2777", bg: "#fce7f3", symbol: "−" },
  neutral: { color: "#64748b", bg: "#f1f5f9", symbol: "·" },
  conditional: { color: "#d97706", bg: "#fef3c7", symbol: "?" },
};

const VALID_POLARITIES: readonly OutcomePolarity[] = [
  "positive",
  "negative",
  "neutral",
  "conditional",
] as const;

export class ConvergentFanShapeUtil extends BaseBoxShapeUtil<ConvergentFanShape> {
  static override type = "convergent-fan" as const;
  static override props: RecordProps<ConvergentFanShape> = {
    w: T.number,
    h: T.number,
    pointId: T.string,
    spaceId: T.string,
    focalEntityId: T.string,
    focalName: T.string,
    interactorNames: T.arrayOf(T.string),
    outcome: T.string,
    polarity: T.literalEnum(...VALID_POLARITIES),
    probability: T.number,
    confidence: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: ConvergentFanShape, info: TLResizeInfo<ConvergentFanShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): ConvergentFanShape["props"] {
    return {
      w: 280,
      h: 144,
      pointId: "",
      spaceId: "",
      focalEntityId: "",
      focalName: "Untitled focal",
      interactorNames: [],
      outcome: "",
      polarity: "neutral",
      probability: 0.5,
      confidence: 0.5,
    };
  }

  component(shape: ConvergentFanShape) {
    return <ConvergentFanShapeView shape={shape} />;
  }

  indicator(shape: ConvergentFanShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

function ConvergentFanShapeView({ shape }: { shape: ConvergentFanShape }) {
  const {
    spaceId,
    focalEntityId,
    focalName,
    interactorNames,
    outcome,
    polarity,
    probability,
    confidence,
  } = shape.props;

  const meta = POLARITY_META[polarity];
  const probPct = Math.round(probability * 100);
  const confPct = Math.round(confidence * 100);
  const navHref =
    spaceId && focalEntityId
      ? `/app/space/${spaceId}/entity/${focalEntityId}/lab`
      : "";

  // Interactor chips — up to 3 visible, rest collapsed to "+N".
  const visibleInteractors = interactorNames.slice(0, 3);
  const overflow = interactorNames.length - visibleInteractors.length;

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
          border: `1px solid ${meta.color}30`,
          boxShadow: `0 8px 22px -8px ${meta.color}22, 0 3px 10px rgba(8, 60, 180, 0.06)`,
          padding: "12px 14px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          cursor: navHref ? "pointer" : "default",
          display: "flex",
          flexDirection: "column",
          gap: 6,
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
        {/* Phase 4 follow-on — quick "Inspect" button that fires the
            entity-detail drawer on the focal. The drawer's "Save as
            system" gesture handles promoting the convergent's
            neighborhood to a saved System without us duplicating
            the API calls or classification logic here. Floats top-
            right so it doesn't fight the main click target. */}
        {focalEntityId && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              try {
                window.dispatchEvent(
                  new CustomEvent("shell-graph:focus", {
                    detail: { entityId: focalEntityId, name: focalName },
                  }),
                );
              } catch {
                /* no-op */
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              zIndex: 2,
              padding: "2px 6px",
              borderRadius: 4,
              border: `1px solid ${meta.color}40`,
              background: `${meta.color}10`,
              color: meta.color,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
            title={`Inspect ${focalName} — opens drawer where you can Save as system.`}
          >
            ⌖ Inspect
          </button>
        )}
        {/* Left accent rail */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: meta.color,
            boxShadow: `0 0 12px ${meta.color}55`,
          }}
        />

        {/* Header: chip + plausibility + grounding badge.
            The two numbers were labeled "Probability / Confidence"
            and read as if calibrated statistics. They're LLM-returned
            self-assessments — honest renaming to "Plausibility"
            (outcome score) + grounding badge tells the user what
            kind of number this is. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: 3,
              background: meta.bg,
              color: meta.color,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            <Focus style={{ width: 9, height: 9 }} />
            Convergence {meta.symbol}
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              fontWeight: 700,
              color: meta.color,
              fontVariantNumeric: "tabular-nums",
            }}
            title={`Plausibility ${probPct}% · LLM self-assessed confidence ${confPct}%. These numbers are uncalibrated — treat as reasoning aid, not statistical prediction.`}
          >
            {probPct}%{" "}
            <span style={{ color: "#94a3b8", fontWeight: 500 }}>
              · {confPct}%
            </span>
            <GroundingBadge tier="narrative" compact />
          </span>
        </div>

        {/* Focal → outcome */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
          <span
            style={{
              padding: "2px 6px",
              borderRadius: 3,
              background: `${meta.color}12`,
              color: meta.color,
              maxWidth: "45%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={focalName}
          >
            {focalName}
          </span>
          <ArrowRight
            style={{ width: 10, height: 10, color: "#94a3b8", flexShrink: 0 }}
          />
          <span
            style={{
              color: "#0a1020",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
            title={outcome}
          >
            {outcome || "(no outcome)"}
          </span>
        </div>

        {/* Interactors fan */}
        {visibleInteractors.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 3,
              flexWrap: "wrap",
              fontSize: 9.5,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "#94a3b8",
                marginRight: 2,
              }}
            >
              with
            </span>
            {visibleInteractors.map((n, i) => (
              <span
                key={`${n}-${i}`}
                style={{
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "#f1f5f9",
                  color: "#475569",
                  fontWeight: 600,
                  maxWidth: 110,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={n}
              >
                {n}
              </span>
            ))}
            {overflow > 0 && (
              <span
                style={{
                  fontSize: 9,
                  color: "#94a3b8",
                  fontStyle: "italic",
                }}
              >
                +{overflow}
              </span>
            )}
          </div>
        )}

        {/* Footer — open hint */}
        {navHref && (
          <span
            style={{
              marginTop: "auto",
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: meta.color,
              alignSelf: "flex-end",
            }}
          >
            Inspect focal →
          </span>
        )}
      </div>
    </HTMLContainer>
  );
}

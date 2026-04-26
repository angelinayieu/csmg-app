"use client";

// ── Taxonomy Card shape (VP Project report — Phase 3) ──────────────
//
// A compact ghost card the painter drops on the canvas at the tail
// of intake, right after `taxonomy_inferred` fires. Visualizes the
// independent-variable slots the domain-inferrer picked ("Role /
// Task / Context / Constraint / Rubric" for prompts, different
// slots for recipes / routines / …) as a ring of chips around a
// central domain badge.
//
// Not persisted in tldraw — lives purely in the painter's run-scoped
// ghost tracker and is cleaned up on completion. The canonical row
// is in `experiment_taxonomies`. Double-clicking the shape deep-
// links to the detail surface (the App page's IV decomposition
// widget), but that navigation handler is wired at the canvas level
// (see `InterAxisCanvas.onDoubleClick`), not here.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import type { TaxonomyCardShape } from "./types";

const DEFAULT_W = 360;
const DEFAULT_H = 220;

export class TaxonomyCardShapeUtil extends BaseBoxShapeUtil<TaxonomyCardShape> {
  static override type = "taxonomy-card" as const;
  static override props: RecordProps<TaxonomyCardShape> = {
    w: T.number,
    h: T.number,
    taxonomyId: T.string.nullable(),
    spaceId: T.string,
    domainKey: T.string,
    artifactNoun: T.string,
    variantNoun: T.string,
    situationNoun: T.string,
    // JSON string; tldraw props schema is flat so we round-trip this
    // via JSON.parse in the component layer.
    slotsJson: T.string,
    confidence: T.number,
    accent: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: TaxonomyCardShape,
    info: TLResizeInfo<TaxonomyCardShape>,
  ) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): TaxonomyCardShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      taxonomyId: null,
      spaceId: "",
      domainKey: "generic",
      artifactNoun: "artifact",
      variantNoun: "variant",
      situationNoun: "situation",
      slotsJson: "[]",
      confidence: 0.6,
      accent: "#1a7aff",
    };
  }

  component(shape: TaxonomyCardShape) {
    return <TaxonomyCardView shape={shape} />;
  }

  indicator(shape: TaxonomyCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}

interface RenderedSlot {
  id: string;
  label: string;
  color: string;
  ordering: number;
}

function safeParseSlots(json: string): RenderedSlot[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s) =>
          s &&
          typeof s.id === "string" &&
          typeof s.label === "string" &&
          typeof s.color === "string",
      )
      .map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        ordering: typeof s.ordering === "number" ? s.ordering : 0,
      }))
      .sort((a, b) => a.ordering - b.ordering)
      .slice(0, 6);
  } catch {
    return [];
  }
}

function TaxonomyCardView({ shape }: { shape: TaxonomyCardShape }) {
  const {
    w,
    h,
    domainKey,
    artifactNoun,
    variantNoun,
    confidence,
    slotsJson,
    accent,
  } = shape.props;
  const slots = safeParseSlots(slotsJson);
  const needsReview = confidence < 0.6;

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 16,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,248,253,0.96) 100%)",
          border: "1px solid rgba(15, 40, 90, 0.08)",
          boxShadow:
            "0 18px 48px -18px rgba(15, 40, 90, 0.22), 0 4px 16px rgba(15, 40, 90, 0.06)",
          padding: "14px 16px 14px 16px",
          color: "#0a1020",
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Title row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 99,
                background: accent,
                boxShadow: `0 0 0 3px ${accent}22`,
              }}
            />
            Independent variables
          </div>
          <div
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            {domainKey.toUpperCase()} · {slots.length} SLOTS
          </div>
        </div>

        {/* Subline — what we'll be experimenting on + over */}
        <div
          style={{
            fontSize: 11.5,
            lineHeight: 1.45,
            color: "#475569",
          }}
        >
          Decomposing the <b>{artifactNoun}</b> into manipulable slots so
          each <b>{variantNoun}</b> can explore them independently.
        </div>

        {/* Slot chips */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {slots.length === 0 ? (
            <span style={{ color: "#94a3b8", fontSize: 11, fontStyle: "italic" }}>
              No slots inferred — falling back to generic.
            </span>
          ) : (
            slots.map((slot) => (
              <span
                key={slot.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 99,
                  background: `${slot.color}10`,
                  border: `1px solid ${slot.color}33`,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#0a1020",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: slot.color,
                  }}
                />
                {slot.label}
              </span>
            ))
          )}
        </div>

        {/* Footer — confidence + review hint */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              color: needsReview ? "#b45309" : "#475569",
              fontWeight: needsReview ? 700 : 500,
            }}
          >
            {needsReview
              ? "⚠ Low-confidence classification — review recommended"
              : `Confidence ${(confidence * 100).toFixed(0)}%`}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontWeight: 700,
            }}
          >
            Inferred
          </div>
        </div>
      </div>
    </HTMLContainer>
  );
}

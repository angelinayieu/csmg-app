"use client";

// ── OcCardShapeUtil — Feature / Variable cards ──
//
// The downstream decomposition cards on the objective board. Two kinds,
// one shape (distinct visual treatment per kind):
//   • feature  — a concrete capability; face = name + a sharp, info-dense
//                description of its utility.
//   • variable — a concept the work turns on; face = name + a sharp
//                definition.
//
// The face shows ONLY the concrete summary (name + body). The rich
// metadata library + knowledge graph live behind a double-click, which
// fires OPEN_CARD_DETAIL_EVENT (the board opens the expand drawer). The
// name/body are AI-refined from the card's metadata server-side and
// written back onto these props.
//
// Design: minimalist, zen. No icons. Type is conveyed by a single small
// accent dot + a sentence-case word + a soft accent-tinted glow — never a
// capital-grey eyebrow. Name is the bold near-black focal line; the body
// is smaller + lighter. Self-contained (no app context).

import { useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export type OcCardKind = "feature" | "variable";

export type OcCardShape = TLBaseShape<
  "oc-card",
  {
    w: number;
    h: number;
    kind: OcCardKind;
    /** AI-refined direct name (utility-first, no metaphors). */
    name: string;
    /** feature → concise description; variable → concise definition. */
    body: string;
    /** Backing library_objects row id ("" until persisted). */
    objectId: string;
    /** Count of attached metadata items (sources + notes), for the footer. */
    metaCount: number;
  }
>;

/** Fired on double-click — the board opens the card's expand drawer
 *  (metadata → categorized gallery → knowledge graph). */
export const OPEN_CARD_DETAIL_EVENT = "objective-board:open-card-detail";

export interface OpenCardDetail {
  objectId: string;
  shapeId: string;
  kind: OcCardKind;
  name: string;
}

/** Typed dispatcher so callers don't hand-roll the CustomEvent. */
export function openCardDetail(detail: OpenCardDetail) {
  window.dispatchEvent(new CustomEvent(OPEN_CARD_DETAIL_EVENT, { detail }));
}

// One accent per kind — a quiet identity hue (existing stage colors), used
// only for the dot + a soft glow. Everything else stays neutral.
const ACCENT: Record<OcCardKind, string> = {
  feature: appleVibe.stage.features, // #2563EB
  variable: appleVibe.stage.process, // #0D9488
};
const KIND_WORD: Record<OcCardKind, string> = {
  feature: "Feature",
  variable: "Variable",
};

export class OcCardShapeUtil extends BaseBoxShapeUtil<OcCardShape> {
  static override type = "oc-card" as const;
  static override props: RecordProps<OcCardShape> = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum("feature", "variable"),
    name: T.string,
    body: T.string,
    objectId: T.string,
    metaCount: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: OcCardShape, info: TLResizeInfo<OcCardShape>) => {
    return resizeBox(shape, info);
  };

  // Double-click opens the metadata/KG drawer (single-click stays selection,
  // which Connect / Synthesize / Converge rely on).
  override onDoubleClick = (shape: OcCardShape) => {
    openCardDetail({
      objectId: shape.props.objectId,
      shapeId: shape.id,
      kind: shape.props.kind,
      name: shape.props.name,
    });
  };

  getDefaultProps(): OcCardShape["props"] {
    return {
      w: 248,
      h: 132,
      kind: "feature",
      name: "Untitled",
      body: "",
      objectId: "",
      metaCount: 0,
    };
  }

  component(shape: OcCardShape) {
    return <OcCardRenderer shape={shape} />;
  }

  indicator(shape: OcCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function OcCardRenderer({ shape }: { shape: OcCardShape }) {
  const { kind, name, body, metaCount } = shape.props;
  const accent = ACCENT[kind];
  const [hovered, setHovered] = useState(false);

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background: appleVibe.surface.card,
          // Soft accent-tinted glow (no hard border/spine), lifts on hover.
          boxShadow: hovered
            ? `0 1px 2px rgba(11,18,40,0.05), 0 22px 48px -20px ${accent}4d, 0 10px 24px -14px rgba(11,18,40,0.18)`
            : `0 1px 2px rgba(11,18,40,0.05), 0 16px 38px -22px ${accent}3d, 0 7px 18px -14px rgba(11,18,40,0.13)`,
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
          transition: "box-shadow 220ms ease-out, transform 220ms ease-out",
          padding: "15px 17px 13px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Type marker — accent dot + sentence-case word. No caps, no icon. */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: accent,
              flex: "none",
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: appleVibe.text.tertiary,
            }}
          >
            {KIND_WORD[kind]}
          </span>
        </div>

        {/* Name — the bold near-black focal line. */}
        <div
          style={{
            marginTop: 9,
            fontSize: 15.5,
            fontWeight: 600,
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {name || "Untitled"}
        </div>

        {/* Body — description / definition: smaller + lighter. */}
        {body && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              fontWeight: 400,
              lineHeight: 1.45,
              color: appleVibe.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {body}
          </div>
        )}

        {/* Metadata footer — only when there's something attached. */}
        {metaCount > 0 && (
          <div
            style={{
              marginTop: "auto",
              paddingTop: 10,
              fontSize: 10.5,
              fontWeight: 500,
              color: appleVibe.text.faint,
            }}
          >
            {metaCount} in library
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

"use client";

// ── TechSpecCardShape ──
//
// The terminal artifact of a SpecForge run: a board card holding the
// generated TechSpec (as JSON + rendered markdown). Clicking "Open spec"
// fires OPEN_TECH_SPEC_EVENT → WhiteboardBase mounts the full-screen
// TechSpecPanel. "Build prototype" fires BUILD_PROTOTYPE_EVENT → the
// prototype stage spawns an interactive prototype card. Self-contained
// (board-bus CustomEvents, like room-card's OPEN_ROOM_EVENT) so the heavy
// panel + prototype logic stay in WhiteboardBase.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { FileText, Wand2, ArrowUpRight } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export const OPEN_TECH_SPEC_EVENT = "objective-board:open-tech-spec";
export const BUILD_PROTOTYPE_EVENT = "objective-board:build-prototype";

export interface OpenTechSpecDetail {
  specJson: string;
  markdown: string;
  title: string;
  /** The tech-spec card's id, so the prototype anchors near it. */
  shapeId: string;
}

export type TechSpecCardShape = TLBaseShape<
  "tech-spec-card",
  {
    w: number;
    h: number;
    title: string;
    /** Stringified TechSpec (kept as a string prop to avoid a giant validator). */
    specJson: string;
    markdown: string;
    featureCount: number;
    phaseCount: number;
  }
>;

export class TechSpecCardShapeUtil extends BaseBoxShapeUtil<TechSpecCardShape> {
  static override type = "tech-spec-card" as const;
  static override props: RecordProps<TechSpecCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    specJson: T.string,
    markdown: T.string,
    featureCount: T.number,
    phaseCount: T.number,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: TechSpecCardShape, info: TLResizeInfo<TechSpecCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): TechSpecCardShape["props"] {
    return {
      w: 308,
      h: 184,
      title: "Technical Specification",
      specJson: "",
      markdown: "",
      featureCount: 0,
      phaseCount: 0,
    };
  }

  component(shape: TechSpecCardShape) {
    return <TechSpecCardRenderer shape={shape} />;
  }

  indicator(shape: TechSpecCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function TechSpecCardRenderer({ shape }: { shape: TechSpecCardShape }) {
  const { title, specJson, markdown, featureCount, phaseCount } = shape.props;
  const accent = appleVibe.accent.primary;

  function openSpec(e: React.MouseEvent) {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent<OpenTechSpecDetail>(OPEN_TECH_SPEC_EVENT, {
        detail: { specJson, markdown, title, shapeId: shape.id },
      }),
    );
  }

  function buildPrototype(e: React.MouseEvent) {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent<OpenTechSpecDetail>(BUILD_PROTOTYPE_EVENT, {
        detail: { specJson, markdown, title, shapeId: shape.id },
      }),
    );
  }

  const chips = [
    featureCount > 0 ? `${featureCount} features` : null,
    phaseCount > 0 ? `${phaseCount} phases` : null,
    "UI plan",
  ].filter(Boolean) as string[];

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,0.97) 100%)",
          border: `1px solid ${accent}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 18px 48px -16px ${accent}55, 0 8px 22px -10px rgba(11,18,40,0.16)`,
          padding: "15px 16px 13px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Eyebrow */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FileText style={{ width: 13, height: 13, color: accent }} strokeWidth={2.2} />
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            Tech Spec
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            marginTop: 9,
            fontSize: 16,
            fontWeight: 700,
            lineHeight: 1.22,
            color: appleVibe.text.primary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </div>

        {/* Chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
          {chips.map((c, i) => (
            <span
              key={i}
              style={{
                padding: "3px 9px",
                borderRadius: 999,
                background: `${accent}12`,
                color: appleVibe.text.secondary,
                fontSize: 10.5,
                fontWeight: 600,
              }}
            >
              {c}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div style={{ marginTop: "auto", paddingTop: 12, display: "flex", gap: 7 }}>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={openSpec}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "7px 13px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: accent,
              color: "white",
              fontSize: 11.5,
              fontWeight: 650,
              boxShadow: `0 4px 12px -3px ${accent}88`,
            }}
          >
            Open spec
            <ArrowUpRight style={{ width: 12, height: 12 }} strokeWidth={2.6} />
          </button>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={buildPrototype}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "7px 13px",
              borderRadius: 999,
              border: `1px solid ${accent}40`,
              cursor: "pointer",
              background: "rgba(255,255,255,0.7)",
              color: accent,
              fontSize: 11.5,
              fontWeight: 650,
            }}
          >
            <Wand2 style={{ width: 12, height: 12 }} strokeWidth={2.4} />
            Build prototype
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

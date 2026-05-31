"use client";

// ── SpecForgeCardShapeUtil ──
//
// One decision card in a SpecForge unfurl (idea → clean summary → target user →
// problem cause tree → root constraint → first-principles need → desired result
// → product thesis → alternatives → differentiation → solution families → top
// MVPs → recommended first build). Distinct from `artifact-card` (a room-item
// reference): this is a causal DECISION artifact, so it gets its own restrained
// Apple-Vision-Pro chrome — white card, stage color used only as a soft accent
// glow + a folder-tab eyebrow pill + a stage dot. No flat tinted rects, no side
// spines (per the module's UI taste). Self-contained, no app context.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { useState, useEffect } from "react";
import { GripVertical } from "lucide-react";
import { CardHoverActions } from "../canvas-interactions/card-hover-actions";
import {
  dispatchCardAction,
  CARD_SAVED_EVENT,
  type CardSavedDetail,
} from "../board-bus";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { STAGE_META, type SpecForgeStage } from "@/lib/objective-canvas/specforge/types";

export type SpecForgeCardShape = TLBaseShape<
  "specforge-card",
  {
    w: number;
    h: number;
    /** One of the SpecForge stages (drives the accent). */
    stage: string;
    /** Eyebrow label override (defaults to the stage label). */
    eyebrow: string;
    title: string;
    subtitle: string;
    /** Bullet lines, "\n"-delimited (each rendered as a row). */
    body: string;
    /** Stable id so Save → Library + the saved-confirm echo work. */
    entityId: string;
  }
>;

const NEUTRAL = { label: "Decision", color: appleVibe.text.tertiary };

function stageMeta(stage: string) {
  return STAGE_META[stage as SpecForgeStage] ?? NEUTRAL;
}

export class SpecForgeCardShapeUtil extends BaseBoxShapeUtil<SpecForgeCardShape> {
  static override type = "specforge-card" as const;
  static override props: RecordProps<SpecForgeCardShape> = {
    w: T.number,
    h: T.number,
    stage: T.string,
    eyebrow: T.string,
    title: T.string,
    subtitle: T.string,
    body: T.string,
    entityId: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: SpecForgeCardShape,
    info: TLResizeInfo<SpecForgeCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): SpecForgeCardShape["props"] {
    return {
      w: 336,
      h: 150,
      stage: "input",
      eyebrow: "",
      title: "Decision",
      subtitle: "",
      body: "",
      entityId: "",
    };
  }

  component(shape: SpecForgeCardShape) {
    return <SpecForgeCardRenderer shape={shape} />;
  }

  indicator(shape: SpecForgeCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function SpecForgeCardRenderer({ shape }: { shape: SpecForgeCardShape }) {
  const { stage, eyebrow, title, subtitle, body, entityId } = shape.props;
  const meta = stageMeta(stage);
  const color = meta.color;
  const eyebrowLabel = eyebrow || meta.label;
  const isHero = stage === "recommendation";

  const lines = body
    ? body.split("\n").map((l) => l.replace(/^•\s*/, "").trim()).filter(Boolean)
    : [];

  const [hovered, setHovered] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!entityId) return;
    function onSaved(e: Event) {
      const d = (e as CustomEvent<CardSavedDetail>).detail;
      if (d?.entityId === entityId) setSaved(true);
    }
    window.addEventListener(CARD_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(CARD_SAVED_EVENT, onSaved);
  }, [entityId]);

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 20,
            background: isHero
              ? `linear-gradient(160deg, rgba(255,255,255,0.99) 0%, ${color}0E 100%)`
              : "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(248,249,252,0.97) 100%)",
            border: `1px solid ${isHero ? `${color}33` : "rgba(15,23,42,0.07)"}`,
            // The signature: a soft accent glow tinted by the stage color, over a
            // neutral depth shadow + inset top sheen. No flat fills, no spines.
            boxShadow: [
              "inset 0 1px 0 rgba(255,255,255,0.9)",
              "0 1px 2px rgba(11,18,40,0.05)",
              `0 16px 40px -18px ${color}${isHero ? "8C" : "55"}`,
              "0 6px 18px -12px rgba(11,18,40,0.16)",
            ].join(", "),
            padding: "13px 15px 12px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            fontFamily: appleVibe.font.stack,
          }}
        >
          {/* Eyebrow row — folder-tab pill + grip. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: color,
                  boxShadow: `0 0 0 2px ${color}22`,
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.01em",
                  color,
                }}
              >
                {eyebrowLabel}
              </span>
            </span>
            <GripVertical
              style={{ width: 13, height: 13, color: "rgba(15,23,42,0.22)" }}
            />
          </div>

          {/* Title */}
          <div
            style={{
              marginTop: 9,
              fontSize: isHero ? 15.5 : 14.5,
              fontWeight: 650,
              lineHeight: 1.24,
              letterSpacing: "-0.01em",
              color: appleVibe.text.primary,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {title}
          </div>

          {/* Subtitle */}
          {subtitle && (
            <div
              style={{
                marginTop: 5,
                fontSize: 11.5,
                fontWeight: 500,
                lineHeight: 1.36,
                color: appleVibe.text.secondary,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {subtitle}
            </div>
          )}

          {/* Body bullets */}
          {lines.length > 0 && (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 3,
                overflow: "hidden",
              }}
            >
              {lines.slice(0, 4).map((line, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 6,
                    fontSize: 11,
                    lineHeight: 1.32,
                    color: appleVibe.text.tertiary,
                  }}
                >
                  <span
                    style={{
                      marginTop: 5,
                      width: 3,
                      height: 3,
                      borderRadius: 999,
                      flexShrink: 0,
                      background: `${color}AA`,
                    }}
                  />
                  <span
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 1,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {line}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Per-card hover action bar — same component the room/artifact cards
            use, so a decision card can be saved to Library or pushed deeper. */}
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            left: "50%",
            transform: `translateX(-50%) translateY(${hovered ? 0 : -4}px)`,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 130ms ease-out, transform 130ms ease-out",
            zIndex: 60,
          }}
        >
          <CardHoverActions
            accent={color}
            saved={saved}
            onAction={(action) =>
              dispatchCardAction({
                action,
                entityId,
                title,
                shapeId: shape.id,
              })
            }
          />
        </div>
      </div>
    </HTMLContainer>
  );
}

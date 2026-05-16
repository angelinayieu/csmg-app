"use client";

// ── Origin Prompt shape ──
//
// The user's intake text painted as a real tldraw shape so every
// downstream painter card (kg-formation, taxonomy, root-cause,
// variants, …) can tether UP to it with a tldraw arrow. Previously
// this lived as a chrome overlay (`CanvasOriginCard`) — great for a
// pinned HUD but impossible to use as an arrow endpoint, which left
// the rest of the graph looking like it grew out of nothing.
//
// Read-only: the prompt text comes from the run that started it and
// doesn't change mid-run. The painter creates the shape on the first
// SSE event and deletes it on run cleanup alongside kg-formation.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import type { OriginPromptShape } from "./types";
import { IntakeRoomIcon } from "@/components/canvas/icons";
import { CanvasShapeGlass } from "./canvas-shape-glass";

export const ORIGIN_PROMPT_DEFAULT_W = 420;
export const ORIGIN_PROMPT_DEFAULT_H = 140;

const MAX_PREVIEW_CHARS = 260;

export class OriginPromptShapeUtil extends BaseBoxShapeUtil<OriginPromptShape> {
  static override type = "origin-prompt" as const;
  static override props: RecordProps<OriginPromptShape> = {
    w: T.number,
    h: T.number,
    promptText: T.string,
    runActive: T.boolean,
    accent: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: OriginPromptShape,
    info: TLResizeInfo<OriginPromptShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): OriginPromptShape["props"] {
    return {
      w: ORIGIN_PROMPT_DEFAULT_W,
      h: ORIGIN_PROMPT_DEFAULT_H,
      promptText: "",
      runActive: false,
      accent: "#8B5CF6",
    };
  }

  component(shape: OriginPromptShape) {
    return <OriginPromptView shape={shape} />;
  }

  indicator(shape: OriginPromptShape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />
    );
  }
}

function OriginPromptView({ shape }: { shape: OriginPromptShape }) {
  const { w, h, promptText, runActive, accent } = shape.props;
  const preview =
    promptText.length > MAX_PREVIEW_CHARS
      ? promptText.slice(0, MAX_PREVIEW_CHARS).trim() + "…"
      : promptText;

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        pointerEvents: "all",
        overflow: "hidden",
      }}
    >
      <CanvasShapeGlass
        tier="card"
        accent={accent}
        state={runActive ? "active" : "pending"}
        radius={16}
        padding="14px 18px"
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div
          aria-hidden
          style={{
            flex: "0 0 auto",
            width: 28,
            height: 28,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: runActive
              ? `color-mix(in srgb, ${accent} 16%, transparent)`
              : "rgba(15,23,42,0.04)",
            color: runActive ? accent : "#64748b",
          }}
        >
          <IntakeRoomIcon size={16} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: runActive ? accent : "#64748b",
            }}
          >
            {runActive ? "Thinking from" : "Origin"}
          </div>
          <div
            title={promptText}
            style={{
              marginTop: 4,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.45,
              color: "#1f2937",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {preview}
          </div>
        </div>
      </CanvasShapeGlass>
    </HTMLContainer>
  );
}

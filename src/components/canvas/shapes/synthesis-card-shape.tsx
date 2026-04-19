"use client";

import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLResizeInfo, resizeBox } from "tldraw";
import { Zap, AlertTriangle, RefreshCw, GitBranch, Lightbulb } from "lucide-react";
import type { SynthesisCardShape } from "./types";

const KINDS = ["leverage", "risk", "cycle", "bridge", "insight"] as const;

const KIND_STYLE: Record<
  (typeof KINDS)[number],
  { color: string; bg: string; icon: typeof Zap; label: string }
> = {
  leverage: { color: "#007AFF", bg: "#EFF6FF", icon: Zap, label: "Leverage" },
  risk: { color: "#FF3B30", bg: "#FFF0F0", icon: AlertTriangle, label: "Risk" },
  cycle: { color: "#AF52DE", bg: "#F8F0FF", icon: RefreshCw, label: "Cycle" },
  bridge: { color: "#FF9500", bg: "#FFF8F0", icon: GitBranch, label: "Bridge" },
  insight: { color: "#34C759", bg: "#F0FFF4", icon: Lightbulb, label: "Insight" },
};

export class SynthesisCardShapeUtil extends BaseBoxShapeUtil<SynthesisCardShape> {
  static override type = "synthesis-card" as const;
  static override props: RecordProps<SynthesisCardShape> = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum(...KINDS),
    title: T.string,
    body: T.string,
    sourceEntityIds: T.arrayOf(T.string),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: SynthesisCardShape, info: TLResizeInfo<SynthesisCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): SynthesisCardShape["props"] {
    return {
      w: 280,
      h: 160,
      kind: "insight",
      title: "Insight",
      body: "",
      sourceEntityIds: [],
    };
  }

  component(shape: SynthesisCardShape) {
    const style = KIND_STYLE[shape.props.kind];
    const Icon = style.icon;
    return (
      <HTMLContainer
        style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 14,
            background: "#ffffff",
            border: `1px solid ${style.color}26`,
            boxShadow: `0 1px 3px rgba(0,0,0,0.04), 0 12px 32px -8px ${style.color}33`,
            padding: "14px 16px",
            overflow: "hidden",
            fontFamily:
              '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: style.color,
            }}
          />
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 8px",
              borderRadius: 4,
              background: style.bg,
              color: style.color,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            <Icon className="h-2.5 w-2.5" />
            {style.label}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#0a1020",
              letterSpacing: "-0.01em",
              marginBottom: 6,
              lineHeight: 1.3,
            }}
          >
            {shape.props.title}
          </div>
          <div
            style={{
              fontSize: 11.5,
              lineHeight: 1.5,
              color: "#556479",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {shape.props.body}
          </div>
          {shape.props.sourceEntityIds.length > 0 && (
            <div
              style={{
                position: "absolute",
                bottom: 10,
                left: 16,
                fontSize: 9,
                color: "#8592a8",
                fontWeight: 600,
              }}
            >
              {shape.props.sourceEntityIds.length} source node
              {shape.props.sourceEntityIds.length > 1 ? "s" : ""}
            </div>
          )}
        </div>
      </HTMLContainer>
    );
  }

  indicator(shape: SynthesisCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

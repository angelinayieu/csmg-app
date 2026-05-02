"use client";

// ── Summary card shape util ──
//
// Output of Lasso → Summarize. Renders the AI-generated summary inside
// a tldraw shape with an interactive header chip:
//   • ✦ AI Summary · {n} sources
//   • ↻ Regenerate           — re-runs the LLM on the same source set
//   • 🪄 Decompose            — turns the summary into KG entities
//                              (hooks the existing recursive-decompose
//                              flow downstream)
//   • 📌 Pin to strategy      — surfaces the summary in the strategy
//                              drawer's notes section
//
// The arrow lines back to each source shape are drawn as standalone
// tldraw arrows (created at the same time as this card by the lasso
// button) — not part of this util. They're dimmed when this card isn't
// selected, courtesy of a CSS opacity rule on the canvas root keyed by
// `[data-summary-source]`. (The lasso button tags the arrows when it
// creates them.)

import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLResizeInfo, resizeBox, useEditor, stopEventPropagation } from "tldraw";
import { Sparkles, RefreshCw, Wand2, Pin, AlertCircle } from "lucide-react";
import type { SummaryCardShape } from "./types";

export class SummaryCardShapeUtil extends BaseBoxShapeUtil<SummaryCardShape> {
  static override type = "summary-card" as const;
  static override props: RecordProps<SummaryCardShape> = {
    w: T.number,
    h: T.number,
    summaryId: T.string,
    kind: T.literalEnum("summary"),
    title: T.string,
    body: T.string,
    sourceShapeIds: T.arrayOf(T.string),
    sourceCount: T.number,
    sourceLabel: T.string,
    status: T.literalEnum("fresh", "regenerating", "stale", "error"),
    errorMessage: T.string.nullable(),
    generatedAt: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: SummaryCardShape, info: TLResizeInfo<SummaryCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): SummaryCardShape["props"] {
    return {
      w: 360,
      h: 220,
      summaryId: "",
      kind: "summary",
      title: "AI Summary",
      body: "",
      sourceShapeIds: [],
      sourceCount: 0,
      sourceLabel: "selection",
      status: "fresh",
      errorMessage: null,
      generatedAt: new Date().toISOString(),
    };
  }

  component(shape: SummaryCardShape) {
    return <SummaryCardBody shape={shape} />;
  }

  indicator(shape: SummaryCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} ry={14} />;
  }
}

// ── Render body (split into a hook-using component because the util
// class doesn't have access to React hooks). ───────────────────────────
function SummaryCardBody({ shape }: { shape: SummaryCardShape }) {
  const editor = useEditor();
  const { props } = shape;
  const accent = "#7c3aed"; // violet — same family as system/synthesis
  const isRegenerating = props.status === "regenerating";
  const isError = props.status === "error";
  // `meta.pinned` is set by the Pin handler after a successful POST
  // to /api/spaces/[id]/pin-summary. We read it off the shape so the
  // badge survives reload (canvas-persistence preserves shape.meta).
  const isPinned = (shape.meta as { pinned?: boolean })?.pinned === true;

  // Click handlers stop propagation so the canvas doesn't deselect /
  // tools don't intercept. All actions dispatch a window event with the
  // summary id; consumer hooks (mounted at canvas level) handle the
  // round-trip so this shape util stays presentational.
  const fire = (action: "regenerate" | "decompose" | "pin" | "zoom-source", payload?: unknown) => {
    window.dispatchEvent(
      new CustomEvent("summary-card:action", {
        detail: { summaryId: props.summaryId, shapeId: shape.id, action, payload },
      }),
    );
  };

  return (
    <HTMLContainer
      style={{ width: props.w, height: props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 14,
          background: "#ffffff",
          border: `1px solid ${accent}26`,
          boxShadow: `0 1px 3px rgba(0,0,0,0.04), 0 14px 36px -10px ${accent}33`,
          padding: "12px 14px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontFamily:
            '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        }}
      >
        {/* accent bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: accent,
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
          }}
        />

        {/* Header chip row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 2,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                borderRadius: 6,
                background: `${accent}10`,
                color: accent,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              <Sparkles size={11} strokeWidth={2.4} />
              AI Summary · {props.sourceCount} {props.sourceCount === 1 ? "source" : "sources"}
            </div>
            {isPinned && (
              <div
                title="Pinned to strategy"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 7px",
                  borderRadius: 6,
                  background: "#fef3c7",
                  color: "#92400e",
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  border: "1px solid #fcd34d",
                }}
              >
                <Pin size={10} strokeWidth={2.4} />
                Pinned
              </div>
            )}
          </div>

          {/* Action chips — pointer-events on each so the inner buttons
              still register clicks but the row itself doesn't eat
              tldraw's drag/select. */}
          <div
            style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
            onPointerDown={stopEventPropagation}
          >
            <ActionButton
              title="Regenerate this summary"
              onClick={() => fire("regenerate")}
              disabled={isRegenerating}
            >
              <RefreshCw
                size={11}
                strokeWidth={2.4}
                style={{
                  animation: isRegenerating ? "spin 1s linear infinite" : undefined,
                }}
              />
            </ActionButton>
            <ActionButton
              title="Decompose this summary into KG entities"
              onClick={() => fire("decompose")}
              disabled={isRegenerating}
            >
              <Wand2 size={11} strokeWidth={2.4} />
            </ActionButton>
            <ActionButton
              title="Pin this summary to the active strategy"
              onClick={() => fire("pin")}
              disabled={isRegenerating}
            >
              <Pin size={11} strokeWidth={2.4} />
            </ActionButton>
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#0a1020",
            letterSpacing: "-0.01em",
            lineHeight: 1.3,
          }}
        >
          {props.title || "AI Summary"}
        </div>

        {/* Body */}
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.55,
            color: "#3f4a5e",
            flex: 1,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            // Keep tldraw from stealing wheel events when the user
            // scrolls inside the card.
            overscrollBehavior: "contain",
          }}
          onPointerDown={stopEventPropagation}
          onWheelCapture={(e) => e.stopPropagation()}
        >
          {isRegenerating && !props.body
            ? "Regenerating summary…"
            : props.body || "(No summary yet — click ↻ to generate)"}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            paddingTop: 6,
            borderTop: "1px solid rgba(11,13,18,0.06)",
            fontSize: 9.5,
            color: "#8592a8",
            fontWeight: 600,
          }}
        >
          <span>{props.sourceLabel}</span>
          {isError && props.errorMessage ? (
            <span
              title={props.errorMessage}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color: "#b91c1c",
              }}
            >
              <AlertCircle size={11} strokeWidth={2.4} />
              {props.errorMessage.length > 38
                ? `${props.errorMessage.slice(0, 38)}…`
                : props.errorMessage}
            </span>
          ) : (
            <button
              type="button"
              title="Zoom to source shapes"
              onClick={() => {
                const shapes = props.sourceShapeIds
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .map((id) => editor.getShape(id as any))
                  .filter(Boolean);
                if (shapes.length) {
                  editor.select(...shapes.map((sh) => sh!.id));
                  editor.zoomToSelection({ animation: { duration: 320 } });
                }
              }}
              onPointerDown={stopEventPropagation}
              style={{
                color: "#8592a8",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                fontSize: 9.5,
                fontWeight: 600,
                padding: 0,
              }}
            >
              {new Date(props.generatedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </button>
          )}
        </div>
      </div>
    </HTMLContainer>
  );
}

function ActionButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        background: "transparent",
        border: "1px solid rgba(11,13,18,0.08)",
        color: "#586379",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
      onPointerDown={stopEventPropagation}
    >
      {children}
    </button>
  );
}

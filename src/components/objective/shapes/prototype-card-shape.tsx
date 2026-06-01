"use client";

// ── PrototypeCardShape ──
//
// The interactive Claude prototype on the board: a self-contained HTML/CSS
// UI (no JS — sanitized server-side) rendered LIVE in a sandboxed iframe
// (sandbox="" denies all capability; belt + suspenders with sanitizeHtml).
// Built from a TechSpec via "Build prototype", then iterated in place
// through the feedback box (PROTOTYPE_REFINE_EVENT → refine route). The
// header is the drag handle; the iframe + feedback box stop propagation so
// they're interactive without fighting tldraw.

import { useState } from "react";
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
import { Loader2, Wand2, AlertCircle, SendHorizontal } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export const PROTOTYPE_REFINE_EVENT = "objective-board:prototype-refine";

export interface PrototypeRefineDetail {
  shapeId: string;
  feedback: string;
}

export type PrototypeCardShape = TLBaseShape<
  "prototype-card",
  {
    w: number;
    h: number;
    title: string;
    /** Sanitized, self-contained HTML rendered in the iframe. */
    html: string;
    status: "generating" | "ready" | "error";
    /** Bumps each time the feedback loop regenerates. */
    version: number;
    /** Stringified TechSpec — context the refine route grounds against. */
    specJson: string;
  }
>;

export class PrototypeCardShapeUtil extends BaseBoxShapeUtil<PrototypeCardShape> {
  static override type = "prototype-card" as const;
  static override props: RecordProps<PrototypeCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    html: T.string,
    status: T.literalEnum("generating", "ready", "error"),
    version: T.number,
    specJson: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (shape: PrototypeCardShape, info: TLResizeInfo<PrototypeCardShape>) => {
    return resizeBox(shape, info);
  };

  getDefaultProps(): PrototypeCardShape["props"] {
    return {
      w: 420,
      h: 540,
      title: "Prototype",
      html: "",
      status: "generating",
      version: 0,
      specJson: "",
    };
  }

  component(shape: PrototypeCardShape) {
    return <PrototypeCardRenderer shape={shape} />;
  }

  indicator(shape: PrototypeCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />;
  }
}

function PrototypeCardRenderer({ shape }: { shape: PrototypeCardShape }) {
  const { title, html, status, version } = shape.props;
  const accent = appleVibe.accent.primary;
  const [feedback, setFeedback] = useState("");

  function sendFeedback() {
    const text = feedback.trim();
    if (!text || status === "generating") return;
    setFeedback("");
    window.dispatchEvent(
      new CustomEvent<PrototypeRefineDetail>(PROTOTYPE_REFINE_EVENT, {
        detail: { shapeId: shape.id, feedback: text },
      }),
    );
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 18,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          border: `1px solid ${accent}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.05), 0 20px 50px -18px ${accent}55, 0 8px 22px -10px rgba(11,18,40,0.16)`,
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Header — the drag handle (no stopPropagation). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 12px",
            borderBottom: `1px solid ${appleVibe.stroke.soft}`,
            background: "rgba(248,250,252,0.9)",
            flexShrink: 0,
          }}
        >
          <Wand2 style={{ width: 13, height: 13, color: accent }} strokeWidth={2.3} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: appleVibe.text.primary,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: appleVibe.text.tertiary,
            }}
          >
            Prototype
          </span>
          {version > 0 && status === "ready" && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 600,
                color: appleVibe.text.tertiary,
              }}
            >
              v{version}
            </span>
          )}
        </div>

        {/* Body — the live prototype, a skeleton, or an error. */}
        <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#fff" }}>
          {status === "ready" && html ? (
            <iframe
              title={`${title} prototype`}
              srcDoc={html}
              sandbox=""
              onPointerDown={stopEventPropagation}
              onWheelCapture={(e) => e.stopPropagation()}
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          ) : status === "error" ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                color: appleVibe.text.tertiary,
                padding: 24,
                textAlign: "center",
              }}
            >
              <AlertCircle style={{ width: 22, height: 22 }} strokeWidth={2} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                Couldn&apos;t build the prototype. Send feedback to retry.
              </span>
            </div>
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                color: accent,
              }}
            >
              <Loader2 className="animate-spin" style={{ width: 24, height: 24 }} strokeWidth={2.2} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: appleVibe.text.secondary }}>
                {version > 0 ? "Revising the prototype…" : "Claude is building the prototype…"}
              </span>
            </div>
          )}
        </div>

        {/* Feedback box — the iteration loop. */}
        <div
          onPointerDown={stopEventPropagation}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 10px",
            borderTop: `1px solid ${appleVibe.stroke.soft}`,
            background: "rgba(248,250,252,0.9)",
            flexShrink: 0,
          }}
        >
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendFeedback();
            }}
            placeholder="Tell Claude what to change…"
            disabled={status === "generating"}
            style={{
              flex: 1,
              border: `1px solid ${appleVibe.stroke.medium}`,
              borderRadius: 999,
              padding: "7px 13px",
              fontSize: 12,
              outline: "none",
              background: "#fff",
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.stack,
            }}
          />
          <button
            type="button"
            onClick={sendFeedback}
            disabled={status === "generating" || !feedback.trim()}
            title="Update the prototype with this feedback"
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 32,
              height: 32,
              borderRadius: 999,
              border: "none",
              background: accent,
              color: "white",
              cursor: status === "generating" || !feedback.trim() ? "default" : "pointer",
              opacity: status === "generating" || !feedback.trim() ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <SendHorizontal style={{ width: 15, height: 15 }} strokeWidth={2.3} />
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

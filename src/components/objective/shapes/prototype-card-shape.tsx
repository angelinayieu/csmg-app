"use client";

// ── PrototypeCardShape ──
//
// The interactive Claude prototype on the board: a self-contained HTML/CSS+JS
// UI (DOMPurify v3.4.8 sanitized server-side) rendered LIVE in a T1
// sandboxed iframe (sandbox="allow-scripts" — null-origin; can't read parent,
// can't fetch APIs, can't unset its own sandbox). Inline scripts are PERMITTED
// for real interactivity; external resources blocked at three layers:
// sanitizer + sandbox + injected CSP meta.
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
import { TasteReceipt } from "@/components/objective/canvas-interactions/taste-receipt";

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
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow:
            "0 1px 2px rgba(11,18,40,0.04), 0 14px 38px -22px rgba(11,18,40,0.18)",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Header — minimal: just the title + version. The iframe IS the
            prototype; subtitle labels are noise. Drag handle. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderBottom: `1px solid ${appleVibe.stroke.hairline}`,
            background: "#fff",
            flexShrink: 0,
          }}
        >
          <Wand2 style={{ width: 12, height: 12, color: appleVibe.text.tertiary }} strokeWidth={2} />
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: appleVibe.text.primary,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              letterSpacing: -0.1,
            }}
          >
            {title}
          </span>
          {version > 0 && status === "ready" && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                fontWeight: 500,
                color: appleVibe.text.faint,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              v{version}
            </span>
          )}
        </div>

        {/* Taste receipt — which terms / source images the prototype honors.
            Scans the title only (the body is sanitized HTML; scanning code
            would false-match). Self-renders only when there are hits. */}
        {status === "ready" && (
          <div onPointerDown={stopEventPropagation} style={{ padding: "0 12px" }}>
            <PrototypeTasteReceipt text={title} />
          </div>
        )}

        {/* Body — the live prototype, a skeleton, or an error. */}
        <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#fff" }}>
          {status === "ready" && html ? (
            <iframe
              title={`${title} prototype`}
              srcDoc={html}
              // T1: allow inline scripts but NOT same-origin — the doc loads
              // at a null origin, can't read parent cookies, can't fetch our
              // APIs, can't escape the sandbox. sanitizeHtmlT1 also wedges a
              // deny-all CSP meta at the top of <head> as the second layer.
              sandbox="allow-scripts"
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

        {/* Feedback box — the iteration loop. Flat hairline, no glass. */}
        <div
          onPointerDown={stopEventPropagation}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            borderTop: `1px solid ${appleVibe.stroke.hairline}`,
            background: "#fff",
            flexShrink: 0,
          }}
        >
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendFeedback();
            }}
            placeholder="What should change?"
            disabled={status === "generating"}
            style={{
              flex: 1,
              border: `1px solid ${appleVibe.stroke.soft}`,
              borderRadius: 10,
              padding: "7px 12px",
              fontSize: 12.5,
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
              width: 30,
              height: 30,
              borderRadius: 10,
              border: "none",
              background: feedback.trim() ? accent : "rgba(15,23,42,0.06)",
              color: feedback.trim() ? "white" : appleVibe.text.faint,
              cursor: status === "generating" || !feedback.trim() ? "default" : "pointer",
              transition: "background 120ms ease-out",
              flexShrink: 0,
            }}
          >
            <SendHorizontal style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </HTMLContainer>
  );
}

/** Same wrapper pattern as the oc-card mount — resolves spaceId from
 *  the board URL; renders the receipt strip and hides off-board. */
function PrototypeTasteReceipt({ text }: { text: string }) {
  const spaceId =
    typeof window !== "undefined"
      ? window.location.pathname.match(/\/objective\/([^/?#]+)/)?.[1] ?? null
      : null;
  if (!spaceId) return null;
  return <TasteReceipt text={text} spaceId={spaceId} variant="strip" />;
}

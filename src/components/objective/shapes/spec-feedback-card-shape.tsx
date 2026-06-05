"use client";

// ── SpecFeedbackCardShape ──
//
// A card carrying the result of an inline op on the expanded tech-spec card
// (Ask / Variations / Improve). It anchors back to a specific spec card +
// section, shows the user's selected text + the model's answer, and — for
// improve and variations — exposes an "Attach to spec" button that pushes
// the content into the section's pending-improvements queue. The spec
// card's "Refine" button (per-section) then drains the queue.
//
// Apple-minimal glass white card. Header is the drag handle; body + buttons
// stop propagation. Board-bus CustomEvents (mirror tech-spec-card-shape /
// prototype-card-shape) so the heavy attach/refine logic stays in
// WhiteboardBase.

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
import {
  HelpCircle,
  Shuffle,
  Sparkles,
  Check,
  Link2,
} from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export const ATTACH_TO_SECTION_EVENT = "objective-board:attach-to-section";

export interface AttachToSectionDetail {
  /** The spec card this feedback card was spawned from. */
  specCardId: string;
  /** Which section of that spec it targets. */
  sectionId: string;
  /** What to queue as the pending improvement (the card's content). */
  content: string;
  /** This card's id — so WhiteboardBase can mark it attached after success. */
  feedbackCardId: string;
}

export type SpecFeedbackKind = "ask" | "variations" | "improve";

export type SpecFeedbackCardShape = TLBaseShape<
  "spec-feedback-card",
  {
    w: number;
    h: number;
    kind: SpecFeedbackKind;
    /** Display label for the section this attaches to. */
    sectionLabel: string;
    /** Stable section id (matches TechSpecSectionId). */
    sectionId: string;
    /** The tech-spec card this was spawned from. */
    specCardId: string;
    /** The user's selected text (or trigger prompt) — shown as subtitle. */
    selection: string;
    /** Model output: answer / variations / improvement edit. */
    content: string;
    /** True once attached to the spec's pending queue (button → "Attached"). */
    attached: boolean;
  }
>;

const KIND_META: Record<
  SpecFeedbackKind,
  { label: string; color: string; Icon: typeof HelpCircle }
> = {
  ask: { label: "Ask", color: "#3B82F6", Icon: HelpCircle },
  variations: { label: "Variations", color: "#8B5CF6", Icon: Shuffle },
  improve: { label: "Improve", color: "#10B981", Icon: Sparkles },
};

export class SpecFeedbackCardShapeUtil extends BaseBoxShapeUtil<SpecFeedbackCardShape> {
  static override type = "spec-feedback-card" as const;
  static override props: RecordProps<SpecFeedbackCardShape> = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum("ask", "variations", "improve"),
    sectionLabel: T.string,
    sectionId: T.string,
    specCardId: T.string,
    selection: T.string,
    content: T.string,
    attached: T.boolean,
  };

  override canResize = () => true;
  override canEdit = () => false;

  override onResize = (
    shape: SpecFeedbackCardShape,
    info: TLResizeInfo<SpecFeedbackCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): SpecFeedbackCardShape["props"] {
    return {
      w: 320,
      h: 240,
      kind: "improve",
      sectionLabel: "",
      sectionId: "",
      specCardId: "",
      selection: "",
      content: "",
      attached: false,
    };
  }

  component(shape: SpecFeedbackCardShape) {
    return <Renderer shape={shape} />;
  }

  indicator(shape: SpecFeedbackCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={16} ry={16} />;
  }
}

function Renderer({ shape }: { shape: SpecFeedbackCardShape }) {
  const { kind, sectionLabel, sectionId, specCardId, selection, content, attached } =
    shape.props;
  const meta = KIND_META[kind];
  const Icon = meta.Icon;
  const accent = meta.color;
  const canAttach = !attached && (kind === "improve" || kind === "variations");

  function onAttach(e: React.MouseEvent) {
    e.stopPropagation();
    if (!content.trim() || !specCardId || !sectionId) return;
    window.dispatchEvent(
      new CustomEvent<AttachToSectionDetail>(ATTACH_TO_SECTION_EVENT, {
        detail: {
          specCardId,
          sectionId,
          content: content.trim(),
          feedbackCardId: shape.id,
        },
      }),
    );
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 16,
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.99) 0%, rgba(250,251,253,0.97) 100%)",
          border: `1px solid ${accent}33`,
          boxShadow: `0 1px 2px rgba(11,18,40,0.04), 0 10px 28px -12px ${accent}40, 0 6px 16px -8px rgba(11,18,40,0.12)`,
          padding: "11px 13px 10px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Eyebrow — section anchor */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <Icon style={{ width: 12, height: 12, color: accent }} strokeWidth={2.3} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            {meta.label}
          </span>
          {sectionLabel && (
            <>
              <span style={{ fontSize: 10, color: "rgba(15,23,42,0.3)" }}>·</span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: appleVibe.text.secondary,
                }}
              >
                §{sectionLabel}
              </span>
            </>
          )}
        </div>

        {/* Selection / prompt subtitle */}
        {selection && (
          <div
            style={{
              marginTop: 7,
              fontSize: 11.5,
              lineHeight: 1.35,
              color: appleVibe.text.tertiary,
              fontStyle: "italic",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              flexShrink: 0,
              borderLeft: `2px solid ${accent}33`,
              paddingLeft: 7,
            }}
          >
            "{selection}"
          </div>
        )}

        {/* Content */}
        <div
          onPointerDown={stopEventPropagation}
          onWheelCapture={(e) => e.stopPropagation()}
          style={{
            marginTop: 9,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: appleVibe.text.primary,
            flex: 1,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            paddingRight: 4,
          }}
        >
          {content || "(empty)"}
        </div>

        {/* Footer — attach to spec */}
        {(canAttach || attached) && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: `1px solid ${accent}18`,
              display: "flex",
              alignItems: "center",
              gap: 7,
              flexShrink: 0,
            }}
          >
            {attached ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 10px",
                  borderRadius: 999,
                  background: `${accent}14`,
                  color: accent,
                  fontSize: 11,
                  fontWeight: 650,
                }}
              >
                <Check style={{ width: 11, height: 11 }} strokeWidth={2.6} />
                Queued for §{sectionLabel}
              </span>
            ) : (
              <button
                type="button"
                onPointerDown={stopEventPropagation}
                onClick={onAttach}
                title={`Add to §${sectionLabel}'s pending improvements`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "6px 11px",
                  borderRadius: 999,
                  border: `1px solid ${accent}40`,
                  background: "rgba(255,255,255,0.85)",
                  color: accent,
                  fontSize: 11,
                  fontWeight: 650,
                  cursor: "pointer",
                }}
              >
                <Link2 style={{ width: 11, height: 11 }} strokeWidth={2.4} />
                Attach to §{sectionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

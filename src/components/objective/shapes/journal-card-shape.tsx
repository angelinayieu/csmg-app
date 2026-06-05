"use client";

// ── JournalCardShapeUtil ──
//
// The synthesized journal artifact: a polished NOTE PAGE (default) that
// aggregates all the board's voice notes, and an expandable 3D OPEN-BOOKLET
// view (inspo #2). Re-synthesizes (status flips) as more voice notes land.
// One per board. Content = sections [{ heading, body }] from the synthesize
// route, stored on the shape (and in synthesis_data for re-materialization).

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
import { BookOpen, NotebookPen } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { openNotebook } from "@/components/objective/board-bus";

export const JOURNAL_COLOR = "#0F766E"; // teal — a calm "writing" accent
const PAPER = "#F5F0E4"; // warm cream page
const PAPER_EDGE = "#E7DFCB";

const NOTE_W = 380;
const NOTE_H = 320;
const BOOK_W = 660;
const BOOK_H = 440;

interface Section {
  heading?: string;
  body?: string;
}

export type JournalCardShape = TLBaseShape<
  "journal-card",
  {
    w: number;
    h: number;
    spaceId: string;
    title: string;
    sectionsJson: string;
    pageCount: number;
    status: "fresh" | "regenerating" | "stale";
    open: boolean;
    color: string;
  }
>;

export class JournalCardShapeUtil extends BaseBoxShapeUtil<JournalCardShape> {
  static override type = "journal-card" as const;
  static override props: RecordProps<JournalCardShape> = {
    w: T.number,
    h: T.number,
    spaceId: T.string,
    title: T.string,
    sectionsJson: T.string,
    pageCount: T.number,
    status: T.literalEnum("fresh", "regenerating", "stale"),
    open: T.boolean,
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override onResize = (
    shape: JournalCardShape,
    info: TLResizeInfo<JournalCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): JournalCardShape["props"] {
    return {
      w: NOTE_W,
      h: NOTE_H,
      spaceId: "",
      title: "Journal",
      sectionsJson: "[]",
      pageCount: 1,
      status: "regenerating",
      open: false,
      color: JOURNAL_COLOR,
    };
  }

  component(shape: JournalCardShape) {
    return <JournalRenderer shape={shape} util={this} />;
  }

  indicator(shape: JournalCardShape) {
    const r = shape.props.open ? 10 : 18;
    return <rect width={shape.props.w} height={shape.props.h} rx={r} ry={r} />;
  }
}

function parseSections(json: string): Section[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as Section[]) : [];
  } catch {
    return [];
  }
}

function JournalRenderer({
  shape,
  util,
}: {
  shape: JournalCardShape;
  util: JournalCardShapeUtil;
}) {
  const editor = util.editor;
  const { title, status, open, color, spaceId } = shape.props;
  const sections = parseSections(shape.props.sectionsJson);
  const regenerating = status === "regenerating";

  function toggleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !open;
    editor.updateShape<JournalCardShape>({
      id: shape.id,
      type: "journal-card",
      props: {
        open: next,
        w: next ? BOOK_W : NOTE_W,
        h: next ? BOOK_H : NOTE_H,
      },
    });
  }

  // "Open" now launches the editable Notebook panel (the booklet flip was a
  // dead-end — you couldn't interact with it). The board stays live behind.
  function openPanel(e: React.MouseEvent) {
    e.stopPropagation();
    openNotebook({ spaceId });
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      {open ? (
        <BookletView
          title={title}
          sections={sections}
          color={color}
          onClose={toggleOpen}
        />
      ) : (
        <NotePageView
          title={title}
          sections={sections}
          color={color}
          regenerating={regenerating}
          onOpen={openPanel}
        />
      )}
    </HTMLContainer>
  );
}

// ── Note-page (default) ──────────────────────────────────────────────
function NotePageView({
  title,
  sections,
  color,
  regenerating,
  onOpen,
}: {
  title: string;
  sections: Section[];
  color: string;
  regenerating: boolean;
  onOpen: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 18,
        background: PAPER,
        border: `1px solid ${PAPER_EDGE}`,
        boxShadow: appleVibe.shadow.card,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Sparkle
          className={regenerating ? "animate-pulse" : undefined}
          style={{ width: 13, height: 13, color }}
          strokeWidth={2.4}
        />
        <span
          style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: "0.04em", color, textTransform: "uppercase" }}
        >
          {regenerating ? "Synthesizing…" : "Journal"}
        </span>
        <button
          type="button"
          onPointerDown={stopEventPropagation}
          onClick={onOpen}
          aria-label="Open booklet"
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 9px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            background: "rgba(15,23,42,0.05)",
            color: appleVibe.text.tertiary,
            fontSize: 10.5,
            fontWeight: 600,
          }}
        >
          <BookOpen style={{ width: 12, height: 12 }} strokeWidth={2.2} />
          Open
        </button>
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 19,
          fontWeight: 700,
          lineHeight: 1.15,
          color: "#3a3327",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        {title || "Journal"}
      </div>

      <div
        style={{
          marginTop: 10,
          flex: 1,
          overflow: "hidden",
          // faint ruled-paper lines
          backgroundImage: `repeating-linear-gradient(${PAPER} 0px, ${PAPER} 25px, ${PAPER_EDGE}66 26px)`,
        }}
      >
        {sections.length === 0 ? (
          <div style={{ fontSize: 12.5, color: appleVibe.text.faint, fontStyle: "italic" }}>
            {regenerating
              ? "Weaving your voice notes into a journal entry…"
              : "Speak a note to begin your journal."}
          </div>
        ) : (
          sections.slice(0, 4).map((s, i) => (
            <div key={i} style={{ marginBottom: 9 }}>
              {s.heading && (
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "#3a3327",
                    fontFamily: "Georgia, serif",
                  }}
                >
                  {s.heading}
                </div>
              )}
              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: "25px",
                  color: "#4a4234",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  fontFamily: "Georgia, serif",
                }}
              >
                {s.body}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── 3D open booklet (expanded) ───────────────────────────────────────
function BookletView({
  title,
  sections,
  color,
  onClose,
}: {
  title: string;
  sections: Section[];
  color: string;
  onClose: (e: React.MouseEvent) => void;
}) {
  // Left page = title + first half; right page = remainder.
  const mid = Math.ceil(sections.length / 2);
  const left = sections.slice(0, Math.max(1, mid));
  const right = sections.slice(Math.max(1, mid));

  const pageStyle: React.CSSProperties = {
    flex: 1,
    background: PAPER,
    padding: "22px 24px",
    overflow: "hidden",
    fontFamily: "Georgia, 'Times New Roman', serif",
    color: "#4a4234",
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        perspective: "1600px",
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* Close (note-page) toggle */}
      <button
        type="button"
        onPointerDown={stopEventPropagation}
        onClick={onClose}
        aria-label="Close booklet"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          zIndex: 2,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 10px",
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          background: "rgba(15,23,42,0.06)",
          color: appleVibe.text.secondary,
          fontSize: 10.5,
          fontWeight: 600,
        }}
      >
        <NotebookPen style={{ width: 12, height: 12 }} strokeWidth={2.2} />
        Note
      </button>

      <div
        style={{
          width: "92%",
          height: "82%",
          display: "flex",
          transform: "rotateX(7deg)",
          transformStyle: "preserve-3d",
          borderRadius: 10,
          boxShadow:
            "0 40px 80px -30px rgba(11,18,40,0.5), 0 10px 30px -10px rgba(11,18,40,0.25)",
        }}
      >
        {/* Left page */}
        <div
          style={{
            ...pageStyle,
            borderRadius: "10px 2px 2px 10px",
            boxShadow: "inset -22px 0 32px -24px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#3a3327",
              lineHeight: 1.1,
              marginBottom: 14,
            }}
          >
            {title || "Journal"}
          </div>
          {left.map((s, i) => (
            <BookletSection key={i} section={s} />
          ))}
        </div>

        {/* Spine */}
        <div
          style={{
            width: 2,
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.28), rgba(0,0,0,0.12) 50%, rgba(0,0,0,0.28))",
          }}
        />

        {/* Right page */}
        <div
          style={{
            ...pageStyle,
            borderRadius: "2px 10px 10px 2px",
            boxShadow: "inset 22px 0 32px -24px rgba(0,0,0,0.45)",
          }}
        >
          {right.length > 0 ? (
            right.map((s, i) => <BookletSection key={i} section={s} />)
          ) : (
            <div style={{ fontSize: 13, fontStyle: "italic", color: "#8a8068" }}>
              More entries appear here as you add voice notes.
            </div>
          )}
          <div
            style={{
              marginTop: 18,
              fontSize: 11,
              letterSpacing: "0.06em",
              color,
              fontFamily: appleVibe.font.stack,
              fontWeight: 600,
            }}
          >
            {sections.length} {sections.length === 1 ? "entry" : "entries"}
          </div>
        </div>
      </div>
    </div>
  );
}

function BookletSection({ section }: { section: Section }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {section.heading && (
        <div style={{ fontSize: 14, fontWeight: 700, color: "#3a3327", marginBottom: 2 }}>
          {section.heading}
        </div>
      )}
      <div
        style={{
          fontSize: 13,
          lineHeight: "23px",
          color: "#4a4234",
          display: "-webkit-box",
          WebkitLineClamp: 6,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {section.body}
      </div>
    </div>
  );
}

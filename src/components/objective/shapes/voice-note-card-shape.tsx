"use client";

// ── VoiceNoteCardShapeUtil ──
//
// A committed spoken entry — a clean profile post (avatar + name + a mic
// glyph + the transcript), inspo #4. Materialized on "enter" from the voice
// recorder; persisted in the board snapshot (the durable note). Transcript-
// only (no audio).
//
// Two states (collapsed ↔ expanded, mirroring journal-card's open flip):
//   • collapsed — profile + clamped transcript (the glanceable feed item).
//   • expanded  — the transcript becomes EDITABLE (textarea), plus the AI
//     analysis of the note and its metadata (recorded-at, duration).
// A voice note is now a pure INPUT object: it no longer auto-synthesizes a
// journal. Artifacts (journal/notebook/etc.) are produced on demand.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  stopEventPropagation,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Mic, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export const VOICE_NOTE_COLOR = "#6366F1"; // indigo — calm, voice-forward

const COLLAPSED_W = 300;
const COLLAPSED_H = 188;
const EXPANDED_W = 360;
const EXPANDED_H = 432;

/** A single AI-surfaced point about the note. */
export interface VoiceNoteAnalysisPoint {
  title: string;
  subtitle?: string;
}
export interface VoiceNoteAnalysis {
  status: "pending" | "ready" | "none";
  points: VoiceNoteAnalysisPoint[];
}

export type VoiceNoteCardShape = TLBaseShape<
  "voice-note-card",
  {
    w: number;
    h: number;
    voiceNoteId: string;
    spaceId: string;
    authorName: string;
    transcript: string;
    createdAtIso: string;
    /** Length of the recording in ms (0 = unknown). */
    durationMs: number;
    /** AI analysis, JSON-encoded (VoiceNoteAnalysis). "" = none yet. */
    analysisJson: string;
    /** Expanded → editable transcript + analysis + metadata. */
    expanded: boolean;
    color: string;
  }
>;

// Props migration — `durationMs`, `analysisJson`, `expanded` were added after
// voice-note cards were already persisted in canvases.snapshot. Without this,
// tldraw validation rejects older shapes on load.
const Versions = createShapePropsMigrationIds("voice-note-card", {
  addAnalysisAndExpand: 1,
});

export const voiceNoteCardMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions.addAnalysisAndExpand,
      up(props) {
        const p = props as Record<string, unknown>;
        if (p.durationMs === undefined) p.durationMs = 0;
        if (p.analysisJson === undefined) p.analysisJson = "";
        if (p.expanded === undefined) p.expanded = false;
      },
      down(props) {
        const p = props as Record<string, unknown>;
        delete p.durationMs;
        delete p.analysisJson;
        delete p.expanded;
      },
    },
  ],
});

export class VoiceNoteCardShapeUtil extends BaseBoxShapeUtil<VoiceNoteCardShape> {
  static override type = "voice-note-card" as const;
  static override props: RecordProps<VoiceNoteCardShape> = {
    w: T.number,
    h: T.number,
    voiceNoteId: T.string,
    spaceId: T.string,
    authorName: T.string,
    transcript: T.string,
    createdAtIso: T.string,
    durationMs: T.number,
    analysisJson: T.string,
    expanded: T.boolean,
    color: T.string,
  };

  static override migrations = voiceNoteCardMigrations;

  override canResize = () => true;
  override canEdit = () => false;
  override onResize = (
    shape: VoiceNoteCardShape,
    info: TLResizeInfo<VoiceNoteCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): VoiceNoteCardShape["props"] {
    return {
      w: COLLAPSED_W,
      h: COLLAPSED_H,
      voiceNoteId: "",
      spaceId: "",
      authorName: "You",
      transcript: "",
      createdAtIso: "",
      durationMs: 0,
      analysisJson: "",
      expanded: false,
      color: VOICE_NOTE_COLOR,
    };
  }

  component(shape: VoiceNoteCardShape) {
    return <VoiceNoteRenderer shape={shape} util={this} />;
  }

  indicator(shape: VoiceNoteCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={20} ry={20} />;
  }
}

function relativeTime(iso: string): string {
  if (!iso) return "now";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "now";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function formatDuration(ms: number): string | null {
  if (!ms || ms < 1000) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

function parseAnalysis(json: string): VoiceNoteAnalysis {
  if (!json) return { status: "none", points: [] };
  try {
    const v = JSON.parse(json) as Partial<VoiceNoteAnalysis>;
    return {
      status: v.status === "pending" || v.status === "ready" ? v.status : "none",
      points: Array.isArray(v.points) ? v.points : [],
    };
  } catch {
    return { status: "none", points: [] };
  }
}

function VoiceNoteRenderer({
  shape,
  util,
}: {
  shape: VoiceNoteCardShape;
  util: VoiceNoteCardShapeUtil;
}) {
  const editor = util.editor;
  const { authorName, transcript, createdAtIso, durationMs, color, expanded } =
    shape.props;
  const initial = (authorName || "You").trim().charAt(0).toUpperCase();
  const analysis = parseAnalysis(shape.props.analysisJson);
  const duration = formatDuration(durationMs);

  function toggleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !expanded;
    editor.updateShape<VoiceNoteCardShape>({
      id: shape.id,
      type: "voice-note-card",
      props: {
        expanded: next,
        w: next ? EXPANDED_W : COLLAPSED_W,
        h: next ? EXPANDED_H : COLLAPSED_H,
      },
    });
  }

  function onTranscriptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    editor.updateShape<VoiceNoteCardShape>({
      id: shape.id,
      type: "voice-note-card",
      props: { transcript: e.target.value },
    });
  }

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 20,
          background: appleVibe.surface.card,
          border: `1px solid ${appleVibe.stroke.soft}`,
          boxShadow: appleVibe.shadow.card,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {/* Header — avatar + name + handle-ish meta + expand toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              background: color,
              color: "white",
              display: "grid",
              placeItems: "center",
              fontSize: 14,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initial}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 650,
                color: appleVibe.text.primary,
                lineHeight: 1.1,
              }}
            >
              {authorName || "You"}
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: appleVibe.text.faint,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Mic style={{ width: 11, height: 11, color }} strokeWidth={2.2} />
              voice · {relativeTime(createdAtIso)}
              {duration && <span style={{ opacity: 0.7 }}>· {duration}</span>}
            </div>
          </div>
          <button
            type="button"
            onPointerDown={stopEventPropagation}
            onClick={toggleExpand}
            aria-label={expanded ? "Collapse note" : "Expand note"}
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: "rgba(15,23,42,0.05)",
              color: appleVibe.text.tertiary,
            }}
          >
            {expanded ? (
              <ChevronUp style={{ width: 14, height: 14 }} strokeWidth={2.4} />
            ) : (
              <ChevronDown style={{ width: 14, height: 14 }} strokeWidth={2.4} />
            )}
          </button>
        </div>

        {expanded ? (
          <ExpandedBody
            transcript={transcript}
            analysis={analysis}
            color={color}
            onChange={onTranscriptChange}
          />
        ) : (
          // Collapsed — clamped read-only transcript.
          <div
            style={{
              marginTop: 11,
              fontSize: 13,
              fontWeight: 420,
              lineHeight: 1.5,
              color: appleVibe.text.secondary,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 5,
              WebkitBoxOrient: "vertical",
              flex: 1,
            }}
          >
            {transcript || "…"}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

function ExpandedBody({
  transcript,
  analysis,
  color,
  onChange,
}: {
  transcript: string;
  analysis: VoiceNoteAnalysis;
  color: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div
      style={{
        marginTop: 11,
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflowY: "auto",
      }}
      onPointerDown={stopEventPropagation}
      onWheelCapture={stopEventPropagation}
    >
      {/* Editable transcript */}
      <textarea
        value={transcript}
        onChange={onChange}
        onPointerDown={stopEventPropagation}
        spellCheck
        placeholder="Your transcript — edit freely…"
        style={{
          width: "100%",
          minHeight: 120,
          resize: "none",
          border: `1px solid ${appleVibe.stroke.soft}`,
          borderRadius: 12,
          padding: "10px 12px",
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily: appleVibe.font.stack,
          color: appleVibe.text.secondary,
          background: "rgba(15,23,42,0.02)",
          outline: "none",
        }}
      />

      {/* AI analysis */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            marginBottom: 7,
          }}
        >
          <Sparkles style={{ width: 12, height: 12, color }} strokeWidth={2.4} />
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 650,
              letterSpacing: "0.03em",
              color: appleVibe.text.tertiary,
              textTransform: "uppercase",
            }}
          >
            {analysis.status === "pending" ? "Analyzing…" : "What this surfaces"}
          </span>
        </div>

        {analysis.status === "pending" ? (
          <div
            style={{
              fontSize: 12,
              fontStyle: "italic",
              color: appleVibe.text.faint,
            }}
          >
            Reading your note…
          </div>
        ) : analysis.points.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              fontStyle: "italic",
              color: appleVibe.text.faint,
            }}
          >
            No analysis for this note.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {analysis.points.map((p, i) => (
              <div
                key={i}
                style={{
                  borderRadius: 10,
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                  background: "rgba(99,102,241,0.04)",
                  padding: "8px 10px",
                }}
              >
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: appleVibe.text.primary,
                    lineHeight: 1.3,
                  }}
                >
                  {p.title}
                </div>
                {p.subtitle && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11.5,
                      lineHeight: 1.4,
                      color: appleVibe.text.tertiary,
                    }}
                  >
                    {p.subtitle}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

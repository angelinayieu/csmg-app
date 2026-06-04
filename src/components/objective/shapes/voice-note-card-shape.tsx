"use client";

// ── VoiceNoteCardShapeUtil ──
//
// A committed spoken entry — a clean profile post (avatar + name + a mic
// glyph + the transcript), inspo #4. Materialized on "enter" from the voice
// recorder; persisted in the board snapshot (the durable note). Transcript-
// only (no audio).

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type RecordProps,
  type TLBaseShape,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import { Mic } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export const VOICE_NOTE_COLOR = "#6366F1"; // indigo — calm, voice-forward

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
    color: string;
  }
>;

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
    color: T.string,
  };

  override canResize = () => true;
  override canEdit = () => false;
  override onResize = (
    shape: VoiceNoteCardShape,
    info: TLResizeInfo<VoiceNoteCardShape>,
  ) => resizeBox(shape, info);

  getDefaultProps(): VoiceNoteCardShape["props"] {
    return {
      w: 300,
      h: 188,
      voiceNoteId: "",
      spaceId: "",
      authorName: "You",
      transcript: "",
      createdAtIso: "",
      color: VOICE_NOTE_COLOR,
    };
  }

  component(shape: VoiceNoteCardShape) {
    return <VoiceNoteRenderer shape={shape} />;
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

function VoiceNoteRenderer({ shape }: { shape: VoiceNoteCardShape }) {
  const { authorName, transcript, createdAtIso, color } = shape.props;
  const initial = (authorName || "You").trim().charAt(0).toUpperCase();

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
        {/* Header — avatar + name + handle-ish meta + mic glyph */}
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
            </div>
          </div>
        </div>

        {/* Transcript */}
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
      </div>
    </HTMLContainer>
  );
}

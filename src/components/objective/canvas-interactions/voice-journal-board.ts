// ── Voice journal → board materialization ──
//
// deployVoiceNoteOnBoard: drop a committed spoken entry as a voice-note card
// (idempotent by voiceNoteId), stacked in a column below the objective.
// deployJournalOnBoard: create-or-update the single journal artifact card to
// the right of the notes column.

import { createShapeId, type Editor } from "tldraw";
import {
  VoiceNoteCardShapeUtil,
  VOICE_NOTE_COLOR,
  type VoiceNoteCardShape,
} from "../shapes/voice-note-card-shape";
import {
  JournalCardShapeUtil,
  JOURNAL_COLOR,
  type JournalCardShape,
} from "../shapes/journal-card-shape";
import type {
  VoiceNoteCardDetail,
  VoiceNoteAnalysisDetail,
  JournalCardDetail,
} from "../board-bus";

// Re-export the utils so whiteboard-base can register them from one import.
export { VoiceNoteCardShapeUtil, JournalCardShapeUtil };

const NOTE_W = 300;
const NOTE_H = 188;
const NOTE_GAP = 18;

/** Top-center anchor of the objective card (or viewport center fallback). */
function anchorPoint(editor: Editor): { x: number; y: number } {
  const shapes = editor.getCurrentPageShapes();
  const obj =
    shapes.find((s) => s.type === "objective-card") ??
    shapes.find((s) => s.type === "room-card");
  if (obj) {
    const b = editor.getShapePageBounds(obj.id);
    if (b) return { x: b.midX, y: b.maxY };
  }
  const vp = editor.getViewportPageBounds();
  return { x: vp.center.x, y: vp.center.y };
}

export function deployVoiceNoteOnBoard(
  editor: Editor,
  d: VoiceNoteCardDetail,
): void {
  if (!d?.voiceNoteId) return;

  // Idempotent — update the transcript in place if this note already exists.
  const existing = editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "voice-note-card" &&
        (s as VoiceNoteCardShape).props.voiceNoteId === d.voiceNoteId,
    );
  if (existing) {
    editor.updateShape<VoiceNoteCardShape>({
      id: existing.id,
      type: "voice-note-card",
      props: { transcript: d.transcript, authorName: d.authorName },
    });
    return;
  }

  const analysisJson =
    d.analysisJson ?? JSON.stringify({ status: "pending", points: [] });

  // Stack new notes in a column below the objective (notes feed downward,
  // offset to the LEFT so the journal artifact can sit to their right).
  const noteCount = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "voice-note-card").length;
  const anchor = anchorPoint(editor);
  const x = anchor.x - NOTE_W - 40;
  const y = anchor.y + 64 + noteCount * (NOTE_H + NOTE_GAP);

  const id = createShapeId();
  editor.createShape<VoiceNoteCardShape>({
    id,
    type: "voice-note-card",
    x,
    y,
    props: {
      w: NOTE_W,
      h: NOTE_H,
      voiceNoteId: d.voiceNoteId,
      spaceId: d.spaceId,
      authorName: d.authorName || "You",
      transcript: d.transcript,
      createdAtIso: d.createdAtIso,
      durationMs: d.durationMs ?? 0,
      analysisJson,
      expanded: false,
      color: d.color || VOICE_NOTE_COLOR,
    },
  });
  editor.select(id);
  editor.centerOnPoint(
    { x: x + NOTE_W / 2, y: y + NOTE_H / 2 },
    { animation: { duration: 300 } },
  );
}

/** Attach the AI analysis (and duration) to an existing note by id — updates
 *  ONLY those props, so it never clobbers a transcript the user has edited. */
export function updateVoiceNoteAnalysisOnBoard(
  editor: Editor,
  d: VoiceNoteAnalysisDetail,
): void {
  if (!d?.voiceNoteId) return;
  const existing = editor
    .getCurrentPageShapes()
    .find(
      (s) =>
        s.type === "voice-note-card" &&
        (s as VoiceNoteCardShape).props.voiceNoteId === d.voiceNoteId,
    );
  if (!existing) return;
  editor.updateShape<VoiceNoteCardShape>({
    id: existing.id,
    type: "voice-note-card",
    props: {
      analysisJson: d.analysisJson,
      ...(typeof d.durationMs === "number" ? { durationMs: d.durationMs } : {}),
    },
  });
}

export function deployJournalOnBoard(
  editor: Editor,
  d: JournalCardDetail,
): void {
  // One journal card per board — update in place when it already exists
  // (the continuous re-synthesis path).
  const existing = editor
    .getCurrentPageShapes()
    .find((s) => s.type === "journal-card");
  if (existing) {
    editor.updateShape<JournalCardShape>({
      id: existing.id,
      type: "journal-card",
      props: {
        title: d.title,
        sectionsJson: d.sectionsJson,
        pageCount: d.pageCount,
        status: d.status,
        color: d.color || JOURNAL_COLOR,
      },
    });
    return;
  }

  // Place to the right of the objective/notes column.
  const anchor = anchorPoint(editor);
  const x = anchor.x + 60;
  const y = anchor.y + 64;
  const id = createShapeId();
  editor.createShape<JournalCardShape>({
    id,
    type: "journal-card",
    x,
    y,
    props: {
      w: 380,
      h: 320,
      spaceId: d.spaceId,
      title: d.title || "Journal",
      sectionsJson: d.sectionsJson,
      pageCount: d.pageCount,
      status: d.status,
      open: false,
      color: d.color || JOURNAL_COLOR,
    },
  });
  editor.select(id);
}

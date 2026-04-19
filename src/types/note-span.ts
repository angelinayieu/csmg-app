/**
 * Note-entity-span types — Sprint 0 substrate
 *
 * Character-range anchoring for AI-detected concepts inside sticky notes.
 * Source of truth: supabase/migrations/20260501_note_entity_spans.sql
 */

export type SpanStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "dismissed"
  | "stale";

export type SpanSource =
  | "ambient"
  | "weave"
  | "manual"
  | "hierarchical"
  | "ambient_promoted";

export interface NoteEntitySpan {
  id: string;
  owner_id: string;

  canvas_id: string;
  /** tldraw shape id of the sticky note inside the canvas snapshot */
  note_id: string;

  entity_id: string | null;
  proposed_entity_name: string | null;

  /** Inclusive start, exclusive end. start < end. */
  start_offset: number;
  end_offset: number;

  status: SpanStatus;
  source: SpanSource;
  confidence: number | null;

  /** Snapshot of the text at the offsets when the span was created; used
   *  to detect and mark spans as 'stale' if the note text is later edited. */
  anchored_text: string | null;

  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/** Client-side input when the ambient or weave writer creates a span */
export interface CreateSpanInput {
  canvas_id: string;
  note_id: string;
  entity_id?: string;
  proposed_entity_name?: string;
  start_offset: number;
  end_offset: number;
  source: SpanSource;
  confidence?: number;
  anchored_text?: string;
}

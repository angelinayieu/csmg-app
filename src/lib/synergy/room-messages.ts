// ── Shared types for room chat ──
//
// Pure type module — no runtime exports. The wire format is identical
// to the DB row so the hook can hand rows straight to the renderer.

export type RoomMessageKind = "text" | "voice_transcript" | "ai_summary";

export interface RoomMessage {
  id: string;
  room_id: string;
  author_id: string;
  kind: RoomMessageKind;
  body: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

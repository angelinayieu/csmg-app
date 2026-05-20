// ── Server-side room event writer ──
//
// Called from the room node API routes (POST / PATCH / DELETE) after
// a successful node mutation. Soft-fails — if the event insert errors,
// we log to console but don't fail the parent request. The user's
// node action already landed; the timeline rail is decorative.
//
// Why server-side: it keeps the actor_id authoritative (we stamp it
// from the auth context, not from client input) and keeps RLS clean
// (clients never touch this table directly for writes).

export type RoomEventKind =
  | "node_added"
  | "node_edited"
  | "node_moved"
  | "node_deleted"
  | "node_linked"
  | "note";

interface InsertOpts {
  roomId: string;
  actorId: string;
  kind: RoomEventKind;
  targetNodeId?: string | null;
  /** ≤500 chars. Composed by the caller — drives the rail row text. */
  summary: string;
  payload?: Record<string, unknown> | null;
}

/**
 * Insert one event row. Returns true on success, false on soft-fail.
 *
 * Uses the caller-passed Supabase client so it inherits the request's
 * auth context. RLS policy will gate the insert by membership; we
 * don't double-check here.
 */
export async function insertRoomEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: InsertOpts,
): Promise<boolean> {
  try {
    const summary = (opts.summary ?? "").trim().slice(0, 500);
    if (!summary) return false;
    const { error } = await supabase.from("synergy_room_events").insert({
      room_id: opts.roomId,
      actor_id: opts.actorId,
      kind: opts.kind,
      target_node_id: opts.targetNodeId ?? null,
      summary,
      payload: opts.payload ?? null,
    });
    if (error) {
      console.warn("[room-events] insert failed (soft):", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[room-events] insert threw (soft):", (e as Error).message);
    return false;
  }
}

/**
 * Build a stable preview snippet from a node label. Used as the
 * `summary` text for node_added / node_deleted events.
 */
export function previewLabel(label: string, limit = 80): string {
  const trimmed = (label ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, limit - 1).trimEnd() + "…";
}

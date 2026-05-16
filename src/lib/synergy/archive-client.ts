// ── Archive client helper ──
//
// Thin fetch wrapper around POST /api/synergy/rooms/[id]/archive.
// Same error shape as the other client helpers (throws Error(msg)
// on non-2xx).

export interface ArchiveResult {
  room_id: string;
  archived_at: string;
  already_archived: boolean;
}

export async function archiveRoom(roomId: string): Promise<ArchiveResult> {
  const res = await fetch(
    `/api/synergy/rooms/${encodeURIComponent(roomId)}/archive`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as ArchiveResult;
}

// ── Divergence client helper ──
//
// Thin fetch wrapper around POST /api/synergy/rooms/[id]/dismiss-divergence.
// Throws Error(msg) on non-2xx, same pattern as the other lib/synergy
// client helpers.

export async function dismissDivergence(
  roomId: string,
): Promise<{ ok: true; dismissed_at?: string; no_op?: string }> {
  const res = await fetch(
    `/api/synergy/rooms/${encodeURIComponent(roomId)}/dismiss-divergence`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as {
    ok: true;
    dismissed_at?: string;
    no_op?: string;
  };
}

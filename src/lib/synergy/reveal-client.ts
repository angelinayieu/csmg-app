// ── Identity-reveal client helpers ──
//
// Three fetch wrappers for the C-3 endpoints:
//   - revealIdentity(roomId) → POST /reveal
//   - withdrawReveal(roomId) → DELETE /reveal
//   - fetchPeerProfile(roomId) → GET /peer-profile (only after mutual reveal)
//
// All throw Error(msg) on non-2xx. Same pattern as checkin-client.ts
// and parallel-path-client.ts.

export interface RevealRow {
  id: string;
  room_id: string;
  user_id: string;
  revealed_at: string;
}

export interface PeerProfile {
  display_name: string | null;
  avatar_url: string | null;
}

export async function revealIdentity(
  roomId: string,
): Promise<RevealRow> {
  const res = await fetch(
    `/api/synergy/rooms/${encodeURIComponent(roomId)}/reveal`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { reveal: RevealRow };
  return body.reveal;
}

export async function withdrawReveal(
  roomId: string,
): Promise<{ ok: true }> {
  const res = await fetch(
    `/api/synergy/rooms/${encodeURIComponent(roomId)}/reveal`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { ok: true };
}

export async function fetchPeerProfile(
  roomId: string,
): Promise<PeerProfile> {
  const res = await fetch(
    `/api/synergy/rooms/${encodeURIComponent(roomId)}/peer-profile`,
    { method: "GET" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as PeerProfile;
}

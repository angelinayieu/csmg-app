// ── Check-in client helpers ──
//
// Thin fetch wrappers around the three /checkin endpoints. Used by
// CheckinButton + ReflectionEditor in the parallel-room interior.
// Same error shape as parallel-path-client.ts — throws Error(msg) on
// non-2xx, returns the typed body on 2xx.

export interface CheckinRow {
  id: string;
  room_id: string;
  user_id: string;
  step_block_id: string;
  marked_complete_at: string;
  reflection: string | null;
  updated_at: string;
}

export async function markStepComplete(args: {
  roomId: string;
  stepBlockId: string;
  reflection?: string | null;
}): Promise<CheckinRow> {
  const res = await fetch(
    `/api/synergy/rooms/${encodeURIComponent(args.roomId)}/checkin`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        step_block_id: args.stepBlockId,
        reflection: args.reflection ?? null,
      }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { checkin: CheckinRow };
  return body.checkin;
}

export async function updateReflection(args: {
  roomId: string;
  checkinId: string;
  reflection: string | null;
}): Promise<CheckinRow> {
  const res = await fetch(
    `/api/synergy/rooms/${encodeURIComponent(args.roomId)}/checkin/${encodeURIComponent(args.checkinId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reflection: args.reflection }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { checkin: CheckinRow };
  return body.checkin;
}

export async function undoCheckin(args: {
  roomId: string;
  checkinId: string;
}): Promise<{ ok: true }> {
  const res = await fetch(
    `/api/synergy/rooms/${encodeURIComponent(args.roomId)}/checkin/${encodeURIComponent(args.checkinId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { ok: true };
}

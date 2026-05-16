// ── Parallel-path client helpers ──
//
// Thin fetch wrappers around the two parallel-path endpoints. Used by
// the card components on the Rooms surface. Same error shape as
// everything else in /lib/synergy/client.ts — throws Error(message) on
// non-2xx, returns the typed body on 2xx.

interface SentRequest {
  id: string;
  from_user: string;
  to_user: string;
  from_strategy: string;
  to_strategy: string;
  message: string | null;
  status: "pending" | "accepted" | "declined" | "expired";
  created_at: string;
  expires_at: string;
}

export async function sendParallelPathRequest(args: {
  fromStrategyId: string;
  toStrategyId: string;
  message?: string;
}): Promise<SentRequest> {
  const res = await fetch("/api/synergy/parallel-path-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from_strategy: args.fromStrategyId,
      to_strategy: args.toStrategyId,
      message: args.message,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { request: SentRequest };
  return body.request;
}

export async function respondToParallelPathRequest(
  id: string,
  action: "accept" | "decline",
): Promise<{ ok: true; room_id?: string }> {
  const res = await fetch(
    `/api/synergy/parallel-path-requests/${id}/respond`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { ok: true; room_id?: string };
}

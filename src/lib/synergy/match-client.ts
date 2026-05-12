// ── Synergy matching — client wrappers + types ──
//
// Kept in a small file separate from synergy/client.ts so we don't
// pull the entire match-data graph type surface into every consumer.

export type MatchDirectionKind = "complement" | "parallel";

export interface RedactedMatchSide {
  id: string;
  session_id?: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
  objective_statement?: string | null;
}

export interface RedactedMatch {
  id: string;
  mine: RedactedMatchSide;
  theirs: RedactedMatchSide;
  direction: {
    kind: MatchDirectionKind;
    mine_needs_theirs: boolean;
    theirs_needs_mine: boolean;
  };
  scores: {
    final: number;
    complementarity: number;
    goal_alignment: number;
    cosine_sim: number;
  };
  rationale: string;
  computed_at: string;
}

export interface MatchesPage {
  matches: RedactedMatch[];
  next_cursor: string | null;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface MatchRunResult {
  candidates_considered_total: number;
  matches_persisted_total: number;
  components_processed: number;
  errors?: string[];
}

export async function runSessionMatch(sessionId: string): Promise<MatchRunResult> {
  const res = await fetch(
    `/api/synergy/sessions/${sessionId}/components/match`,
    { method: "POST" },
  );
  return asJson<MatchRunResult>(res);
}

export async function listMatches(opts?: {
  cursor?: string;
  limit?: number;
  matchKind?: "a_needs_b" | "b_needs_a" | "parallel";
  minScore?: number;
}): Promise<MatchesPage> {
  const params = new URLSearchParams();
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.matchKind) params.set("match_kind", opts.matchKind);
  if (opts?.minScore != null) params.set("min_score", String(opts.minScore));
  const qs = params.toString();
  const res = await fetch(`/api/synergy/matches${qs ? "?" + qs : ""}`);
  return asJson<MatchesPage>(res);
}

// ── Phase 4c — match request wrappers ──

export type MatchRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn";

export interface MatchRequestComponentRef {
  kind: string;
  label_public: string;
  description_public: string;
}

export interface MatchRequestOtherParty {
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface HydratedMatchRequest {
  id: string;
  direction: "incoming" | "outgoing";
  status: MatchRequestStatus;
  message: string | null;
  created_at: string;
  responded_at: string | null;
  expires_at: string;
  my_component: MatchRequestComponentRef | null;
  their_component: MatchRequestComponentRef | null;
  // Revealed only when status is 'pending' or 'accepted'
  other_party: MatchRequestOtherParty | null;
}

export interface CreatedRequest {
  id: string;
  status: MatchRequestStatus;
  created_at: string;
  expires_at: string;
}

export async function createMatchRequest(input: {
  fromComponentId: string;
  toComponentId: string;
  message?: string;
}): Promise<CreatedRequest> {
  const res = await fetch("/api/synergy/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from_component_id: input.fromComponentId,
      to_component_id: input.toComponentId,
      message: input.message,
    }),
  });
  const json = await asJson<{ request: CreatedRequest }>(res);
  return json.request;
}

export async function listMatchRequests(
  direction: "incoming" | "outgoing" = "incoming",
  status?: MatchRequestStatus,
): Promise<HydratedMatchRequest[]> {
  const params = new URLSearchParams({ direction });
  if (status) params.set("status", status);
  const res = await fetch(`/api/synergy/requests?${params.toString()}`);
  const json = await asJson<{ requests: HydratedMatchRequest[] }>(res);
  return json.requests;
}

export async function updateMatchRequest(
  id: string,
  action: "accept" | "decline" | "withdraw",
): Promise<MatchRequestStatus> {
  const res = await fetch(`/api/synergy/requests/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const json = await asJson<{ request: { status: MatchRequestStatus } }>(res);
  return json.request.status;
}

export interface SynergyProfile {
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export async function getProfile(userId: string): Promise<SynergyProfile | null> {
  const res = await fetch(`/api/synergy/profiles/${userId}`);
  const json = await asJson<{ profile: SynergyProfile | null }>(res);
  return json.profile;
}

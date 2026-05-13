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

export interface MatchRequestState {
  id: string;
  status: "pending" | "accepted" | "declined" | "expired" | "withdrawn";
  expires_at: string;
  direction: "outgoing" | "incoming";
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
  // Phase 4c v2: any existing request between these two components.
  // Null when none exists. Used by Discover to render correct state.
  request_state: MatchRequestState | null;
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
  // Cold-start mode — drops the score floor to 30 server-side and
  // tags rows as "exploratory" in the UI. Used by the discover
  // empty state's "lower the bar" CTA.
  includeExploratory?: boolean;
}): Promise<MatchesPage> {
  const params = new URLSearchParams();
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.matchKind) params.set("match_kind", opts.matchKind);
  if (opts?.minScore != null) params.set("min_score", String(opts.minScore));
  if (opts?.includeExploratory) params.set("include_exploratory", "1");
  const qs = params.toString();
  const res = await fetch(`/api/synergy/matches${qs ? "?" + qs : ""}`);
  return asJson<MatchesPage>(res);
}

// Marketplace stats for the cold-start empty state. All aggregated,
// no PII. Cheap to call.
export interface MarketplaceStats {
  total_matchable_components: number;
  recent_publishes_24h: number;
  active_rooms_7d: number;
  kind_distribution: Array<{ kind: string; count: number }>;
  recent_activity_score: number;
}

export async function getMarketplaceStats(): Promise<MarketplaceStats> {
  const res = await fetch("/api/synergy/marketplace/stats");
  return asJson<MarketplaceStats>(res);
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
  // Tier 2.3: user_id is exposed only when the server-side
  // profileReveal gate allows it (outgoing-pending OR accepted).
  // Used by the inbox to deep-link to the public profile route.
  user_id?: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface HydratedMatchRequest {
  id: string;
  direction: "incoming" | "outgoing";
  status: MatchRequestStatus;
  message: string | null;
  additional_components: MatchRequestComponentRef[];
  match: MatchRequestMatchContext | null;
  created_at: string;
  responded_at: string | null;
  expires_at: string;
  seen_at: string | null;
  my_component: MatchRequestComponentRef | null;
  their_component: MatchRequestComponentRef | null;
  // Privacy-gated (Phase 4c v2):
  //   - Incoming PENDING:  null (project-not-person decision)
  //   - Outgoing PENDING:  revealed (sender already chose to engage)
  //   - Accepted:          revealed both ways
  //   - Declined/expired/withdrawn: null
  // The Accept confirmation modal calls /accept-preview to surface the
  // sender's profile at the moment-of-decision instead.
  other_party: MatchRequestOtherParty | null;
}

export interface MatchRequestMatchContext {
  rationale: string;
  final_score: number;
  complementarity_score: number;
  goal_alignment_score: number;
}

export interface CreatedRequest {
  id: string;
  status: MatchRequestStatus;
  created_at: string;
  expires_at: string;
}

export interface AcceptPreviewResponse {
  sender_profile: MatchRequestOtherParty | null;
  my_profile: MatchRequestOtherParty | null;
  additional_components: MatchRequestComponentRef[];
  expires_at: string;
}

export interface ExistingInboundResponse {
  kind: "existing_inbound";
  message: string;
  request_id: string;
}

export async function createMatchRequest(input: {
  fromComponentId: string;
  toComponentId: string;
  matchId?: string;
  message?: string;
  additionalComponentIds?: string[];
}): Promise<CreatedRequest | ExistingInboundResponse> {
  const res = await fetch("/api/synergy/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      from_component_id: input.fromComponentId,
      to_component_id: input.toComponentId,
      match_id: input.matchId,
      message: input.message,
      additional_component_ids: input.additionalComponentIds,
    }),
  });
  // Bidirectional resolve: 409 + { kind: "existing_inbound" } means
  // the second sender should respond to the existing request instead.
  if (res.status === 409) {
    const body = (await res.json()) as
      | ExistingInboundResponse
      | { error: string; code?: string };
    if ("kind" in body && body.kind === "existing_inbound") {
      return body;
    }
    throw new Error("error" in body ? body.error : "Conflict");
  }
  const json = await asJson<{ request: CreatedRequest }>(res);
  return json.request;
}

export async function acceptPreview(
  requestId: string,
): Promise<AcceptPreviewResponse> {
  const res = await fetch(
    `/api/synergy/requests/${requestId}/accept-preview`,
    { method: "POST" },
  );
  return asJson<AcceptPreviewResponse>(res);
}

export async function getNotificationCount(): Promise<number> {
  const res = await fetch("/api/synergy/notifications/count");
  const json = await asJson<{ unseen_incoming: number }>(res);
  return json.unseen_incoming;
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

// ── Rooms surface types ──
//
// Shared shape between the server page (which assembles the data
// across many tables in parallel) and the client view. Kept in its own
// file so both halves stay type-aligned without circular imports.
//
// The Rooms surface carries TWO kinds of rooms side by side:
//   - Collaboration rooms: built from component_matches (complementary
//     fit — your upstream need ↔ their downstream output)
//   - Parallel-path rooms: built from strategy_matches (convergent
//     goal, possibly divergent routine — peer / accountability fit)
//
// Each kind has the same sub-section shape: Active / Invitations /
// Suggested. The top-level segmented control flips between them.

// ── Collaboration kind (existing) ──

export interface ActiveRoom {
  id: string;
  intersection_objective: string | null;
  created_at: string;
  my_component_label: string;
  their_component_label: string;
  their_component_kind: string;
  /** Revealed post-accept. null until the room exists. */
  their_display_name: string | null;
  their_avatar_url: string | null;
  /** Stable seed for the abstract avatar fallback. */
  other_user_seed: string;
}

export interface Invitation {
  id: string;
  message: string | null;
  created_at: string;
  expires_at: string;
  /** Anonymized — sender stays hidden until the user accepts. */
  their_component_label: string;
  their_component_kind: string;
  my_component_label: string;
  /** Stable seed for the abstract sender avatar (we use the request
   *  id rather than the sender's user id so identity doesn't leak). */
  seed: string;
}

export interface SuggestedRoom {
  id: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
  match_count: number;
  session_id: string;
}

export interface CollabRoomsSlice {
  active: ActiveRoom[];
  invitations: Invitation[];
  suggested: SuggestedRoom[];
}

// ── Parallel-path kind (Phase 5b) ──

export interface ActiveParallelRoomCard {
  room_id: string;
  shared_theme: string;
  shared_pillars: string[];
  // Per-user progress for the dual mini-rail. Each side is independent:
  // you may have a 5-step plan, they may have a 4-step plan.
  my_completions: number;
  my_total_steps: number;
  their_completions: number;
  their_total_steps: number;
  /** Revealed post-accept (same model as collab rooms). */
  their_display_name: string | null;
  their_avatar_url: string | null;
  other_user_seed: string;
  /** Most recent activity (checkin OR room creation). For sort + last-active label. */
  last_activity_at: string;
  /** Latest weekly digest snapshot for the "+N you · +M them this week"
   *  delta tail on the card. Null when no digest has been generated yet
   *  (room younger than first Monday cron or both sides zero). */
  latest_digest: {
    week_starting: string;
    my_week_completions: number;
    their_week_completions: number;
  } | null;
}

export interface ParallelInvitationCard {
  request_id: string;
  shared_theme: string;
  shared_pillars: string[];
  divergence_summary: string | null;
  message: string | null;
  created_at: string;
  expires_at: string;
  /** Avatar seeded by request_id (not sender user_id) so identity
   *  doesn't leak across reloads. */
  seed: string;
}

export interface SuggestedParallelMatch {
  match_id: string;
  my_strategy_id: string;
  my_strategy_statement: string;
  their_strategy_id: string;
  shared_theme: string;
  shared_pillars: string[];
  divergence_summary: string | null;
  // 0-100 — the final_score from strategy_matches, surfaced as
  // "87% similar" on the card.
  final_score: number;
  their_seed: string;
  their_plan_step_count: number;
}

export interface ParallelRoomsSlice {
  active: ActiveParallelRoomCard[];
  invitations: ParallelInvitationCard[];
  suggested: SuggestedParallelMatch[];
  /** For empty-state branching: how many strategies the user has at all. */
  my_strategies_count: number;
  /** How many of those are published + matchable (the gate for being a
   *  parallel-path candidate). */
  my_matchable_published_count: number;
}

// ── Combined bundle ──

export interface RoomsBundle {
  collab: CollabRoomsSlice;
  parallel: ParallelRoomsSlice;
}

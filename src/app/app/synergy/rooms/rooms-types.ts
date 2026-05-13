// ── Rooms surface types ──
//
// Shared shape between the server page (which assembles the data
// across 5 tables in parallel) and the client view. Kept in its own
// file so both halves stay type-aligned without circular imports.

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

export interface RoomsBundle {
  active: ActiveRoom[];
  invitations: Invitation[];
  suggested: SuggestedRoom[];
}

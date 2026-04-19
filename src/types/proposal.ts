/**
 * Concept-proposal types — Sprint 0 substrate
 *
 * Durable queue for ambient / weave / hierarchical concept detections
 * awaiting user accept/reject in the ProposalRail (Sprint 3).
 *
 * Source of truth: supabase/migrations/20260504_concept_proposals.sql
 */

export type ProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "dismissed"
  | "expired"
  | "superseded";

export type ProposalSource = "ambient" | "weave" | "hierarchical" | "manual";

export interface ConceptProposal {
  id: string;
  owner_id: string;

  canvas_id: string;
  note_id: string;
  span_id: string | null;

  start_offset: number | null;
  end_offset: number | null;
  anchored_text: string | null;

  entity_id: string | null;
  proposed_entity_name: string | null;
  proposed_entity_description: string | null;

  /** If the candidate entity lives on a different canvas, accepting this
   *  proposal creates a bridges row linking the two. */
  target_canvas_id: string | null;

  rationale: string | null;

  confidence: number;
  source: ProposalSource;

  status: ProposalStatus;

  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/** POST /api/canvas/ambient — one per detected (span, candidate) pair */
export interface CreateProposalInput {
  canvas_id: string;
  note_id: string;
  span_id?: string;
  start_offset?: number;
  end_offset?: number;
  anchored_text?: string;
  entity_id?: string;
  proposed_entity_name?: string;
  proposed_entity_description?: string;
  target_canvas_id?: string;
  rationale?: string;
  confidence: number;
  source: ProposalSource;
}

/** POST /api/proposals/:id/resolve */
export interface ResolveProposalInput {
  action: "accept" | "reject" | "dismiss";
  /** If accepting and the proposal had no entity_id, the user can edit
   *  the name before materialization. */
  override_entity_name?: string;
}

/** ProposalRail grouping — one entry per note, with spans nested */
export interface ProposalGroup {
  note_id: string;
  note_text: string;
  spans: Array<{
    start_offset: number | null;
    end_offset: number | null;
    anchored_text: string | null;
    proposals: ConceptProposal[];
  }>;
}

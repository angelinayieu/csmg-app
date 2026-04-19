/**
 * Entity Question — a user-authored question attached to a specific entity.
 *
 * Lifecycle: open → researching → answered | dismissed
 *
 * Stored in the `entity_questions` table.
 */

export type EntityQuestionStatus = "open" | "researching" | "answered" | "dismissed";

export interface EntityQuestionResultRefs {
  claim_ids?: string[];
  edge_ids?: string[];
  entity_ids?: string[];
}

export interface EntityQuestion {
  id: string;
  space_id: string;
  entity_id: string;
  question_text: string;
  status: EntityQuestionStatus;
  answer_text: string | null;
  result_refs: EntityQuestionResultRefs;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
}

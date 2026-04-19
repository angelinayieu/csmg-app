/**
 * Zod validators for Sprint 0 substrate.
 *
 * Applied at every API boundary that touches canvases, spans, proposals,
 * memory, or the new bridge columns. Kept in a dedicated file so the
 * Sprint 1–5 endpoints can import from one place; the older
 * `src/lib/validation.ts` focuses on LLM-output validation and stays
 * independent.
 *
 * Matches schema in:
 *   - supabase/migrations/20260430_canvases.sql
 *   - supabase/migrations/20260501_note_entity_spans.sql
 *   - supabase/migrations/20260502_bridges_shared_substrate.sql
 *   - supabase/migrations/20260503_memory_items.sql
 *   - supabase/migrations/20260504_concept_proposals.sql
 */

import { z } from "zod";

// ─── Shared enums (mirror DB CHECK constraints exactly) ──────────────
export const CanvasScopeEnum = z.enum([
  "universal",
  "project",
  "objective",
  "app",
]);
export const CanvasScopeRefTypeEnum = z.enum([
  "space",
  "improvement_goal",
  "app",
]);

export const SpanStatusEnum = z.enum([
  "proposed",
  "accepted",
  "rejected",
  "dismissed",
  "stale",
]);
export const SpanSourceEnum = z.enum([
  "ambient",
  "weave",
  "manual",
  "hierarchical",
  "ambient_promoted",
]);

export const ProposalStatusEnum = z.enum([
  "pending",
  "accepted",
  "rejected",
  "dismissed",
  "expired",
  "superseded",
]);
export const ProposalSourceEnum = z.enum([
  "ambient",
  "weave",
  "hierarchical",
  "manual",
]);

export const BridgeOriginEnum = z.enum([
  "weave",
  "universal_canvas",
  "ambient_promoted",
  "manual",
]);
export const BridgeStatusEnum = z.enum([
  "active",
  "user_confirmed",
  "user_rejected",
]);
export const BridgeTypeEnum = z.enum(["identity", "influence", "structural"]);
export const BridgeCouplingStrengthEnum = z.enum([
  "strong",
  "moderate",
  "weak",
]);
export const BridgeCouplingDirectionEnum = z.enum([
  "source_to_target",
  "target_to_source",
  "bidirectional",
]);

export const MemoryKindEnum = z.enum([
  "entity",
  "note",
  "bridge",
  "objective",
  "app",
  "canvas",
]);

// ─── Canvas ──────────────────────────────────────────────────────────
export const CreateCanvasInputSchema = z
  .object({
    scope: CanvasScopeEnum,
    scope_ref_type: CanvasScopeRefTypeEnum.optional(),
    scope_ref_id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
  })
  .refine(
    (v) =>
      v.scope === "universal"
        ? v.scope_ref_type === undefined && v.scope_ref_id === undefined
        : v.scope_ref_type !== undefined && v.scope_ref_id !== undefined,
    {
      message:
        "scope_ref_type + scope_ref_id are required for non-universal scopes, and must be absent for universal.",
    },
  )
  .refine(
    (v) => {
      // scope ↔ scope_ref_type pairing
      if (v.scope === "project") return v.scope_ref_type === "space";
      if (v.scope === "objective")
        return v.scope_ref_type === "improvement_goal";
      if (v.scope === "app") return v.scope_ref_type === "app";
      return true;
    },
    { message: "scope_ref_type does not match the declared scope." },
  );

export const UpdateCanvasInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    snapshot: z.unknown().optional(),
    schema_version: z.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided.",
  });

export const CanvasListQuerySchema = z.object({
  scope: CanvasScopeEnum.optional(),
  pinned: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Note-entity-span ────────────────────────────────────────────────
export const CreateSpanInputSchema = z
  .object({
    canvas_id: z.string().uuid(),
    note_id: z.string().min(1),
    entity_id: z.string().uuid().optional(),
    proposed_entity_name: z.string().trim().min(1).max(200).optional(),
    start_offset: z.number().int().min(0),
    end_offset: z.number().int().min(1),
    source: SpanSourceEnum,
    confidence: z.number().min(0).max(1).optional(),
    anchored_text: z.string().max(5000).optional(),
  })
  .refine((v) => v.end_offset > v.start_offset, {
    message: "end_offset must be > start_offset",
    path: ["end_offset"],
  })
  .refine(
    (v) =>
      v.entity_id !== undefined || v.proposed_entity_name !== undefined,
    {
      message: "Either entity_id or proposed_entity_name must be set.",
    },
  );

export const UpdateSpanStatusSchema = z.object({
  status: SpanStatusEnum,
});

// ─── Concept-proposal ────────────────────────────────────────────────
export const CreateProposalInputSchema = z
  .object({
    canvas_id: z.string().uuid(),
    note_id: z.string().min(1),
    span_id: z.string().uuid().optional(),
    start_offset: z.number().int().min(0).optional(),
    end_offset: z.number().int().min(1).optional(),
    anchored_text: z.string().max(5000).optional(),
    entity_id: z.string().uuid().optional(),
    proposed_entity_name: z.string().trim().min(1).max(200).optional(),
    proposed_entity_description: z.string().trim().max(2000).optional(),
    target_canvas_id: z.string().uuid().optional(),
    rationale: z.string().trim().max(500).optional(),
    confidence: z.number().min(0).max(1),
    source: ProposalSourceEnum,
  })
  .refine(
    (v) =>
      v.entity_id !== undefined || v.proposed_entity_name !== undefined,
    { message: "Either entity_id or proposed_entity_name must be set." },
  )
  .refine(
    (v) =>
      v.start_offset === undefined ||
      v.end_offset === undefined ||
      v.end_offset > v.start_offset,
    {
      message: "end_offset must be > start_offset when both are provided.",
      path: ["end_offset"],
    },
  );

export const ResolveProposalInputSchema = z.object({
  action: z.enum(["accept", "reject", "dismiss"]),
  override_entity_name: z.string().trim().min(1).max(200).optional(),
});

// ─── Ambient-detection batch (Sprint 3 endpoint input) ───────────────
// The ambient endpoint receives the current note text + canvas context
// and returns proposals. This validates the request body.
export const AmbientRequestSchema = z.object({
  canvas_id: z.string().uuid(),
  note_id: z.string().min(1),
  note_text: z.string().max(20_000),
  // Previously-accepted spans in this note, so the detector can avoid
  // re-proposing them.
  existing_accepted_entity_ids: z.array(z.string().uuid()).default([]),
});

// ─── Proposal-detect endpoint (Sprint 3) ─────────────────────────────
// POST /api/canvas/proposals/detect — segments the note, runs semantic
// retrieval per segment, upserts concept_proposals, returns grouped
// results. The client debounces 600ms on keystroke and calls this
// endpoint; the response plus GET /api/canvas/[id]/proposals power the
// ProposalRail.
export const ProposalDetectRequestSchema = z.object({
  canvas_id: z.string().uuid(),
  note_id: z.string().min(1),
  note_text: z.string().max(20_000),
  /** Min similarity to propose. Defaults to 0.35 — low enough that
   *  medium-confidence matches surface; high enough that random-walk
   *  embedding noise doesn't flood the rail. */
  min_similarity: z.number().min(0).max(1).optional(),
  /** Max candidates per span. Keeps the rail tidy. */
  candidates_per_span: z.number().int().min(1).max(5).optional(),
});

export type ProposalDetectRequestParsed = z.infer<
  typeof ProposalDetectRequestSchema
>;

// ─── Bridge (new inputs for Sprint 4) ────────────────────────────────
export const CreateManualBridgeInputSchema = z.object({
  canvas_id: z.string().uuid(),
  source_entity_id: z.string().uuid(),
  target_entity_id: z.string().uuid(),
  bridge_type: BridgeTypeEnum,
  coupling_strength: BridgeCouplingStrengthEnum,
  coupling_direction: BridgeCouplingDirectionEnum,
  shared_variable_name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  rationale: z.string().trim().max(500).optional(),
});

export const ResolveBridgeInputSchema = z.object({
  action: z.enum(["confirm", "reject"]),
});

// ─── Canvas frames (Sprint 4 — universal canvas composition) ─────────
export const CreateFrameInputSchema = z.object({
  frame_canvas_id: z.string().uuid(),
  position_x: z.number().optional(),
  position_y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  pinned_entity_ids: z.array(z.string().uuid()).optional(),
});

export const UpdateFrameInputSchema = z
  .object({
    position_x: z.number().optional(),
    position_y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    display_order: z.number().int().optional(),
    pinned_entity_ids: z.array(z.string().uuid()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided.",
  });

// ─── Canvas weave (Sprint 4 — pairwise weave over all frames) ────────
export const RunCanvasWeaveInputSchema = z
  .object({
    /** Max pairs to analyze. Defaults to 10 (45 pairs possible for 10
     *  frames; we cap to protect LLM credits). */
    max_pairs: z.number().int().min(1).max(45).optional(),
  })
  .default({});

export type CreateFrameInputParsed = z.infer<typeof CreateFrameInputSchema>;
export type UpdateFrameInputParsed = z.infer<typeof UpdateFrameInputSchema>;
export type RunCanvasWeaveInputParsed = z.infer<
  typeof RunCanvasWeaveInputSchema
>;

// ─── Memory query (Sprint 2 retriever) ───────────────────────────────
export const MemoryQuerySchema = z.object({
  query_text: z.string().trim().min(1).max(5000),
  scopes: z.array(CanvasScopeEnum).optional(),
  scope_ref_ids: z.array(z.string().uuid()).optional(),
  kinds: z.array(MemoryKindEnum).optional(),
  k: z.number().int().min(1).max(50).default(10),
  min_salience: z.number().min(0).max(1).default(0),
});

// ─── Inferred types (for use in handlers) ────────────────────────────
export type CreateCanvasInputParsed = z.infer<typeof CreateCanvasInputSchema>;
export type UpdateCanvasInputParsed = z.infer<typeof UpdateCanvasInputSchema>;
export type CanvasListQueryParsed = z.infer<typeof CanvasListQuerySchema>;
export type CreateSpanInputParsed = z.infer<typeof CreateSpanInputSchema>;
export type CreateProposalInputParsed = z.infer<
  typeof CreateProposalInputSchema
>;
export type ResolveProposalInputParsed = z.infer<
  typeof ResolveProposalInputSchema
>;
export type AmbientRequestParsed = z.infer<typeof AmbientRequestSchema>;
export type CreateManualBridgeInputParsed = z.infer<
  typeof CreateManualBridgeInputSchema
>;
export type ResolveBridgeInputParsed = z.infer<typeof ResolveBridgeInputSchema>;
export type MemoryQueryParsed = z.infer<typeof MemoryQuerySchema>;

/**
 * Zod validators for Wave A goal approve/reject endpoints.
 *
 * Mirrors: src/types/entity-objective.ts (ApproveGoalInput, RejectGoalInput).
 * Schema: supabase/migrations/20260514_objectives_grounding.sql.
 *
 * Approve enforces that by the time the goal flips 'proposed' → 'active',
 * metric_name + target_value are set (directly on the input or already on
 * the proposed row — the endpoint checks both).
 */

import { z } from "zod";

export const ApproveGoalInputSchema = z.object({
  metric_name: z.string().trim().min(1).max(200).optional(),
  metric_unit: z.string().trim().max(50).optional(),
  target_value: z.number().optional(),
  baseline_value: z.number().optional(),
  deadline: z.string().datetime().nullable().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(5000).optional(),
  keep_entity_links: z.array(z.string().uuid()).optional(),
});

export const RejectGoalInputSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type ApproveGoalInputParsed = z.infer<typeof ApproveGoalInputSchema>;
export type RejectGoalInputParsed = z.infer<typeof RejectGoalInputSchema>;

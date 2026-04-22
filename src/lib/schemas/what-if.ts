/**
 * Zod validators for /api/lab/what-if.
 * Kept in its own file to mirror the canvas-substrate + validation pattern.
 */

import { z } from "zod";

export const WhatIfRequestSchema = z.object({
  target_entity_id: z.string().uuid(),
  direction: z.enum(["strengthen", "weaken", "remove"]),
  magnitude: z.number().min(0.1).max(1.0),
  /** Optional — include cross-space bridges in the neighborhood.
   *  Defaults to true at universal scope, false at space/entity scope. */
  include_cross_space: z.boolean().optional(),
});

export type WhatIfRequestParsed = z.infer<typeof WhatIfRequestSchema>;

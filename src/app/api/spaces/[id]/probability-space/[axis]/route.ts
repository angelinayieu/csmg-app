// ── /api/spaces/[id]/probability-space/[axis] ──────────────────────
//
// GET → return the most-recent probability_space_runs row for this
//       (space, axis), with the persisted axis_output_json (full
//       entities + edges + score) so the drill-down page can render
//       the underlying KG slice without replaying the SSE stream.
//
// Companion to the canvas shell shape's onDoubleClick handler. The
// shell only carries the axis identifier in its tldraw props (no
// space UUID, no run UUID), so we resolve "latest run for this space
// + this axis" server-side here.
//
// Background: a deleted `probability-space-rail` (commit 213047b)
// previously had drill-down handlers; the replacement tldraw shape
// lost them. This endpoint + the companion page restore the
// affordance.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import { AXIS_CATALOG } from "@/lib/probability-space/axis-catalog";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string; axis: string }>;
}

export interface ProbabilitySpaceAxisDetail {
  space_id: string;
  axis: string;
  /** Catalog metadata for the axis (label, accent, tagline, …). Null
   *  for ad-hoc axes minted outside the canonical 8. */
  catalog: {
    label: string;
    accent: string;
    tagline: string;
    generator_focus: string;
  } | null;
  /** The latest probability_space_runs row for this (space, axis) —
   *  whichever pipeline run produced it. Null if the axis was never
   *  generated for this space. */
  run: {
    id: string;
    run_id: string;
    status: string;
    rationale: string;
    order_index: number;
    entities_generated: number;
    started_at: string;
    completed_at: string | null;
    error_message: string | null;
    /** Full per-axis output: entities + edges + score breakdown.
     *  Persisted by /api/pipeline/probability-space/[axis] at
     *  generation time. May be null for older runs that finished
     *  before axis_output_json was added. */
    axis_output_json: unknown;
    axis_semantic_score: unknown;
  } | null;
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId, axis } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Resolve catalog metadata. Ad-hoc axes (not in the canonical 8)
  // are still allowed — their `catalog` field will be null on the
  // response and the page should fall back to the run.rationale +
  // raw axis_output_json.
  const meta = AXIS_CATALOG[axis as ProbabilitySpaceAxis] ?? null;

  // Most-recent run for this (space, axis). Multiple runs can exist
  // (e.g., re-run after edits) — we take the latest by created_at.
  const { data: rows, error } = await supabase
    .from("probability_space_runs")
    .select(
      "id, run_id, status, rationale, order_index, entities_generated, started_at, completed_at, error_message, axis_output_json, axis_semantic_score",
    )
    .eq("space_id", spaceId)
    .eq("axis", axis)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json(
      { error: `Failed to load axis run: ${error.message}` },
      { status: 500 },
    );
  }

  const row = rows?.[0] ?? null;

  const response: ProbabilitySpaceAxisDetail = {
    space_id: spaceId,
    axis,
    catalog: meta
      ? {
          label: meta.label,
          accent: meta.accent,
          tagline: meta.tagline,
          generator_focus: meta.generator_focus,
        }
      : null,
    run: row
      ? {
          id: row.id,
          run_id: row.run_id,
          status: row.status,
          rationale: row.rationale,
          order_index: row.order_index,
          entities_generated: row.entities_generated,
          started_at: row.started_at,
          completed_at: row.completed_at,
          error_message: row.error_message,
          axis_output_json: row.axis_output_json,
          axis_semantic_score: row.axis_semantic_score,
        }
      : null,
  };

  return NextResponse.json(response);
}

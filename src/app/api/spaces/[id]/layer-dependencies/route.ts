// GET /api/spaces/[id]/layer-dependencies
//
// D-track Phase α — read endpoint for inter-layer propagation cascades.
// Returns rows from the `layer_dependencies` table for this space,
// sorted by from-layer ordinal ascending so the response reads as
// "for each layer in fundamental→emergent order, here are its
// outgoing cascades."
//
// Consumers (none ship in Phase α — endpoint is ready for Phase β):
//   • LayerStackShape — to render dependency arrows between layer rows
//   • strategy-variants/generate — to thread cascade context into
//     `layerCascadeContext` on the engine call
//   • variant-card — to render the ripple chip strip (Phase γ)
//
// Empty response is the common case until the synthesize-stage cascade
// prediction (D2) lands and starts populating the table. Returning an
// empty array (not 404) so consumers can render gracefully.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { LayerDependencyRow } from "@/types/layer-ontology";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface LayerDependenciesResponse {
  /** Sorted by from-layer ordinal asc, then by strength desc. Empty
   *  when no cascades have been emitted yet for this space. */
  dependencies: LayerDependencyRow[];
  /** Total count — same as dependencies.length but explicit for
   *  pagination-ready consumers. */
  total: number;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Join against layer_ontology to sort by from-layer ordinal. We do
  // the sort on the client side here (in-memory after fetch) because
  // ordering by a joined column with PostgREST nesting is fiddly and
  // the row count is small (typically <20 per space).
  const { data: rawData, error } = (await db
    .from("layer_dependencies")
    .select(
      `
      *,
      from_layer:layer_ontology!from_layer_id(ordinal),
      to_layer:layer_ontology!to_layer_id(ordinal)
    `,
    )
    .eq("space_id", spaceId)) as {
    data:
      | Array<
          LayerDependencyRow & {
            from_layer?: { ordinal: number } | null;
            to_layer?: { ordinal: number } | null;
          }
        >
      | null;
    error: { message?: string } | null;
  };

  if (error) {
    return NextResponse.json(
      {
        error: `Failed to load layer dependencies: ${error.message ?? "unknown"}`,
      },
      { status: 500 },
    );
  }

  // Strip the join cols off the row shape after using them for sort
  // so the response stays clean against LayerDependencyRow's contract.
  const rows = (rawData ?? []).slice().sort((a, b) => {
    const aOrd = a.from_layer?.ordinal ?? 9999;
    const bOrd = b.from_layer?.ordinal ?? 9999;
    if (aOrd !== bOrd) return aOrd - bOrd;
    // Tie-break by strength descending — strongest cascades surface
    // first within the same from-layer.
    return b.strength - a.strength;
  });

  const dependencies: LayerDependencyRow[] = rows.map((r) => {
    const { from_layer: _from, to_layer: _to, ...clean } = r;
    void _from;
    void _to;
    return clean as LayerDependencyRow;
  });

  const payload: LayerDependenciesResponse = {
    dependencies,
    total: dependencies.length,
  };
  return NextResponse.json(payload);
}

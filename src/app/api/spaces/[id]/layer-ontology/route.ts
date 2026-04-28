// GET /api/spaces/[id]/layer-ontology
//
// Return the per-space layer_ontology rows ordered by ordinal.
// Used by the canvas (via useLayerOntology hook) to color KGNodeShape
// based on entity.layer_ontology_id. Returns [] when no per-space
// ontology has been materialized yet (legacy spaces fall back to
// the hardcoded knowledge_layer enum colors).

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { LayerOntologyRow } from "@/types/layer-ontology";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data, error } = (await db
    .from("layer_ontology")
    .select("*")
    .eq("space_id", spaceId)
    .order("ordinal", { ascending: true })) as {
    data: LayerOntologyRow[] | null;
    error: { message?: string } | null;
  };

  if (error) {
    return NextResponse.json(
      { error: `Failed to load layer ontology: ${error.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ontology: data ?? [] });
}

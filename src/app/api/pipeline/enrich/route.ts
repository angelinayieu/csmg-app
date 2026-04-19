import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const maxDuration = 15; // Lightweight — just validates and returns space metadata

/**
 * POST /api/pipeline/enrich
 *
 * Pre-flight for deep refresh — validates ownership, checks the space has entities,
 * and returns the space metadata needed for client-side orchestration.
 *
 * The actual enrichment (critique → research → synthesize) is orchestrated
 * client-side by useDeepRefresh hook, which calls each stage's existing API route
 * in sequence, reading fresh data from DB at each step.
 */
export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  try {
    const body = await request.json();
    spaceId = body.spaceId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Fetch space metadata
  const { data: spaceData } = await db
    .from("spaces")
    .select("id, name, input_text, space_prefix, description")
    .eq("id", spaceId)
    .single();

  if (!spaceData) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // Check entity count
  const { count: entityCount } = await db
    .from("entities")
    .select("id", { count: "exact", head: true })
    .eq("space_id", spaceId);

  if (!entityCount || entityCount === 0) {
    return NextResponse.json({
      error: "Space has no entities. Run decomposition first.",
    }, { status: 400 });
  }

  return NextResponse.json({
    spaceId: spaceData.id,
    name: spaceData.name,
    inputText: (spaceData.input_text ?? "").slice(0, 4000),
    prefix: spaceData.space_prefix,
    description: spaceData.description ?? "",
    entityCount,
  });
}

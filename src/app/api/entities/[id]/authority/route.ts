import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 10;

/**
 * PATCH /api/entities/[id]/authority
 * Updates an entity's authority_level and marks provenance as user-verified.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    const body = await request.json();
    const { authority_level, provenance: provenanceOverride } = body as {
      authority_level?: string;
      provenance?: Record<string, unknown>;
    };

    // Must have either authority_level or provenance override
    if (!authority_level && !provenanceOverride) {
      return Response.json(
        { error: "authority_level or provenance required" },
        { status: 400 },
      );
    }

    if (authority_level && !["high", "moderate", "low", "unverified"].includes(authority_level)) {
      return Response.json(
        { error: "Invalid authority_level" },
        { status: 400 },
      );
    }

    // Fetch the current entity to get existing provenance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: entity, error: fetchErr } = await (supabase as any)
      .from("entities")
      .select("provenance, space_id")
      .eq("id", id)
      .single();

    if (fetchErr || !entity) {
      return Response.json(
        { error: "Entity not found" },
        { status: 404 },
      );
    }

    // Verify user owns the space
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: space } = await (supabase as any)
      .from("spaces")
      .select("id")
      .eq("id", entity.space_id)
      .eq("user_id", user.id)
      .single();

    if (!space) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Merge provenance with verified_by_user flag and any overrides
    const existingProv =
      typeof entity.provenance === "object" && entity.provenance !== null
        ? (entity.provenance as Record<string, unknown>)
        : {};
    const updatedProv = {
      ...existingProv,
      ...(provenanceOverride ?? {}),
      ...(authority_level ? { verified_by_user: true, authority_override_at: new Date().toISOString() } : {}),
    };

    const updatePayload: Record<string, unknown> = { provenance: updatedProv };
    if (authority_level) updatePayload.authority_level = authority_level;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (supabase as any)
      .from("entities")
      .update(updatePayload)
      .eq("id", id);

    if (updateErr) {
      return Response.json(
        { error: "Failed to update authority: " + updateErr.message },
        { status: 500 },
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[UpdateEntityAuthority] Error:", err);
    return Response.json(
      { error: "Failed to update entity authority" },
      { status: 500 },
    );
  }
}

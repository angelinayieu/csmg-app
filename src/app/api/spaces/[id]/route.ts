import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 15;

/**
 * Lightweight space lookup — returns display-essential fields.
 * Used by AskSpaceView reference chips to name the origin whiteboard.
 * RLS enforces ownership; explicit user_id filter is belt-and-braces.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("spaces")
      .select("id, name, kind, space_prefix")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(data);
  } catch (err) {
    console.error("[GetSpace] Error:", err);
    return Response.json({ error: "Failed to load space" }, { status: 500 });
  }
}

/**
 * PATCH — curate a whiteboard. Currently supports `pinned` and
 * `archived` toggles plus rename. Anything else is silently dropped to
 * keep this endpoint narrow (the pipeline owns auto-fields).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    const body = (await request.json().catch(() => ({}))) as {
      pinned?: boolean;
      archived?: boolean;
      name?: string;
    };

    const update: Record<string, unknown> = {};
    if (typeof body.pinned === "boolean") update.pinned = body.pinned;
    if (typeof body.archived === "boolean") update.archived = body.archived;
    if (typeof body.name === "string" && body.name.trim().length > 0) {
      update.name = body.name.trim().slice(0, 200);
    }

    if (Object.keys(update).length === 0) {
      return Response.json({ error: "No supported fields" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("spaces")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, pinned, archived, name")
      .maybeSingle();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(data);
  } catch (err) {
    console.error("[PatchSpace] Error:", err);
    return Response.json({ error: "Failed to update space" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("spaces")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      return Response.json(
        { error: "Failed to delete space: " + error.message },
        { status: 500 }
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[DeleteSpace] Error:", err);
    return Response.json(
      { error: "Failed to delete space" },
      { status: 500 }
    );
  }
}

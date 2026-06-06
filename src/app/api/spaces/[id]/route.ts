import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 15;

/**
 * Lightweight space lookup — returns just the display-essential fields.
 * Used by the AskSpaceView reference chips to name the origin whiteboard.
 * RLS enforces ownership; we also pin user_id on the read as a belt-and-
 * braces check so cross-user spelunking is impossible even if policies drift.
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

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(data);
  } catch (err) {
    console.error("[GetSpace] Error:", err);
    return Response.json({ error: "Failed to load space" }, { status: 500 });
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

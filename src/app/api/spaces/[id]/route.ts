import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 15;

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

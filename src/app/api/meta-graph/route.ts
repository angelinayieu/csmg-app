import { safeAuth } from "@/lib/api-helpers";
import type { Space, Bridge } from "@/types";

export const maxDuration = 15;

export async function GET() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const [spacesRes, bridgesRes] = await Promise.all([
      db
        .from("spaces")
        .select("id, name, space_prefix, entity_count, edge_count, cycle_count, maturity, parent_space_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      db
        .from("bridges")
        .select("*")
        .in(
          "source_space_id",
          (await db.from("spaces").select("id").eq("user_id", user.id)).data?.map(
            (s: { id: string }) => s.id
          ) ?? []
        ),
    ]);

    const spaces = (spacesRes.data ?? []) as Space[];
    const bridges = (bridgesRes.data ?? []) as Bridge[];

    return Response.json({ spaces, bridges });
  } catch (err) {
    console.error("[MetaGraph] Error:", err);
    return Response.json(
      { error: "Failed to load graph data" },
      { status: 500 }
    );
  }
}

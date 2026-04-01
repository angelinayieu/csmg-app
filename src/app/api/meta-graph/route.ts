import { createClient } from "@/lib/supabase/server";
import type { Space, Bridge } from "@/types";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

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
        // Subquery: get all space IDs for this user
        (await db.from("spaces").select("id").eq("user_id", user.id)).data?.map(
          (s: { id: string }) => s.id
        ) ?? []
      ),
  ]);

  const spaces = (spacesRes.data ?? []) as Space[];
  const bridges = (bridgesRes.data ?? []) as Bridge[];

  return Response.json({ spaces, bridges });
}

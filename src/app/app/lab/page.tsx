// ── Universal Lab page ──
// Route: /app/lab
//
// Phase 16: cross-space knowledge reactor. Treats the user's entire
// knowledge universe as one specimen. Each space becomes a hero subunit
// (a "system" at depth 0). Cross-space bridges become internal bonds
// between those system-subunits. All reactions across all spaces render
// in the footer.
//
// Write target for reactions: the user's most-recently-updated space.
// Saved reactions persist there with provenance marking cross-space origin.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UniversalLab } from "@/components/lab/universal-lab";
import type { Space, Entity, Edge, Bridge } from "@/types";
import type { Reaction } from "@/types/reactions";

export const dynamic = "force-dynamic";

export default async function UniversalLabPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spacesRaw } = await db
    .from("spaces")
    .select("*")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(30);
  const spaces = (spacesRaw ?? []) as Space[];
  if (spaces.length === 0) redirect("/app");

  const spaceIds = spaces.map((s) => s.id);

  // Parallel fetch: all entities + edges + reactions + bridges across every
  // space the user owns.
  const [entitiesRes, edgesRes, reactionsRes, bridgesRes] = await Promise.all([
    db.from("entities").select("*").in("space_id", spaceIds),
    db.from("edges").select("*").in("space_id", spaceIds).limit(3000),
    db
      .from("reactions")
      .select("*")
      .in("space_id", spaceIds)
      .order("created_at", { ascending: false })
      .limit(80),
    db
      .from("bridges")
      .select("*")
      .or(
        `source_space_id.in.(${spaceIds.join(",")}),target_space_id.in.(${spaceIds.join(",")})`,
      ),
  ]);

  const entities = (entitiesRes.data ?? []) as Entity[];
  const edges = (edgesRes.data ?? []) as Edge[];
  const reactions = (reactionsRes.data ?? []) as Reaction[];
  const bridges = (bridgesRes.data ?? []) as Bridge[];

  // Write target for new reactions: most-recently-updated space (first in
  // sorted list). Matches Universal Canvas's pattern.
  const writeTargetSpace = spaces[0];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#06090e] text-[#e8edf4]">
      <UniversalLab
        spaces={spaces}
        entities={entities}
        edges={edges}
        reactions={reactions}
        bridges={bridges}
        writeTargetSpace={writeTargetSpace}
      />
    </div>
  );
}

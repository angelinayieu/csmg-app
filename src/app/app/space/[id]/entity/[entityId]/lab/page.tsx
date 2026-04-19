// ── Node Lab page ──
// Route: /app/space/[id]/entity/[entityId]/lab
//
// Phase 12: per-entity knowledge reactor. Loads the focal entity, its
// direct children (proxy indicators), its up/downstream edges, and every
// saved reaction that touches it. Renders a full-viewport lab view.
//
// Full-viewport: we intentionally bypass SpaceShell's section nav + top
// chrome so the lab feels like its own instrument surface. The left-rail
// "Lab" entry routes here and back.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NodeLab } from "@/components/lab/node-lab";
import type { Entity, Edge } from "@/types";
import type { Reaction } from "@/types/reactions";

export const dynamic = "force-dynamic";

export default async function NodeLabPage({
  params,
}: {
  params: Promise<{ id: string; entityId: string }>;
}) {
  const { id: spaceId, entityId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify ownership + fetch the focal entity
  const { data: focal } = await db
    .from("entities")
    .select("*")
    .eq("id", entityId)
    .eq("space_id", spaceId)
    .single();

  if (!focal) redirect(`/app/space/${spaceId}`);

  // Parallel fetch: all space entities (needed for child resolution +
  // up/downstream name lookup), edges touching the focal, reactions
  // touching the focal.
  const [entitiesRes, edgesRes, reactionsRes, spaceRes] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db
      .from("edges")
      .select("*")
      .eq("space_id", spaceId)
      .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`),
    db
      .from("reactions")
      .select("*")
      .eq("space_id", spaceId)
      .contains("entity_ids", [entityId])
      .order("created_at", { ascending: false })
      .limit(40),
    db.from("spaces").select("id, name").eq("id", spaceId).single(),
  ]);

  const entities = (entitiesRes.data ?? []) as Entity[];
  const edges = (edgesRes.data ?? []) as Edge[];
  const reactions = (reactionsRes.data ?? []) as Reaction[];
  const spaceName: string = spaceRes.data?.name ?? "Space";

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#06090e] text-[#e8edf4]">
      <NodeLab
        spaceId={spaceId}
        spaceName={spaceName}
        focal={focal as Entity}
        entities={entities}
        edges={edges}
        reactions={reactions}
      />
    </div>
  );
}

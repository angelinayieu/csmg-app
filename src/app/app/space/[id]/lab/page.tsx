// ── Space Lab page ──
// Route: /app/space/[id]/lab
//
// Phase 15: whole-space knowledge reactor. Treats the SPACE itself as
// the specimen. Hero entities (leverage points / fundamental / critical)
// become the subunits. Cross-space bridges become the external bonds.
// All reactions in the space render in the footer.
//
// Full-viewport: bypasses SpaceShell so the lab surface is uninterrupted.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SpaceLab } from "@/components/lab/space-lab";
import type { Entity, Edge, Bridge, Space } from "@/types";
import type { Reaction } from "@/types/reactions";

export const dynamic = "force-dynamic";

const HERO_LIMIT = 8;

function isHero(e: Entity): boolean {
  if (e.is_leverage_point || e.is_master_bottleneck) return true;
  const imp = e.importance ?? "moderate";
  return imp === "fundamental" || imp === "critical";
}

export default async function SpaceLabPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: spaceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceData } = await db
    .from("spaces")
    .select("*")
    .eq("id", spaceId)
    .single();
  if (!spaceData) redirect("/app");

  const space = spaceData as Space;

  // Parallel fetch: all entities, all edges, all reactions, cross-space bridges
  const [entitiesRes, edgesRes, reactionsRes, bridgesRes] = await Promise.all([
    db.from("entities").select("*").eq("space_id", spaceId),
    db.from("edges").select("*").eq("space_id", spaceId),
    db
      .from("reactions")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(60),
    db
      .from("bridges")
      .select("*")
      .or(`source_space_id.eq.${spaceId},target_space_id.eq.${spaceId}`),
  ]);

  const entities = (entitiesRes.data ?? []) as Entity[];
  const edges = (edgesRes.data ?? []) as Edge[];
  const reactions = (reactionsRes.data ?? []) as Reaction[];
  const bridges = (bridgesRes.data ?? []) as Bridge[];

  // Phase 25: hydrate cross-space partner entities so the reagent bay
  // shows real names ("Customer Lifetime Value" instead of "(cross-space)").
  // Collect every entity_id on the FAR side of each bridge; one IN query.
  // RLS naturally restricts to spaces the user owns — partners outside
  // that envelope just stay synthesized stubs.
  const partnerIds = new Set<string>();
  for (const b of bridges) {
    if (b.source_space_id === spaceId) {
      partnerIds.add(b.target_entity_id);
    } else {
      partnerIds.add(b.source_entity_id);
    }
  }
  let partnerEntities: Entity[] = [];
  if (partnerIds.size > 0) {
    const { data: partnerRows } = await db
      .from("entities")
      .select("*")
      .in("id", Array.from(partnerIds));
    partnerEntities = (partnerRows ?? []) as Entity[];
  }

  // Pick hero subunits — top-N by importance × connectivity heuristic.
  const heroes = [...entities]
    .filter(isHero)
    .sort((a, b) => {
      const aLev = a.is_leverage_point ? 1 : 0;
      const bLev = b.is_leverage_point ? 1 : 0;
      if (aLev !== bLev) return bLev - aLev;
      const order = ["fundamental", "critical", "important", "moderate"];
      return order.indexOf(a.importance ?? "moderate") -
        order.indexOf(b.importance ?? "moderate");
    })
    .slice(0, HERO_LIMIT);

  // If fewer than 3 heroes, backfill with top-confidence entities so the
  // chamber isn't painfully empty.
  if (heroes.length < 3) {
    const heroIds = new Set(heroes.map((h) => h.id));
    const backfill = [...entities]
      .filter((e) => !heroIds.has(e.id))
      .sort((a, b) => ((b.confidence as number) ?? 0) - ((a.confidence as number) ?? 0))
      .slice(0, Math.min(HERO_LIMIT - heroes.length, 4));
    heroes.push(...backfill);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#06090e] text-[#e8edf4]">
      <SpaceLab
        space={space}
        heroes={heroes}
        entities={entities}
        edges={edges}
        reactions={reactions}
        bridges={bridges}
        partnerEntities={partnerEntities}
      />
    </div>
  );
}

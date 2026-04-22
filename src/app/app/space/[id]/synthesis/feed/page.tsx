// ── Synthesis Feed page (Phase 36) ──
// Route: /app/space/[id]/synthesis/feed
//
// The reverse-chronological "thinking feed" surface — where every
// reaction, decomposition, and bridge the user has accumulated in a
// space renders as a reactor-glass card. Full-viewport (bypasses the
// space shell) so it matches the lab's immersive treatment.
//
// Renders a SynthesisFeed client component; all data fetching happens
// server-side with ownership checks.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SynthesisFeed } from "@/components/synthesis/synthesis-feed";
import type { Bridge, Entity, Space } from "@/types";
import type { Reaction } from "@/types/reactions";

export const dynamic = "force-dynamic";

export default async function SynthesisFeedPage({
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

  // Phase 37: the feed is now a multi-event surface. We fetch:
  //   - reactions (newest-first) — saved reactions
  //   - entities — both the universe of this space (participant lookup)
  //                AND the subset with decomposition_probed_at set
  //                (probe events)
  //   - bridges — cross-space bridges touching this space (created_at
  //               arrived via 20260502 migration; not auto-typed)
  //   - sibling-space names — so bridge cards can name the other side
  const [reactionsRes, entitiesRes, bridgesRes] = await Promise.all([
    db
      .from("reactions")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(200),
    db.from("entities").select("*").eq("space_id", spaceId),
    db
      .from("bridges")
      .select("*")
      .or(`source_space_id.eq.${spaceId},target_space_id.eq.${spaceId}`)
      .order("created_at", { ascending: false })
      .limit(120),
  ]);

  const reactions = (reactionsRes.data ?? []) as Reaction[];
  const entities = (entitiesRes.data ?? []) as Entity[];
  const bridges = (bridgesRes.data ?? []) as Array<
    Bridge & { created_at?: string | null }
  >;

  // Phase 37: resolve the partner-space names for bridges so cards can
  // show "X ↔ Y" instead of UUIDs. One IN-query, RLS still applies.
  const partnerSpaceIds = new Set<string>();
  for (const b of bridges) {
    if (b.source_space_id !== spaceId) partnerSpaceIds.add(b.source_space_id);
    if (b.target_space_id !== spaceId) partnerSpaceIds.add(b.target_space_id);
  }
  const partnerSpaceNames: Record<string, string> = {};
  if (partnerSpaceIds.size > 0) {
    const { data: partnerRows } = await db
      .from("spaces")
      .select("id, name")
      .in("id", Array.from(partnerSpaceIds));
    for (const row of (partnerRows ?? []) as Array<{ id: string; name: string }>) {
      partnerSpaceNames[row.id] = row.name;
    }
  }

  // Fetch the entity rows on the FAR side of each bridge so cards show
  // real names. RLS naturally restricts to spaces the user owns.
  const partnerEntityIds = new Set<string>();
  for (const b of bridges) {
    if (b.source_space_id !== spaceId) partnerEntityIds.add(b.source_entity_id);
    if (b.target_space_id !== spaceId) partnerEntityIds.add(b.target_entity_id);
  }
  let partnerEntities: Entity[] = [];
  if (partnerEntityIds.size > 0) {
    const { data: partnerEntityRows } = await db
      .from("entities")
      .select("*")
      .in("id", Array.from(partnerEntityIds));
    partnerEntities = (partnerEntityRows ?? []) as Entity[];
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[var(--lab-bg)] text-[var(--lab-text)]">
      <SynthesisFeed
        space={space}
        reactions={reactions}
        entities={entities}
        bridges={bridges}
        partnerSpaceNames={partnerSpaceNames}
        partnerEntities={partnerEntities}
      />
    </div>
  );
}

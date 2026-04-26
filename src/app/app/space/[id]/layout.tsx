import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { SpaceShell } from "@/components/layout/space-shell";
import type {
  Space,
  Entity,
  Edge,
  Cycle,
  Proposition,
  NovelConnection,
  Contradiction,
  Scenario,
  ActionItem,
  Bridge,
  Claim,
} from "@/types";
import type { ImprovementGoal } from "@/types/goals";

export default async function SpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Phase 1 fetch — fire EVERY query that only depends on `id` or
  // the auth user in a single Promise.all. Previously this layout
  // ran 4 sequential await waves (space → space-keyed bulk → bridges
  // /goals → siblings → 6 sequential sibling-entities/edges pairs)
  // which was the dominant ~10–50s SSR latency on the whiteboard
  // route. Sibling-space lookup uses the auth user directly so it
  // doesn't need to wait for the space row to come back.
  const user = await getAuthUser();

  const [
    spaceRes,
    entitiesRes,
    edgesRes,
    cyclesRes,
    propositionsRes,
    novelRes,
    contradictionsRes,
    scenariosRes,
    actionsRes,
    claimsRes,
    bridgesRes,
    goalsRes,
    siblingSpacesRes,
  ] = await Promise.all([
    db.from("spaces").select("*").eq("id", id).single(),
    db
      .from("entities")
      .select("*")
      .eq("space_id", id)
      .order("centrality_rank", { ascending: true, nullsFirst: false }),
    db.from("edges").select("*").eq("space_id", id),
    db.from("cycles").select("*").eq("space_id", id),
    db.from("propositions").select("*").eq("space_id", id),
    db.from("novel_connections").select("*").eq("space_id", id),
    db.from("contradictions").select("*").eq("space_a_id", id),
    db
      .from("scenarios")
      .select("*")
      .eq("space_id", id)
      .order("sort_order", { ascending: true }),
    db
      .from("action_items")
      .select("*")
      .eq("space_id", id)
      .order("sort_order", { ascending: true }),
    db.from("claims").select("*").eq("space_id", id),
    db
      .from("bridges")
      .select("*")
      .or(`source_space_id.eq.${id},target_space_id.eq.${id}`),
    db
      .from("improvement_goals")
      .select("*")
      .eq("space_id", id)
      .order("created_at", { ascending: false }),
    user
      ? db
          .from("spaces")
          .select("id, name, space_prefix, entity_count, edge_count")
          .eq("user_id", user.id)
          .neq("id", id)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
  ]);

  if (!spaceRes.data) {
    redirect("/app");
  }
  const space = spaceRes.data as Space;
  const entities = (entitiesRes.data ?? []) as Entity[];
  const edges = (edgesRes.data ?? []) as Edge[];
  const cycles = (cyclesRes.data ?? []) as Cycle[];
  const propositions = (propositionsRes.data ?? []) as Proposition[];
  const novelConnections = (novelRes.data ?? []) as NovelConnection[];
  const contradictions = (contradictionsRes.data ?? []) as Contradiction[];
  const scenarios = (scenariosRes.data ?? []) as Scenario[];
  const actionItems = (actionsRes.data ?? []) as ActionItem[];
  const claims = (claimsRes.data ?? []) as Claim[];
  const bridges = (bridgesRes.data ?? []) as Bridge[];
  const goals = (goalsRes.data ?? []) as ImprovementGoal[];

  // Auto-correct stale sidebar counts (non-blocking)
  if (
    space.entity_count !== entities.length ||
    space.edge_count !== edges.length
  ) {
    space.entity_count = entities.length;
    space.edge_count = edges.length;
    db
      .from("spaces")
      .update({ entity_count: entities.length, edge_count: edges.length })
      .eq("id", id)
      .then(() => {});
  }

  const siblingSpaces = (siblingSpacesRes.data ?? []) as Array<{
    id: string;
    name: string;
    space_prefix: string;
    entity_count: number;
    edge_count: number;
  }>;

  // ── Phase 2 fetch — sibling entities + edges for the unified graph
  // view. Was previously a 6-iteration sequential for-loop (12
  // serial round-trips). Flatten to a single Promise.all so every
  // sibling fans out concurrently. Limited to 6 siblings to bound
  // payload size on graph-heavy accounts.
  const cappedSiblings = siblingSpaces.slice(0, 6);
  const domainMap: Record<string, { name: string; index: number }> = {
    [id]: { name: space.name, index: 0 },
  };
  cappedSiblings.forEach((sib, i) => {
    domainMap[sib.id] = { name: sib.name, index: i + 1 };
  });

  const siblingFetches = cappedSiblings.flatMap((sib) => [
    db.from("entities").select("*").eq("space_id", sib.id),
    db.from("edges").select("*").eq("space_id", sib.id),
  ]);
  const siblingResults = await Promise.all(siblingFetches);
  const siblingEntities: Entity[] = [];
  const siblingEdges: Edge[] = [];
  for (let i = 0; i < cappedSiblings.length; i++) {
    siblingEntities.push(
      ...((siblingResults[i * 2]?.data ?? []) as Entity[]),
    );
    siblingEdges.push(
      ...((siblingResults[i * 2 + 1]?.data ?? []) as Edge[]),
    );
  }

  return (
    <div className="h-full -mx-6 -my-6">
      <SpaceShell
        space={space}
        entities={entities}
        edges={edges}
        cycles={cycles}
        propositions={propositions}
        novelConnections={novelConnections}
        contradictions={contradictions}
        scenarios={scenarios}
        actionItems={actionItems}
        claims={claims}
        siblingEntities={siblingEntities}
        siblingEdges={siblingEdges}
        domainMap={domainMap}
        bridges={bridges}
        goals={goals}
        liveCounts={{
          entities: entities.length,
          edges: edges.length,
          cycles: cycles.length,
        }}
      >
        {children}
      </SpaceShell>
    </div>
  );
}

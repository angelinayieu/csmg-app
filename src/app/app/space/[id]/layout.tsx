import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  // Fetch space
  const { data: spaceData } = await supabase
    .from("spaces")
    .select("*")
    .eq("id", id)
    .single();

  if (!spaceData) {
    redirect("/app");
  }

  const space = spaceData as Space;

  // Fetch all related data in parallel
  const [
    entitiesRes,
    edgesRes,
    cyclesRes,
    propositionsRes,
    novelRes,
    contradictionsRes,
    scenariosRes,
    actionsRes,
    claimsRes,
  ] = await Promise.all([
    supabase
      .from("entities")
      .select("*")
      .eq("space_id", id)
      .order("centrality_rank", { ascending: true, nullsFirst: false }),
    supabase.from("edges").select("*").eq("space_id", id),
    supabase.from("cycles").select("*").eq("space_id", id),
    supabase.from("propositions").select("*").eq("space_id", id),
    supabase.from("novel_connections").select("*").eq("space_id", id),
    supabase.from("contradictions").select("*").eq("space_a_id", id),
    supabase
      .from("scenarios")
      .select("*")
      .eq("space_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("action_items")
      .select("*")
      .eq("space_id", id)
      .order("sort_order", { ascending: true }),
    supabase.from("claims").select("*").eq("space_id", id),
  ]);

  const entities = (entitiesRes.data ?? []) as Entity[];
  const edges = (edgesRes.data ?? []) as Edge[];
  const cycles = (cyclesRes.data ?? []) as Cycle[];
  const propositions = (propositionsRes.data ?? []) as Proposition[];
  const novelConnections = (novelRes.data ?? []) as NovelConnection[];
  const contradictions = (contradictionsRes.data ?? []) as Contradiction[];
  const scenarios = (scenariosRes.data ?? []) as Scenario[];
  const actionItems = (actionsRes.data ?? []) as ActionItem[];
  const claims = (claimsRes.data ?? []) as Claim[];

  // Auto-correct stale sidebar counts (non-blocking)
  if (
    space.entity_count !== entities.length ||
    space.edge_count !== edges.length
  ) {
    space.entity_count = entities.length;
    space.edge_count = edges.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("spaces")
      .update({ entity_count: entities.length, edge_count: edges.length })
      .eq("id", id)
      .then(() => {});
  }

  // Fetch cross-space bridges + improvement goals in parallel
  const [bridgesRes, goalsRes] = await Promise.all([
    supabase
      .from("bridges")
      .select("*")
      .or(`source_space_id.eq.${id},target_space_id.eq.${id}`),
    supabase
      .from("improvement_goals")
      .select("*")
      .eq("space_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const bridges = (bridgesRes.data ?? []) as Bridge[];
  const goals = (goalsRes.data ?? []) as ImprovementGoal[];

  // Fetch sibling spaces (same user, for unified graph view)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: siblingSpacesData } = await db
    .from("spaces")
    .select("id, name, space_prefix, entity_count, edge_count")
    .eq("user_id", space.user_id)
    .neq("id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  const siblingSpaces = (siblingSpacesData ?? []) as Array<{
    id: string;
    name: string;
    space_prefix: string;
    entity_count: number;
    edge_count: number;
  }>;

  // Load sibling entities + edges for unified graph
  const siblingEntities: Entity[] = [];
  const siblingEdges: Edge[] = [];
  const domainMap: Record<string, { name: string; index: number }> = {
    [id]: { name: space.name, index: 0 },
  };

  for (let i = 0; i < Math.min(siblingSpaces.length, 6); i++) {
    const sib = siblingSpaces[i];
    domainMap[sib.id] = { name: sib.name, index: i + 1 };

    const [sibEntRes, sibEdgRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", sib.id),
      db.from("edges").select("*").eq("space_id", sib.id),
    ]);

    siblingEntities.push(...((sibEntRes.data ?? []) as Entity[]));
    siblingEdges.push(...((sibEdgRes.data ?? []) as Edge[]));
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

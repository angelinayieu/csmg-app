import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SpaceHeader } from "@/components/space/space-header";
import { SpaceDetailTabs } from "./tabs";
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
} from "@/types";

export default async function SpacePage({
  params,
}: {
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
  ]);

  const entities = (entitiesRes.data ?? []) as Entity[];
  const edges = (edgesRes.data ?? []) as Edge[];
  const cycles = (cyclesRes.data ?? []) as Cycle[];
  const propositions = (propositionsRes.data ?? []) as Proposition[];
  const novelConnections = (novelRes.data ?? []) as NovelConnection[];
  const contradictions = (contradictionsRes.data ?? []) as Contradiction[];
  const scenarios = (scenariosRes.data ?? []) as Scenario[];
  const actionItems = (actionsRes.data ?? []) as ActionItem[];

  return (
    <div className="h-full">
      <SpaceHeader space={space} />
      <div className="mt-4 h-[calc(100%-80px)]">
        <SpaceDetailTabs
          space={space}
          entities={entities}
          edges={edges}
          cycles={cycles}
          propositions={propositions}
          novelConnections={novelConnections}
          contradictions={contradictions}
          scenarios={scenarios}
          actionItems={actionItems}
        />
      </div>
    </div>
  );
}

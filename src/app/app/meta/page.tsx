import { createClient } from "@/lib/supabase/server";
import { StrategicMetaGraph } from "@/components/meta/strategic-meta-graph";
import type { Space, Bridge, Contradiction, Entity } from "@/types";

interface SpaceSummary {
  space: Space;
  topEntities: Entity[]; // top 5 by centrality
  leveragePoints: Entity[];
  riskPoints: Entity[];
  bottleneck: Entity | null;
  edgeDensity: number;
}

interface AutoBridge {
  sourceSpaceId: string;
  targetSpaceId: string;
  sourceEntityName: string;
  targetEntityName: string;
  sourceEntityId: string;
  targetEntityId: string;
  matchType: "exact" | "similar" | "parent_child";
}

export default async function MetaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spacesData } = await db
    .from("spaces")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const spaces = (spacesData ?? []) as Space[];
  const spaceIds = spaces.map((s) => s.id);

  if (spaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">No spaces yet. Run an analysis first.</p>
      </div>
    );
  }

  // Fetch entities for all spaces
  const { data: allEntitiesData } = await db
    .from("entities")
    .select("*")
    .in("space_id", spaceIds)
    .order("centrality_rank", { ascending: true, nullsFirst: false });

  const allEntities = (allEntitiesData ?? []) as Entity[];

  // Fetch bridges and contradictions
  let bridges: Bridge[] = [];
  let contradictions: Contradiction[] = [];
  if (spaceIds.length > 1) {
    const [bridgesRes, contradictionsRes] = await Promise.all([
      db.from("bridges").select("*").in("source_space_id", spaceIds),
      db.from("contradictions").select("*").in("space_a_id", spaceIds),
    ]);
    bridges = (bridgesRes.data ?? []) as Bridge[];
    contradictions = (contradictionsRes.data ?? []) as Contradiction[];
  }

  // Build per-space summaries
  const spaceSummaries: SpaceSummary[] = spaces.map((space) => {
    const spaceEntities = allEntities.filter((e) => e.space_id === space.id);
    return {
      space,
      topEntities: spaceEntities.slice(0, 5),
      leveragePoints: spaceEntities.filter((e) => e.is_leverage_point).slice(0, 3),
      riskPoints: spaceEntities.filter((e) => e.is_risk_point).slice(0, 3),
      bottleneck: spaceEntities.find((e) => e.is_master_bottleneck) ?? null,
      edgeDensity: space.entity_count > 0 ? space.edge_count / space.entity_count : 0,
    };
  });

  // Auto-detect shared entities across spaces (name similarity)
  const autoBridges: AutoBridge[] = [];
  const entitiesBySpace = new Map<string, Entity[]>();
  for (const e of allEntities) {
    const list = entitiesBySpace.get(e.space_id) ?? [];
    list.push(e);
    entitiesBySpace.set(e.space_id, list);
  }

  // Words that are too generic to form meaningful bridges
  const genericWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "into", "app",
    "digital", "ecosystem", "system", "platform", "development", "strategy",
    "plan", "planning", "management", "process", "analysis", "approach",
    "framework", "model", "structure", "architecture", "design", "building",
    "growth", "launch", "startup", "project", "tool", "tools", "service",
    "solution", "custom", "made", "based", "driven", "focused", "related",
    "general", "overall", "main", "core", "primary", "key", "important",
    "high", "level", "quality", "improvement", "effective", "strategic",
  ]);

  // Only match on specific, meaningful entity names
  for (let i = 0; i < spaceIds.length; i++) {
    for (let j = i + 1; j < spaceIds.length; j++) {
      const entitiesA = entitiesBySpace.get(spaceIds[i]) ?? [];
      const entitiesB = entitiesBySpace.get(spaceIds[j]) ?? [];

      for (const a of entitiesA) {
        for (const b of entitiesB) {
          const nameA = a.name.toLowerCase().trim();
          const nameB = b.name.toLowerCase().trim();

          // Skip very short or very generic names
          if (nameA.length < 6 || nameB.length < 6) continue;

          // Exact match (same concept name in both spaces)
          if (nameA === nameB) {
            autoBridges.push({
              sourceSpaceId: spaceIds[i],
              targetSpaceId: spaceIds[j],
              sourceEntityName: a.name,
              targetEntityName: b.name,
              sourceEntityId: a.entity_id,
              targetEntityId: b.entity_id,
              matchType: "exact",
            });
            continue;
          }

          // Meaningful word overlap (ignoring generic words)
          const wordsA = nameA.split(/\s+/).filter((w) => w.length > 3 && !genericWords.has(w));
          const wordsB = nameB.split(/\s+/).filter((w) => w.length > 3 && !genericWords.has(w));

          // Need at least 1 meaningful word in each AND a shared meaningful word
          if (wordsA.length === 0 || wordsB.length === 0) continue;

          const shared = wordsA.filter((w) => wordsB.includes(w));
          // Require shared words to be a significant portion of the shorter name
          if (shared.length >= 1 && shared.length >= Math.min(wordsA.length, wordsB.length) * 0.5) {
            autoBridges.push({
              sourceSpaceId: spaceIds[i],
              targetSpaceId: spaceIds[j],
              sourceEntityName: a.name,
              targetEntityName: b.name,
              sourceEntityId: a.entity_id,
              targetEntityId: b.entity_id,
              matchType: "similar",
            });
          }
        }
      }
    }
  }

  // Deduplicate auto-bridges per space pair (keep top 3 per pair)
  const pairBridges = new Map<string, AutoBridge[]>();
  for (const ab of autoBridges) {
    const key = [ab.sourceSpaceId, ab.targetSpaceId].sort().join("-");
    const list = pairBridges.get(key) ?? [];
    list.push(ab);
    pairBridges.set(key, list);
  }
  const deduped: AutoBridge[] = [];
  for (const [, list] of pairBridges) {
    // Prioritize: exact > similar > parent_child, take top 3
    const sorted = list.sort((a, b) => {
      const order = { exact: 0, similar: 1, parent_child: 2 };
      return (order[a.matchType] ?? 1) - (order[b.matchType] ?? 1);
    });
    deduped.push(...sorted.slice(0, 3));
  }

  return (
    <StrategicMetaGraph
      spaceSummaries={spaceSummaries}
      autoBridges={deduped}
      manualBridges={bridges}
      contradictions={contradictions}
    />
  );
}

import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { InteractionMetadata } from "@/types/interactions";
import type {
  Subsystem,
  SubsystemKind,
  SubsystemLevel,
  SubsystemSeed,
} from "@/types/subsystems";
import { llmJSON } from "@/lib/llm";

const MAX_SUBSYSTEMS = 12;
const MIN_ENTITIES_PER_SUBSYSTEM = 2;
const MERGE_OVERLAP_THRESHOLD = 0.5;

export interface SubsystemSkeleton {
  kind: SubsystemKind;
  seed: SubsystemSeed;
  constituent_entities: string[];
  constituent_edges: string[];
  constituent_cycles: string[];
  constituent_axioms: string[];
  level: SubsystemLevel;
  structural_value: number;
}

// interaction_metadata is JSONB-only — not present on the SynthesisData TS type
function getInteractionMetadata(synth: SynthesisData): InteractionMetadata | null {
  const im = (synth as unknown as Record<string, unknown>).interaction_metadata;
  return im && typeof im === "object" ? (im as InteractionMetadata) : null;
}

export function oneHopNeighborhood(
  centerEntityId: string,
  edges: Edge[],
): { entities: string[]; edges: string[] } {
  const entityIds = new Set<string>([centerEntityId]);
  const edgeIds: string[] = [];
  for (const e of edges) {
    if (e.source_entity_id === centerEntityId) {
      entityIds.add(e.target_entity_id);
      edgeIds.push(e.id);
    } else if (e.target_entity_id === centerEntityId) {
      entityIds.add(e.source_entity_id);
      edgeIds.push(e.id);
    }
  }
  return { entities: [...entityIds], edges: edgeIds };
}

export function aggregateConfidence(
  skel: SubsystemSkeleton,
  entities: Entity[],
): number {
  if (skel.constituent_entities.length === 0) return skel.structural_value;
  const entityMap = new Map(entities.map((e) => [e.entity_id, e.confidence]));
  const confidences = skel.constituent_entities
    .map((id) => entityMap.get(id))
    .filter((c): c is number => typeof c === "number");
  if (confidences.length === 0) return skel.structural_value;
  const avg = confidences.reduce((s, c) => s + c, 0) / confidences.length;
  return 0.6 * avg + 0.4 * skel.structural_value;
}

export function buildSkeletons({
  synthesis,
  entities,
  edges,
  cycles,
}: {
  synthesis: SynthesisData;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
}): SubsystemSkeleton[] {
  const skeletons: SubsystemSkeleton[] = [];
  const im = getInteractionMetadata(synthesis);

  for (const cycle of cycles) {
    if ((cycle.entity_ids?.length ?? 0) < MIN_ENTITIES_PER_SUBSYSTEM) continue;
    skeletons.push({
      kind: "loop",
      seed: { kind: "cycle", source_id: cycle.cycle_id },
      constituent_entities: cycle.entity_ids,
      constituent_edges: cycle.edge_ids ?? [],
      constituent_cycles: [cycle.cycle_id],
      constituent_axioms: [],
      level: "L3",
      structural_value: 0.8,
    });
  }

  for (const lp of synthesis.leverage_points ?? []) {
    const hood = oneHopNeighborhood(lp.entity_id, edges);
    if (hood.entities.length < MIN_ENTITIES_PER_SUBSYSTEM) continue;
    skeletons.push({
      kind: "leverage_cluster",
      seed: { kind: "leverage_point", source_id: lp.entity_id },
      constituent_entities: hood.entities,
      constituent_edges: hood.edges,
      constituent_cycles: [],
      constituent_axioms: [],
      level: "L2",
      structural_value: 0.7,
    });
  }

  for (const tz of im?.tension_zones ?? []) {
    const drivers = [
      ...(tz.positive_drivers ?? []),
      ...(tz.negative_drivers ?? []),
    ];
    if (drivers.length < MIN_ENTITIES_PER_SUBSYSTEM) continue;
    skeletons.push({
      kind: "tension",
      seed: { kind: "tension_zone", source_id: tz.entity_id },
      constituent_entities: [tz.entity_id, ...drivers],
      constituent_edges: [],
      constituent_cycles: [],
      constituent_axioms: [],
      level: "L3",
      structural_value: Math.min(Math.max(tz.tension_magnitude ?? 0.6, 0), 1),
    });
  }

  for (const conv of im?.convergences ?? []) {
    if (conv.depth !== "L4") continue;
    const focal = conv.shared_element?.entity_id;
    if (!focal) continue;
    const supportingAxioms = (synthesis.axioms ?? [])
      .filter((a) => a.rests_on?.includes(focal))
      .map((a) => a.axiom_id);
    skeletons.push({
      kind: "invariant_chain",
      seed: { kind: "convergence", source_id: conv.id },
      constituent_entities: [focal],
      constituent_edges: [],
      constituent_cycles: [],
      constituent_axioms: supportingAxioms,
      level: "L4",
      structural_value: conv.structural_value ?? 1.0,
    });
  }

  for (const ic of synthesis.insight_convergences ?? []) {
    if ((ic.shared_entity_ids?.length ?? 0) < 3) continue;
    skeletons.push({
      kind: "convergence_cluster",
      seed: { kind: "insight_convergence", source_id: ic.cluster_id },
      constituent_entities: ic.shared_entity_ids,
      constituent_edges: [],
      constituent_cycles: [],
      constituent_axioms: [],
      level: ic.strength === "strong" ? "L2" : "L3",
      structural_value:
        ic.strength === "strong" ? 0.8 : ic.strength === "moderate" ? 0.6 : 0.4,
    });
  }

  if (synthesis.master_bottleneck?.entity_id) {
    const blocking = oneHopNeighborhood(
      synthesis.master_bottleneck.entity_id,
      edges,
    );
    if (blocking.entities.length >= MIN_ENTITIES_PER_SUBSYSTEM) {
      skeletons.push({
        kind: "bottleneck_node",
        seed: {
          kind: "master_bottleneck",
          source_id: synthesis.master_bottleneck.entity_id,
        },
        constituent_entities: blocking.entities,
        constituent_edges: blocking.edges,
        constituent_cycles: [],
        constituent_axioms: [],
        level: "L1",
        structural_value: 0.9,
      });
    }
  }

  return skeletons;
}

export function mergeOverlapping(
  skeletons: SubsystemSkeleton[],
  threshold = MERGE_OVERLAP_THRESHOLD,
): SubsystemSkeleton[] {
  const merged: SubsystemSkeleton[] = [];
  const used = new Set<number>();

  for (let i = 0; i < skeletons.length; i++) {
    if (used.has(i)) continue;
    let cur = skeletons[i];
    used.add(i);
    for (let j = i + 1; j < skeletons.length; j++) {
      if (used.has(j)) continue;
      const a = new Set(cur.constituent_entities);
      const b = new Set(skeletons[j].constituent_entities);
      const intersection = [...a].filter((x) => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      if (union === 0) continue;
      if (intersection / union > threshold) {
        const winner =
          cur.structural_value >= skeletons[j].structural_value
            ? cur
            : skeletons[j];
        cur = {
          ...winner,
          constituent_entities: [
            ...new Set([
              ...cur.constituent_entities,
              ...skeletons[j].constituent_entities,
            ]),
          ],
          constituent_edges: [
            ...new Set([
              ...cur.constituent_edges,
              ...skeletons[j].constituent_edges,
            ]),
          ],
          constituent_cycles: [
            ...new Set([
              ...cur.constituent_cycles,
              ...skeletons[j].constituent_cycles,
            ]),
          ],
          constituent_axioms: [
            ...new Set([
              ...cur.constituent_axioms,
              ...skeletons[j].constituent_axioms,
            ]),
          ],
        };
        used.add(j);
      }
    }
    merged.push(cur);
  }
  return merged;
}

export function rankAndCap(
  skeletons: SubsystemSkeleton[],
  cap = MAX_SUBSYSTEMS,
): SubsystemSkeleton[] {
  return [...skeletons]
    .sort((a, b) => b.structural_value - a.structural_value)
    .slice(0, cap);
}

interface EnrichmentItem {
  skeleton_index: number;
  name: string;
  contracts: { does: string; needs: string; produces: string };
  rationale: string;
}

export async function enrichWithLLM(
  skeletons: SubsystemSkeleton[],
  entities: Entity[],
): Promise<Subsystem[]> {
  if (skeletons.length === 0) return [];

  const entityNameMap = new Map(entities.map((e) => [e.entity_id, e.name]));

  const skeletonBlock = skeletons
    .map((s, i) => {
      const names = s.constituent_entities
        .map((id) => entityNameMap.get(id) ?? id)
        .slice(0, 8)
        .join(", ");
      return `Skeleton ${i + 1} [${s.kind}, ${s.level}]:\n  entities: ${names}\n  seed: ${s.seed.kind}/${s.seed.source_id}`;
    })
    .join("\n\n");

  let enrichments: EnrichmentItem[] = [];
  try {
    const result = await llmJSON<{ subsystems: EnrichmentItem[] }>({
      system:
        "You are a systems analyst. You will be given structural skeletons of subsystems extracted from a knowledge graph. Your job is ONLY to name each subsystem and describe its contracts (what it does, what it needs, what it produces). You CANNOT add or remove constituents — those are fixed.\n\nRespond with valid JSON: { subsystems: [{ skeleton_index, name, contracts: { does, needs, produces }, rationale }] }.\n\nNames should be 2–5 words, e.g. 'Onboarding feedback loop', 'Retention bottleneck cluster'. Rationale is 1–2 sentences explaining why these constituents form a coherent unit.",
      user: `Skeletons:\n\n${skeletonBlock}`,
      maxTokens: 4096,
      temperature: 0.2,
    });
    enrichments = Array.isArray(result.subsystems) ? result.subsystems : [];
  } catch (err) {
    console.warn("[subsystems] LLM enrichment failed, using stub names:", err);
  }

  return skeletons.map((skel, i) => {
    const enriched = enrichments.find((e) => e.skeleton_index === i);
    return {
      id: `sub_${skel.kind}_${i + 1}`,
      kind: skel.kind,
      name: enriched?.name ?? `${skel.kind.replace("_", " ")} ${i + 1}`,
      level: skel.level,
      constituent_entities: skel.constituent_entities,
      constituent_edges: skel.constituent_edges,
      constituent_cycles: skel.constituent_cycles,
      constituent_axioms: skel.constituent_axioms,
      evidence_links: [],
      seed: skel.seed,
      composition_confidence: aggregateConfidence(skel, entities),
      structural_value: skel.structural_value,
      contracts: enriched?.contracts ?? { does: "", needs: "", produces: "" },
      rationale: enriched?.rationale ?? "",
      generated_at: new Date().toISOString(),
    };
  });
}

export async function extractSubsystems(params: {
  synthesis: SynthesisData;
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
}): Promise<Subsystem[]> {
  const skeletons = buildSkeletons(params);
  const merged = mergeOverlapping(skeletons);
  const ranked = rankAndCap(merged);
  if (ranked.length === 0) return [];
  return enrichWithLLM(ranked, params.entities);
}

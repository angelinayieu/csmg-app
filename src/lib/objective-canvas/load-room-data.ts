// ── loadRoomData ──
//
// Server-side loader for a sub-objective room's full payload — the exact
// shape SubObjectiveRoomView needs (lanes, edges, annotations, cross-room
// coverage, constraints, …). Lets the room render CLIENT-SIDE inside the
// objective canvas's room-window (direct mount, no iframe) via a GET
// route, instead of only as a full-page server route.
//
// NOTE: this is a faithful copy of the data-loading in
// src/app/app/objective/[spaceId]/sub/[subId]/page.tsx. It's intentionally
// duplicated for now to avoid editing that route while it's being
// co-edited in a parallel session — the page should be refactored to call
// this loader (dedupe) once that settles.

import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import { readConstraints, type OperationalConstraints } from "@/lib/objective-canvas/constraints";
import { splitAnnotationsByTitle } from "@/lib/objective-canvas/split-annotations";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { PipelineMode } from "@/components/objective/mode-pill";
import type {
  LayerItem,
  RoomEdge,
  RoomLane,
} from "@/components/objective/sub-objective-room-view";
import type { ObjectiveAnnotation } from "@/components/objective/annotated-objective-card";

const LAYER_ORDER: Array<"pain" | "features" | "outcomes" | "objective"> = [
  "pain",
  "features",
  "outcomes",
  "objective",
];

const CANONICAL_LANE_LABELS: Record<(typeof LAYER_ORDER)[number], string> = {
  pain: "Problems",
  features: "Mechanisms",
  outcomes: "Results",
  objective: "Objective",
};

export interface RoomData {
  subObjectiveId: string;
  title: string;
  description: string | null;
  topNegativeOutcome: string | null;
  titleAnnotations: ObjectiveAnnotation[];
  descriptionAnnotations: ObjectiveAnnotation[];
  lanes: RoomLane[];
  edges: RoomEdge[];
  generatedAt: string | null;
  pipelineMode: PipelineMode;
  roomCategoriesRaw: unknown;
  annotations: ObjectiveAnnotation[];
  crossRoomCoverageByIndex: Record<number, number>;
  constraints: OperationalConstraints | null;
}

interface SubRow {
  id: string;
  title: string;
  description: string | null;
  space_id: string;
  user_id: string;
  parent_goal_id: string | null;
  room_layers_generated_at: string | null;
  top_negative_outcome: string | null;
  room_lane_labels: unknown;
  room_categories: unknown;
  annotations: unknown;
}

export async function loadRoomData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  { spaceId, subId, userId }: { spaceId: string; subId: string; userId: string },
): Promise<RoomData | null> {
  const { data: sub } = (await db
    .from("improvement_goals")
    .select(
      "id, title, description, space_id, user_id, parent_goal_id, room_layers_generated_at, top_negative_outcome, room_lane_labels, room_categories, annotations",
    )
    .eq("id", subId)
    .maybeSingle()) as { data: SubRow | null };

  if (!sub || sub.user_id !== userId || sub.space_id !== spaceId) return null;

  const { data: spaceModeRow } = await db
    .from("spaces")
    .select("pipeline_mode, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  const pipelineMode: PipelineMode =
    spaceModeRow?.pipeline_mode === "review_each" ? "review_each" : "autopilot";
  const constraints = readConstraints(spaceModeRow?.synthesis_data);

  // Parent annotations (Annotation Lens) — fall through to root goal.
  let parentAnnotationsRaw: unknown = null;
  if (sub.parent_goal_id) {
    const { data: parent } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("id", sub.parent_goal_id)
      .maybeSingle();
    parentAnnotationsRaw = parent?.annotations ?? null;
  } else {
    const { data: rootGoal } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .maybeSingle();
    parentAnnotationsRaw = rootGoal?.annotations ?? null;
  }
  const parentAnnotations = normalizeAnnotations(parentAnnotationsRaw);
  const subAnnotations = normalizeAnnotations(sub.annotations);
  const { titleAnnotations, descriptionAnnotations } = splitAnnotationsByTitle(
    sub.title,
    sub.description,
    subAnnotations,
  );

  // Cross-room annotation coverage.
  const crossRoomCoverageByIndex: Record<number, number> = {};
  if (parentAnnotations.length > 0 && sub.parent_goal_id) {
    const { data: siblingRoomRows } = await db
      .from("improvement_goals")
      .select("id")
      .eq("parent_goal_id", sub.parent_goal_id)
      .neq("id", subId);
    const siblingIds = ((siblingRoomRows ?? []) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    if (siblingIds.length > 0) {
      const { data: siblingEntityRows } = await db
        .from("entities")
        .select("parent_sub_objective_id, causal_chain")
        .in("parent_sub_objective_id", siblingIds);
      const countByPhrase = new Map<string, number>();
      for (const row of (siblingEntityRows ?? []) as Array<{
        parent_sub_objective_id: string;
        causal_chain: Record<string, unknown> | null;
      }>) {
        const dfa = row.causal_chain?.derived_from_annotations;
        if (!Array.isArray(dfa)) continue;
        const itemPhrases = new Set<string>();
        for (const entry of dfa as Array<{ phrase?: unknown }>) {
          if (typeof entry?.phrase === "string" && entry.phrase.trim().length > 0) {
            itemPhrases.add(entry.phrase.trim().toLowerCase());
          }
        }
        for (const p of itemPhrases) {
          countByPhrase.set(p, (countByPhrase.get(p) ?? 0) + 1);
        }
      }
      const rankedForIndexing = [...parentAnnotations]
        .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
        .slice(0, 8);
      rankedForIndexing.forEach((a, i) => {
        const c = countByPhrase.get(a.phrase.trim().toLowerCase()) ?? 0;
        if (c > 0) crossRoomCoverageByIndex[i + 1] = c;
      });
    }
  }

  // Layers.
  const { data: layerRows } = await db
    .from("layer_ontology")
    .select("id, slug, label, color")
    .eq("space_id", spaceId);
  const layerById = new Map<
    string,
    { slug: string; label: string; color: string | null }
  >();
  const layerBySlug = new Map<string, { id: string; color: string | null }>();
  for (const r of (layerRows ?? []) as Array<{
    id: string;
    slug: string;
    label: string;
    color: string | null;
  }>) {
    layerById.set(r.id, { slug: r.slug, label: r.label, color: r.color });
    layerBySlug.set(r.slug, { id: r.id, color: r.color });
  }

  // Entities → lanes.
  // expanded_detail is selected so FEATURE items can hydrate the
  // CategoryCard mechanism lineup without a /expand round-trip. It's a
  // bulky blob, so we only ATTACH it to feature-lane items below.
  const { data: entityRows } = await db
    .from("entities")
    .select(
      "id, name, description, entity_type, layer_ontology_id, causal_chain, expanded_detail",
    )
    .eq("parent_sub_objective_id", subId);

  const lanes: RoomLane[] = LAYER_ORDER.map((slug) => {
    const meta = layerBySlug.get(slug);
    return {
      slug,
      label: CANONICAL_LANE_LABELS[slug],
      color:
        meta?.color ??
        (slug === "pain"
          ? appleVibe.stage.pain
          : slug === "features"
            ? appleVibe.stage.features
            : slug === "outcomes"
              ? appleVibe.stage.outcomes
              : appleVibe.stage.objective),
      items: [] as LayerItem[],
    };
  });
  const laneIndex = new Map<string, RoomLane>(lanes.map((l) => [l.slug, l]));
  for (const e of (entityRows ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    entity_type: string;
    layer_ontology_id: string | null;
    causal_chain: Record<string, unknown> | null;
    expanded_detail: Record<string, unknown> | null;
  }>) {
    const layer = e.layer_ontology_id ? layerById.get(e.layer_ontology_id) : undefined;
    if (!layer) continue;
    const lane = laneIndex.get(layer.slug);
    if (!lane) continue;
    lane.items.push({
      id: e.id,
      name: e.name,
      description: e.description,
      entity_type: e.entity_type,
      causal_chain: e.causal_chain,
      // Only features carry the lineup; keep pain/outcome payloads lean.
      expanded_detail: layer.slug === "features" ? e.expanded_detail : null,
    });
  }

  // Edges.
  const { data: edgeRows } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, relationship_type, strength, polarity, conditions, approved_at, agent_feedback",
    )
    .eq("parent_sub_objective_id", subId);
  const edges: RoomEdge[] = ((edgeRows ?? []) as RoomEdge[]) ?? [];

  return {
    subObjectiveId: subId,
    title: sub.title,
    description: sub.description,
    topNegativeOutcome: sub.top_negative_outcome,
    titleAnnotations,
    descriptionAnnotations,
    lanes,
    edges,
    generatedAt: sub.room_layers_generated_at,
    pipelineMode,
    roomCategoriesRaw: sub.room_categories,
    annotations: parentAnnotations,
    crossRoomCoverageByIndex,
    constraints,
  };
}

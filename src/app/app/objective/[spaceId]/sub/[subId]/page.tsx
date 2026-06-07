// ── /app/objective/[spaceId]/sub/[subId] — Sub-objective room ──
//
// Loads the sub-objective + its 4 layers + already-generated
// entities + cross-layer edges, then mounts the room view. Empty
// state shows a "Generate the room" CTA; populated state shows the
// 4 lanes with items and the ranked correlation list.

import { redirect, notFound } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  SubObjectiveRoomView,
  type LayerItem,
  type RoomEdge,
  type RoomLane,
} from "@/components/objective/sub-objective-room-view";
import { ModePill, type PipelineMode } from "@/components/objective/mode-pill";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import { readPriorityVector } from "@/lib/objective-canvas/priority-vector";
import {
  computeLayerPositionLabel,
  type ObjectiveStack,
  type LayerArchetype,
} from "@/lib/objective-canvas/layer-model";
import { SubObjectiveRoomHeader } from "@/components/objective/sub-objective-room-header";
import { splitAnnotationsByTitle } from "@/lib/objective-canvas/split-annotations";

export const dynamic = "force-dynamic";

const LAYER_ORDER: Array<"pain" | "features" | "outcomes" | "objective"> = [
  "pain",
  "features",
  "outcomes",
  "objective",
];

// Canonical lane labels — the SINGLE SOURCE OF TRUTH across every
// surface (lane headers, side panel filter chips, chain card layer
// labels, portfolio strip, main canvas sub-card chips). LLM-picked
// lane_labels are intentionally IGNORED — the labels were
// stochastic per generation, which broke vocabulary coherence
// across reloads. The user explicitly asked for "Problems" (not
// "Frictions" / "Pain points") and "Results" (not "Wins" /
// "Outcomes"); we honor that everywhere.
const CANONICAL_LANE_LABELS: Record<(typeof LAYER_ORDER)[number], string> = {
  pain: "Problems",
  features: "Mechanisms",
  outcomes: "Results",
  objective: "Objective",
};

interface Sub {
  id: string;
  title: string;
  description: string | null;
  space_id: string;
  user_id: string;
  parent_goal_id: string | null;
  room_layers_generated_at: string | null;
  top_negative_outcome: string | null;
  /** Phase 11.A — which ObjectiveStack layer(s) this room sits at,
   *  tagged by the proposer. Resolves against the space's stack to
   *  show "operates at L3 · Goal Conversion" in the room header so the
   *  room's altitude in the OUTER canvas stack is visible from inside. */
  layer_ordinals: number[] | null;
  layer_position_label: string | null;
  /** LLM-picked domain-specific lane labels — overrides the
   *  canonical names when present. Shape:
   *  { pain, features, outcomes, objective }. */
  room_lane_labels: Record<string, string> | null;
  /** Tier 3 — adaptive sub-category sets per lane. Empty `{}`
   *  when not yet generated; lane card chips + portfolio strip
   *  hide gracefully in that case. */
  room_categories: unknown;
  /** K1 — sub-objective's own annotations. Parallel to parent
   *  objective lens. Auto-generated on first room/generate; user
   *  can re-trigger via POST /api/brainstorm/sub-objectives/[id]
   *  /annotate?mode=force. Null until generated. */
  annotations: unknown;
  /** Per-sub-objective priority vector — soft trade-off weights
   *  (speed/durability/reversibility/certainty/leverage). Distinct
   *  from space-scoped operational constraints. Column added in
   *  20260904_priority_vector.sql; null = lazy-infer on first room
   *  open via the PriorityStrip's GET /priorities. */
  priority_vector: unknown;
}

export default async function SubObjectiveRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceId: string; subId: string }>;
  searchParams?: Promise<{ full?: string }>;
}) {
  const { spaceId, subId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  // Legacy room view (SubObjectiveRoomHeader breadcrumb + lanes / entities /
  // edges) is retired with the old build — see project_old_build_deprecation.
  // Default route resolves to the new minimal board; ?full=1 keeps the
  // legacy escape hatch alive for anyone still pinning a direct URL.
  const sp = await searchParams;
  if (sp?.full !== "1") redirect(`/app/objective/${spaceId}`);

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Wave 1: launch every query whose only dependency is (spaceId,
  //    subId) IN PARALLEL. Was 5 serial round-trips; now one. ──
  const [
    subResult,
    spaceModeResult,
    layerRowsResult,
    entityRowsResult,
    edgeRowsResult,
  ] = await Promise.all([
    db
      .from("improvement_goals")
      .select(
        "id, title, description, space_id, user_id, parent_goal_id, room_layers_generated_at, top_negative_outcome, room_lane_labels, room_categories, annotations, layer_ordinals, layer_position_label, priority_vector",
      )
      .eq("id", subId)
      .maybeSingle(),
    db
      .from("spaces")
      .select("pipeline_mode, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle(),
    db
      .from("layer_ontology")
      .select("id, slug, label, color")
      .eq("space_id", spaceId),
    // expanded_detail is selected so FEATURE items can hydrate the
    // CategoryCard mechanism lineup without a /expand round-trip. It's
    // a bulky blob, so we only ATTACH it to feature-lane items below.
    db
      .from("entities")
      .select(
        "id, name, description, entity_type, layer_ontology_id, causal_chain, expanded_detail",
      )
      .eq("parent_sub_objective_id", subId),
    // agent_feedback carries the LLM-named mechanism (the specific
    // lever) for the side panel to surface as deeper insight.
    db
      .from("edges")
      .select(
        "id, source_entity_id, target_entity_id, relationship_type, strength, polarity, conditions, approved_at, agent_feedback",
      )
      .eq("parent_sub_objective_id", subId),
  ]);

  const sub = subResult.data as Sub | null;
  if (!sub || sub.user_id !== user.id || sub.space_id !== spaceId) {
    notFound();
  }

  const spaceModeRow = spaceModeResult.data;
  const pipelineMode: PipelineMode =
    spaceModeRow?.pipeline_mode === "review_each"
      ? "review_each"
      : "autopilot";
  const operationalConstraints = readConstraints(spaceModeRow?.synthesis_data);
  // Per-sub-objective priority vector — null = column unset, the
  // PriorityStrip lazy-fires GET /priorities on mount which infers
  // + persists. Same lazy pattern as constraints' auto-infer-on-GET.
  const priorityVector = readPriorityVector(sub.priority_vector);
  const layerRows = layerRowsResult.data;
  const entityRows = entityRowsResult.data;
  const edgeRows = edgeRowsResult.data;

  // ── Wave 2: queries that depend only on `sub`. Parent annotations
  //    + sibling room IDs both branch on sub.parent_goal_id and run
  //    in parallel. (Sibling-IDs launches optimistically even though
  //    we'll only use the result when parentAnnotations is non-empty
  //    — saves a round-trip in the common case.) ──
  const parentAnnotationsPromise: Promise<unknown> = sub.parent_goal_id
    ? db
        .from("improvement_goals")
        .select("annotations")
        .eq("id", sub.parent_goal_id)
        .maybeSingle()
        .then((r: { data: { annotations?: unknown } | null }) => r.data?.annotations ?? null)
    : db
        .from("improvement_goals")
        .select("annotations")
        .eq("space_id", spaceId)
        .is("parent_goal_id", null)
        .maybeSingle()
        .then((r: { data: { annotations?: unknown } | null }) => r.data?.annotations ?? null);

  const siblingRoomIdsPromise: Promise<string[]> = sub.parent_goal_id
    ? db
        .from("improvement_goals")
        .select("id")
        .eq("parent_goal_id", sub.parent_goal_id)
        .neq("id", subId)
        .then((r: { data: Array<{ id: string }> | null }) =>
          (r.data ?? []).map((row) => row.id),
        )
    : Promise.resolve([]);

  const [parentAnnotationsRaw, siblingIds] = await Promise.all([
    parentAnnotationsPromise,
    siblingRoomIdsPromise,
  ]);

  const parentAnnotations = normalizeAnnotations(parentAnnotationsRaw);
  // K1 — sub-objective's own annotations. Parallel lens, scoped to
  // this sub-objective's text. Split into title-range vs description-
  // range so the title h1 carries its own inline underlines and the
  // lens card renders the description without repeating the title.
  const subAnnotations = normalizeAnnotations(sub.annotations);
  const { titleAnnotations, descriptionAnnotations } = splitAnnotationsByTitle(
    sub.title,
    sub.description,
    subAnnotations,
  );

  // ── Wave 3: sibling entity rows for cross-room annotation coverage.
  //    Only fires if parentAnnotations exists AND siblings exist —
  //    the conditional that gates the work, not the work that gates
  //    the conditional. ──
  // O3 — Same parent annotations seed every sibling room. When the
  // user hovers a chip in this room's lens strip, we want to surface
  // "+N items in other rooms also derive from this reading" so the
  // annotation's load-bearing status is visible even when its
  // derivations live elsewhere. Without this, a high-utility cross-
  // room annotation looks orphaned at the per-room level.
  const crossRoomCoverageByIndex: Record<number, number> = {};
  if (parentAnnotations.length > 0 && siblingIds.length > 0) {
    const { data: siblingEntityRows } = await db
      .from("entities")
      .select("parent_sub_objective_id, causal_chain")
      .in("parent_sub_objective_id", siblingIds);
    // Aggregate: phrase (lowercased) → count of items deriving from
    // it. A single item with 3 dimensions on the same phrase counts
    // ONCE per item; an item across 3 rooms counts 3.
    const countByPhrase = new Map<string, number>();
    for (const row of (siblingEntityRows ?? []) as Array<{
      parent_sub_objective_id: string;
      causal_chain: Record<string, unknown> | null;
    }>) {
      const dfa = row.causal_chain?.derived_from_annotations;
      if (!Array.isArray(dfa)) continue;
      const itemPhrases = new Set<string>();
      for (const entry of dfa as Array<{ phrase?: unknown }>) {
        if (
          typeof entry?.phrase === "string" &&
          entry.phrase.trim().length > 0
        ) {
          itemPhrases.add(entry.phrase.trim().toLowerCase());
        }
      }
      for (const p of itemPhrases) {
        countByPhrase.set(p, (countByPhrase.get(p) ?? 0) + 1);
      }
    }
    // Map phrase counts → 1-based annotation indices. CRITICAL:
    // weight-sort first to match the lens strip + the LLM's view
    // (the room generator sorts annotations by weight desc before
    // showing them to the LLM, then the LLM emits 1-based indices
    // against that sorted order; the in-room coverageByIndex uses
    // those same indices). Without this sort, the cross-room
    // subscript would land on the wrong chips.
    const rankedForIndexing = [...parentAnnotations]
      .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
      .slice(0, 8);
    rankedForIndexing.forEach((a, i) => {
      const c = countByPhrase.get(a.phrase.trim().toLowerCase()) ?? 0;
      if (c > 0) crossRoomCoverageByIndex[i + 1] = c;
    });
  }

  // ── Layer index ── (rows fetched in wave 1 above)
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

  // Canonical labels are the source of truth — LLM-picked
  // room_lane_labels are stored but intentionally not surfaced.
  // Stochastic per-generation labels broke coherence across
  // reloads and confused the user (Frictions→Wins one regen,
  // Problems→Results the next). One vocabulary, everywhere.
  const laneLabelFor = (slug: (typeof LAYER_ORDER)[number]): string => {
    return CANONICAL_LANE_LABELS[slug];
  };

  const lanes: RoomLane[] = LAYER_ORDER.map((slug) => {
    const meta = layerBySlug.get(slug);
    return {
      slug,
      label: laneLabelFor(slug),
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
    const layer = e.layer_ontology_id
      ? layerById.get(e.layer_ontology_id)
      : undefined;
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

  // Edges fetched in wave 1 above.
  const edges: RoomEdge[] = ((edgeRows ?? []) as RoomEdge[]) ?? [];

  // ── Room placement on the outer ObjectiveStack ──
  // Resolve which canvas-stack layer(s) this room operates at so the
  // header can show "operates at L3 · Goal Conversion" — the literal
  // tie-back from inside the room up to the macro causal stack. The
  // sub carries layer_ordinals (tagged by the proposer); we resolve
  // those against the space's stack to name the layer + archetype.
  const objectiveStack =
    (spaceModeRow?.synthesis_data?.objective_canvas?.layers as
      | ObjectiveStack
      | null
      | undefined) ?? null;
  let roomPlacement: { label: string; archetype: LayerArchetype } | null =
    null;
  if (
    objectiveStack &&
    Array.isArray(sub.layer_ordinals) &&
    sub.layer_ordinals.length > 0
  ) {
    const ordinals = sub.layer_ordinals;
    const touched = objectiveStack.layers
      .filter((l) => ordinals.includes(l.ordinal))
      .sort((a, b) => a.ordinal - b.ordinal);
    if (touched.length > 0) {
      // Peak altitude — the highest layer this room reaches names it.
      const primary = touched[touched.length - 1];
      const posLabel =
        sub.layer_position_label ?? computeLayerPositionLabel(ordinals);
      const prefix = posLabel.split(" · ")[0];
      roomPlacement = {
        label: `${prefix} · ${primary.name}`,
        archetype: primary.archetype,
      };
    }
  }

  return (
    <>
      <ModePill spaceId={spaceId} mode={pipelineMode} />

      {/* Flow content — the objective layout's ObjectiveCanvasShell wraps
          this room in the floating window over the persistent whiteboard
          floor, so reaching it via a mechanism card / breadcrumb / deep
          link looks identical to opening it from the main canvas. The
          shell's window container reserves the top inset for the
          layout-level HomeTabNav, so this only needs a small inner pad. */}
      <div
        className="relative w-full pb-24 pt-6"
        style={{ fontFamily: appleVibe.font.stack }}
      >
        {/* Breadcrumb bar + annotated title only. Definition / Counters
            prose now lives in the room view's hero row (shared with the
            strategic-bets portfolio), so the title stands alone here. */}
        <SubObjectiveRoomHeader
          spaceId={spaceId}
          title={sub.title}
          titleAnnotations={titleAnnotations}
          placement={roomPlacement}
        />

        <div className="mx-auto mt-6 w-full max-w-[1400px] px-8">
          <SubObjectiveRoomView
            spaceId={spaceId}
            subObjectiveId={subId}
            title={sub.title}
            lanes={lanes}
            edges={edges}
            generatedAt={sub.room_layers_generated_at}
            pipelineMode={pipelineMode}
            roomCategoriesRaw={sub.room_categories}
            annotations={parentAnnotations}
            crossRoomCoverageByIndex={crossRoomCoverageByIndex}
            constraints={operationalConstraints}
            priorityVector={priorityVector}
            description={sub.description}
            descriptionAnnotations={descriptionAnnotations}
            topNegativeOutcome={sub.top_negative_outcome}
          />
        </div>
      </div>
    </>
  );
}

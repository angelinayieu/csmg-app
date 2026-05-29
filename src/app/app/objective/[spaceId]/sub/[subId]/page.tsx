// ── /app/objective/[spaceId]/sub/[subId] — Sub-objective room ──
//
// Loads the sub-objective + its 4 layers + already-generated
// entities + cross-layer edges, then mounts the room view. Empty
// state shows a "Generate the room" CTA; populated state shows the
// 4 lanes with items and the ranked correlation list.

import { redirect, notFound } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
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
import {
  computeLayerPositionLabel,
  type ObjectiveStack,
  type LayerArchetype,
} from "@/lib/objective-canvas/layer-model";
import { AnnotatedSubObjectiveCard } from "@/components/objective/annotated-sub-objective-card";
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
}

export default async function SubObjectiveRoomPage({
  params,
}: {
  params: Promise<{ spaceId: string; subId: string }>;
}) {
  const { spaceId, subId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Sub-objective ──
  const { data: sub } = (await db
    .from("improvement_goals")
    .select(
      "id, title, description, space_id, user_id, parent_goal_id, room_layers_generated_at, top_negative_outcome, room_lane_labels, room_categories, annotations, layer_ordinals, layer_position_label",
    )
    .eq("id", subId)
    .maybeSingle()) as { data: Sub | null };

  if (!sub || sub.user_id !== user.id || sub.space_id !== spaceId) {
    notFound();
  }

  // Pipeline mode drives auto-generate behavior in the room view.
  // Also pull synthesis_data so we can extract the operational
  // constraints (Phase 5a — surfaces them as a CONTROL VARIABLES
  // strip inside the room).
  const { data: spaceModeRow } = await db
    .from("spaces")
    .select("pipeline_mode, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  const pipelineMode: PipelineMode =
    spaceModeRow?.pipeline_mode === "review_each"
      ? "review_each"
      : "autopilot";
  const operationalConstraints = readConstraints(spaceModeRow?.synthesis_data);

  // ── Parent annotations — carries the persisted readings the canvas
  //    extracted from the parent objective's text; we surface them as
  //    the Annotation Lens header inside the room so the user can see
  //    which semantic readings seeded each generated item. Falls
  //    through to the space-level root goal if no parent row exists. ──
  let parentAnnotationsRaw: unknown = null;
  if (sub.parent_goal_id) {
    const { data: parent } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("id", sub.parent_goal_id)
      .maybeSingle();
    parentAnnotationsRaw = parent?.annotations ?? null;
  } else {
    // Sub IS the root — fetch the space's root improvement_goal
    // (parent_goal_id IS NULL) for annotations.
    const { data: rootGoal } = await db
      .from("improvement_goals")
      .select("annotations")
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .maybeSingle();
    parentAnnotationsRaw = rootGoal?.annotations ?? null;
  }
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

  // ── O3 — Cross-room annotation coverage ──
  // Same parent annotations seed every sibling room in the space.
  // When the user hovers a chip in this room's lens strip, we want to
  // surface "+N items in other rooms also derive from this reading"
  // so the annotation's load-bearing status is visible even when its
  // derivations live elsewhere. Without this, a high-utility cross-
  // room annotation looks orphaned at the per-room level.
  //
  // Strategy: load sibling rooms' entities (causal_chain only — no
  // expanded_detail bulk), aggregate derived_from_annotation_phrases
  // by phrase, then map to parentAnnotation indices.
  const crossRoomCoverageByIndex: Record<number, number> = {};
  if (parentAnnotations.length > 0 && sub.parent_goal_id) {
    const { data: siblingRoomRows } = await db
      .from("improvement_goals")
      .select("id")
      .eq("parent_goal_id", sub.parent_goal_id)
      .neq("id", subId);
    const siblingIds = (
      (siblingRoomRows ?? []) as Array<{ id: string }>
    ).map((r) => r.id);
    if (siblingIds.length > 0) {
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
  }

  // ── Layers ──
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

  // ── Entities scoped to this sub-objective ──
  const { data: entityRows } = await db
    .from("entities")
    .select(
      "id, name, description, entity_type, layer_ontology_id, causal_chain",
    )
    .eq("parent_sub_objective_id", subId);

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
    });
  }

  // ── Edges scoped to this sub-objective ──
  // agent_feedback carries the LLM-named mechanism (the specific
  // lever) for the side panel to surface as deeper insight.
  const { data: edgeRows } = await db
    .from("edges")
    .select(
      "id, source_entity_id, target_entity_id, relationship_type, strength, polarity, conditions, approved_at, agent_feedback",
    )
    .eq("parent_sub_objective_id", subId);
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
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{
        background: "#fafafa",
        backgroundImage:
          "radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        backgroundPosition: "0 0",
        fontFamily: appleVibe.font.stack,
      }}
    >
      <HomeTabNav />
      <ModePill spaceId={spaceId} mode={pipelineMode} />

      <div className="relative w-full pb-24 pt-16">
        {/* Breadcrumb bar + annotated title + Counters callout.
            The breadcrumb is full-width (lab-style); the header proper
            is centered to the 1400px column inside the component. */}
        <SubObjectiveRoomHeader
          spaceId={spaceId}
          title={sub.title}
          titleAnnotations={titleAnnotations}
          topNegativeOutcome={sub.top_negative_outcome}
          placement={roomPlacement}
        />

        <div className="mx-auto w-full max-w-[1400px] px-8">
          {/* ── K1 — Sub-objective description lens ──
              Renders the description ONLY (the title carries its own
              inline annotations in the header above, so we don't
              repeat it here). Hidden when there's no description and
              no readings. */}
          {(sub.description?.trim() || descriptionAnnotations.length > 0) && (
            <div className="mt-5 max-w-2xl">
              {/* Raw (untrimmed) description — annotation offsets are
                  relative to the raw string, so trimming here would
                  shift the underlines. */}
              <AnnotatedSubObjectiveCard
                objectiveText={sub.description ?? ""}
                annotations={descriptionAnnotations}
              />
            </div>
          )}
        </div>

        <div className="mx-auto mt-10 w-full max-w-[1400px] px-8">
          <SubObjectiveRoomView
            spaceId={spaceId}
            subObjectiveId={subId}
            lanes={lanes}
            edges={edges}
            generatedAt={sub.room_layers_generated_at}
            pipelineMode={pipelineMode}
            roomCategoriesRaw={sub.room_categories}
            annotations={parentAnnotations}
            crossRoomCoverageByIndex={crossRoomCoverageByIndex}
            constraints={operationalConstraints}
          />
        </div>
      </div>
    </div>
  );
}

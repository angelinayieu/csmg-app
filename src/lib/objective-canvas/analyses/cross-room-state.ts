// ── Cross-room state loader ────────────────────────────────────────
//
// Single function that walks an entire space — root goal,
// annotations, sub-objectives, all entities, all edges — and packages
// the result into a CrossRoomState ready for analysis modules to
// consume. The shape mirrors what a single room view loads, but
// flattened across every room in the space.
//
// Used by:
//   • POST /api/brainstorm/space/analysis/scan
//   • POST /api/brainstorm/space/analysis/run
//   • the canvas page's server-side initial scan
//
// Auth + ownership are the caller's responsibility — this is a pure
// loader; pass an already-scoped supabase client.

import { normalizeAnnotations } from "../normalize-annotations";
import { readConstraints } from "../constraints";
import { getUserIntentPreferences } from "../decision-log";
import { stateHash } from "./state-hash";
import type {
  CrossRoomState,
  EdgeSnapshot,
  ItemSnapshot,
  RoomSnapshot,
} from "./types";
import type { ExpandedItemDetail } from "../expand-item-detail";
import type { AnnotationProvenance } from "../layered-generation";

export interface LoadCrossRoomStateArgs {
  /** Already-authed supabase client. We accept any to dodge type
   *  friction across server/client; callers should narrow. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  /** Optional — when provided, loadCrossRoomState ALSO fetches the
   *  user's decision-log intent preferences and includes them on the
   *  returned state. Analyses can then bias toward the user's
   *  revealed pattern (e.g., "user elects gap_fill 60% of the time
   *  → prioritize uncovered lens entries"). Back-compat: omit to
   *  skip the extra query. */
  userId?: string;
}

export interface LoadResult {
  state: CrossRoomState;
  /** Hash of the input state — caller compares to a cached hash to
   *  decide whether to re-run analyses. */
  state_hash: string;
  /** Raw synthesis_data so callers can read/write the cached scan
   *  alongside the constraints + other canvas state. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  synthesisData: any;
}

const LAYER_SLUGS = ["pain", "features", "outcomes", "objective"] as const;

export async function loadCrossRoomState(
  args: LoadCrossRoomStateArgs,
): Promise<LoadResult> {
  const { db, spaceId, userId } = args;

  // ── Space row ──
  const { data: space } = await db
    .from("spaces")
    .select("id, description, input_text, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) {
    throw new Error("space not found");
  }
  const coreObjectiveText: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  // ── Root goal annotations ──
  // Parent annotations live on the space's root improvement_goal
  // (parent_goal_id IS NULL). Same fetch the room generation does.
  const { data: rootGoal } = await db
    .from("improvement_goals")
    .select("annotations")
    .eq("space_id", spaceId)
    .is("parent_goal_id", null)
    .maybeSingle();
  const parentAnnotations = normalizeAnnotations(rootGoal?.annotations);

  // ── Sub-objective rooms ──
  // We treat any goal with parent_goal_id != null AND space_id matching
  // as a room. (The root goal itself has its own room only if you
  // count the parent — we ignore it here since the canvas page is
  // about its children.)
  const { data: subRows } = await db
    .from("improvement_goals")
    .select(
      "id, title, description, top_negative_outcome, room_layers_generated_at",
    )
    .eq("space_id", spaceId)
    .not("parent_goal_id", "is", null);
  const rooms: RoomSnapshot[] = ((subRows ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    top_negative_outcome: string | null;
    room_layers_generated_at: string | null;
  }>).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    top_negative_outcome: r.top_negative_outcome,
    generated_at: r.room_layers_generated_at,
  }));
  const roomIds = rooms.map((r) => r.id);

  // ── User decision-log preferences (optional) ──
  // When userId is provided, load the per-user election-rate per
  // intent so analyses can bias by the user's revealed pattern.
  // Single small query (cap 200) — fire it in parallel with the
  // entity/edge loads below where possible.
  const userPrefsPromise = userId
    ? getUserIntentPreferences(db, userId)
    : Promise.resolve(undefined);

  if (roomIds.length === 0) {
    // No rooms generated yet — empty state, no analyses to run.
    return {
      state: {
        space_id: spaceId,
        core_objective_text: coreObjectiveText,
        parent_annotations: parentAnnotations,
        constraints: readConstraints(space.synthesis_data),
        rooms: [],
        items: [],
        edges: [],
        user_intent_preferences: await userPrefsPromise,
        layers: readObjectiveStack(space.synthesis_data),
      },
      state_hash: stateHash({
        roomIds: [],
        itemIds: [],
        electedVariationIds: [],
        expansionNodeIds: [],
      }),
      synthesisData: space.synthesis_data,
    };
  }

  // ── Layer ontology — entity layer slug lookup ──
  const { data: layerRows } = await db
    .from("layer_ontology")
    .select("id, slug")
    .eq("space_id", spaceId);
  const slugByLayerId = new Map<string, string>();
  for (const r of (layerRows ?? []) as Array<{ id: string; slug: string }>) {
    if ((LAYER_SLUGS as readonly string[]).includes(r.slug)) {
      slugByLayerId.set(r.id, r.slug);
    }
  }

  // ── Entities across ALL rooms ──
  const { data: entityRows } = await db
    .from("entities")
    .select(
      "id, name, parent_sub_objective_id, layer_ontology_id, causal_chain, expanded_detail",
    )
    .in("parent_sub_objective_id", roomIds);

  const items: ItemSnapshot[] = ((entityRows ?? []) as Array<{
    id: string;
    name: string;
    parent_sub_objective_id: string;
    layer_ontology_id: string | null;
    causal_chain: Record<string, unknown> | null;
    expanded_detail: ExpandedItemDetail | null;
  }>).map((e) => {
    const layer = e.layer_ontology_id
      ? (slugByLayerId.get(e.layer_ontology_id) as ItemSnapshot["layer"]) ?? "features"
      : "features";

    // Derive elected variation ids from expanded_detail.
    const electedVariationIds: string[] = Array.isArray(
      e.expanded_detail?.variations,
    )
      ? (e.expanded_detail!.variations as Array<{
          id: string;
          disposition?: unknown;
        }>)
          .filter((v) => v.disposition === "elected")
          .map((v) => v.id)
      : [];

    // Derive annotation indices + phrases from
    // causal_chain.derived_from_annotations. The persisted shape is
    // [{index, phrase, facet}]; we extract both. Phrases are the
    // RELIABLE matching key — indices can shift if annotations
    // get regenerated (see Phase-2 stability note in types.ts).
    const dfa = (e.causal_chain as Record<string, unknown> | null)?.derived_from_annotations;
    const derivedFromAnnotationIndices: number[] = [];
    const derivedFromAnnotationPhrases: string[] = [];
    if (Array.isArray(dfa)) {
      for (const entry of dfa as Array<{ index?: unknown; phrase?: unknown }>) {
        if (typeof entry?.index === "number" && Number.isFinite(entry.index) && entry.index >= 1) {
          derivedFromAnnotationIndices.push(Math.floor(entry.index));
        }
        if (typeof entry?.phrase === "string" && entry.phrase.trim().length > 0) {
          derivedFromAnnotationPhrases.push(entry.phrase.trim().toLowerCase());
        }
      }
    }

    return {
      id: e.id,
      room_id: e.parent_sub_objective_id,
      name: e.name,
      layer,
      causal_chain: e.causal_chain,
      expanded_detail: e.expanded_detail,
      elected_variation_ids: electedVariationIds,
      derived_from_annotation_indices: derivedFromAnnotationIndices,
      derived_from_annotation_phrases: derivedFromAnnotationPhrases,
    };
  });

  // ── Edges across ALL rooms ──
  const { data: edgeRows } = await db
    .from("edges")
    .select(
      "id, parent_sub_objective_id, source_entity_id, target_entity_id, strength, agent_feedback",
    )
    .in("parent_sub_objective_id", roomIds);

  const edges: EdgeSnapshot[] = ((edgeRows ?? []) as Array<{
    id: string;
    parent_sub_objective_id: string;
    source_entity_id: string;
    target_entity_id: string;
    strength: number | null;
    agent_feedback: Record<string, unknown> | null;
  }>).map((e) => {
    const fb = e.agent_feedback ?? {};
    const mechanism =
      typeof fb.mechanism === "string" ? fb.mechanism : null;
    const dfaRaw = fb.derived_from_annotation;
    let dfa: AnnotationProvenance | null = null;
    if (dfaRaw && typeof dfaRaw === "object") {
      const r = dfaRaw as Record<string, unknown>;
      const idx =
        typeof r.index === "number" && Number.isFinite(r.index)
          ? Math.floor(r.index)
          : null;
      const phrase = typeof r.phrase === "string" ? r.phrase : null;
      const facet =
        typeof r.facet === "string"
          ? (r.facet as AnnotationProvenance["facet"])
          : "reading";
      if (idx !== null && phrase !== null) {
        dfa = { index: idx, phrase, facet };
      }
    }
    return {
      id: e.id,
      room_id: e.parent_sub_objective_id,
      source_entity_id: e.source_entity_id,
      target_entity_id: e.target_entity_id,
      strength: e.strength,
      mechanism,
      derived_from_annotation: dfa,
    };
  });

  // ── State hash for cache invalidation ──
  // M1 — also fold KEPT expansion-tree node ids into the hash so that
  // adding / removing / re-parking deep work invalidates cached
  // polish + cached analysis. Parked nodes excluded — same as if
  // never spawned.
  const allElectedIds: string[] = [];
  const allExpansionIds: string[] = [];
  for (const it of items) {
    allElectedIds.push(...it.elected_variation_ids);
    const tree = it.expanded_detail?.expansion_tree ?? [];
    for (const n of tree) {
      if (n.disposition !== "parked") allExpansionIds.push(n.id);
    }
  }
  const hash = stateHash({
    roomIds: roomIds.slice().sort(),
    itemIds: items.map((i) => i.id).sort(),
    electedVariationIds: allElectedIds.sort(),
    expansionNodeIds: allExpansionIds.sort(),
  });

  return {
    state: {
      space_id: spaceId,
      core_objective_text: coreObjectiveText,
      parent_annotations: parentAnnotations,
      constraints: readConstraints(space.synthesis_data),
      rooms,
      items,
      edges,
      user_intent_preferences: await userPrefsPromise,
      layers: readObjectiveStack(space.synthesis_data),
    },
    state_hash: hash,
    synthesisData: space.synthesis_data,
  };
}

/** Phase 11.A — pull the ObjectiveStack out of synthesis_data when
 *  present. Pre-11.A spaces return undefined cleanly so analyses
 *  that depend on layers (layer_coverage) can short-circuit. */
function readObjectiveStack(
  synthesisData: unknown,
): import("../layer-model").ObjectiveStack | undefined {
  if (!synthesisData || typeof synthesisData !== "object") return undefined;
  const oc = (synthesisData as { objective_canvas?: unknown })
    .objective_canvas;
  if (!oc || typeof oc !== "object") return undefined;
  const layers = (oc as { layers?: unknown }).layers;
  if (!layers || typeof layers !== "object") return undefined;
  // Light shape check — `layers.layers` is the array.
  const stack = layers as { layers?: unknown };
  if (!Array.isArray(stack.layers)) return undefined;
  return layers as import("../layer-model").ObjectiveStack;
}

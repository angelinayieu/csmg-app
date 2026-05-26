// ── /app/objective/[spaceId] — single Objective Canvas ──
//
// Server route. Loads the space + initial Objective Canvas state out
// of `synthesis_data.objective_canvas`, then hands off to the client
// orchestrator <ObjectiveCanvasView /> which drives the staged UI.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { HomeTabNav } from "@/components/app/home-tab-nav";
import { ObjectiveCanvasView } from "@/components/objective/objective-canvas-view";
import { ModePill, type PipelineMode } from "@/components/objective/mode-pill";
import type { MainCanvasSub } from "@/components/objective/main-canvas-view";
import { readObjectiveCanvasState } from "@/lib/objective-canvas/clarifying-state";
import { normalizeAnnotations } from "@/lib/objective-canvas/normalize-annotations";
import { normalizeRoomCategories } from "@/lib/objective-canvas/generate-categories";
import { computeChains } from "@/lib/objective-canvas/compute-chains";
import {
  getUserIntentPreferences,
  getGlobalIntentPreferences,
  topPreferredIntent,
} from "@/lib/objective-canvas/decision-log";
import {
  computeCrossRoomSignalsFromData,
  type CrossRoomSignals,
} from "@/lib/objective-canvas/cross-room-signals";
import {
  loadConceptMemoryFeed,
  type ConceptMemoryEntry,
} from "@/lib/objective-canvas/concept-memory-feed";
import type { RoomEdge } from "@/components/objective/sub-objective-room-view";
import { ArrowLeft, FileText } from "lucide-react";
import { AnalysisWorkbench } from "@/components/objective/analysis-workbench";
import { TIER_2_OPERATIONS } from "@/lib/objective-canvas/analyses";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";

export const dynamic = "force-dynamic";

export default async function ObjectiveCanvasPage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select(
      "id, name, description, input_text, user_id, archived, synthesis_data, pipeline_mode",
    )
    .eq("id", spaceId)
    .maybeSingle();

  if (!space || space.user_id !== user.id) notFound();
  if (space.archived) redirect("/app/objective");

  const objective: string =
    (typeof space.description === "string" && space.description.trim()) ||
    (typeof space.input_text === "string" && space.input_text.trim()) ||
    "";

  const state = readObjectiveCanvasState(space.synthesis_data);

  // ── Load sub-objective rows for the "main" stage ───────────────
  // Sub-objectives = improvement_goals rows with parent_goal_id
  // pointing at this space's root goal. Phase 3's confirm route
  // inserts them on pick. For each sub-objective we also fetch the
  // entities that are endpoints of APPROVED cross-layer correlation
  // edges — Phase 8's "approved fork strip" surfaces those under
  // each card.
  let initialMainSubs: MainCanvasSub[] = [];
  let initialCoreAnnotations: import("@/components/objective/annotated-objective-card").ObjectiveAnnotation[] = [];
  // Cross-room signals — computed from the entities + edges already
  // loaded below. Null when <2 sub-objectives exist (nothing to
  // cross-reference); empty signals when there are rooms but no
  // overlap detected.
  let initialCrossRoomSignals: CrossRoomSignals | null = null;
  // Variant Lab — per-user revealed preference: which intent the user
  // tends to elect most. When no lens-gap exists, the picker's
  // "Suggested" affordance reads this instead of defaulting to
  // "creative". Loaded for the picking stage only — cheap enough to
  // run unconditionally though, and null for new users.
  //
  // When the user has no per-user signal yet, fall back to
  // population-wide preferences (cross-user flywheel). Brand-new
  // users still get smart suggestions, sourced from what the
  // community elected most. Both reads happen in parallel.
  const [userPrefs, globalPrefs, conceptMemoryFeed] = await Promise.all([
    getUserIntentPreferences(db, user.id),
    getGlobalIntentPreferences(db),
    // Ambient KG signal — top concepts the user has been actively
    // reasoning across, regardless of the current objective. Renders
    // as a small strip on the main canvas. Empty when the user has
    // no canonical-linked entities yet.
    loadConceptMemoryFeed({ db, userId: user.id, limit: 8 }),
  ]);
  const initialConceptMemory: ConceptMemoryEntry[] = conceptMemoryFeed;
  const initialPreferredIntent =
    topPreferredIntent(userPrefs) ?? topPreferredIntent(globalPrefs);
  // Source attribution lets the UI explain WHY this intent was
  // suggested. Reads cleanly as "matches your past picks" vs
  // "popular with similar users."
  const initialPreferenceSource:
    | "user"
    | "global"
    | "none" =
    topPreferredIntent(userPrefs) !== null
      ? "user"
      : topPreferredIntent(globalPrefs) !== null
        ? "global"
        : "none";
  if (state.stage === "main" || state.stage === "done") {
    const { data: parentRows } = await db
      .from("improvement_goals")
      .select("id, annotations")
      .eq("space_id", spaceId)
      .is("parent_goal_id", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const parentGoalId =
      Array.isArray(parentRows) && parentRows.length > 0
        ? (parentRows[0]?.id as string)
        : null;
    if (Array.isArray(parentRows) && parentRows.length > 0) {
      // Normalize at the read boundary — annotations in the DB may be in
      // pre-v3 shape (single `like` field, no `analogies[]`/`dimensions[]`/
      // `inference_chain[]`/`scope`). The v3 card accesses those fields
      // directly and crashes on undefined; the normalizer migrates v2 →
      // v3 and fills missing arrays with [].
      initialCoreAnnotations = normalizeAnnotations(parentRows[0]?.annotations);
    }
    if (parentGoalId) {
      const { data: childRows } = await db
        .from("improvement_goals")
        .select(
          "id, title, description, auto_detection_rationale, room_layers_generated_at, top_negative_outcome, room_categories, created_at",
        )
        .eq("space_id", spaceId)
        .eq("parent_goal_id", parentGoalId)
        .order("created_at", { ascending: true });
      const subs = ((childRows ?? []) as Array<{
        id: string;
        title: string;
        description: string | null;
        auto_detection_rationale: string | null;
        room_layers_generated_at: string | null;
        top_negative_outcome: string | null;
        room_categories: unknown;
      }>);

      // For each sub-objective, find approved-edge endpoints and the
      // layer those entities belong to. Two queries (edges, then
      // entities) keep each one indexable.
      const { data: layerRows } = await db
        .from("layer_ontology")
        .select("id, slug")
        .eq("space_id", spaceId);
      const slugByLayerId = new Map<string, string>();
      for (const r of (layerRows ?? []) as Array<{ id: string; slug: string }>) {
        slugByLayerId.set(r.id, r.slug);
      }

      const subIds = subs.map((s) => s.id);

      // ── All entities scoped to these subs ──
      // Pulled in one shot so we can compute (a) full lane-by-
      // sub_category breakdowns for the card-level tree view and
      // (b) the legacy approvedItems chip strip in one pass.
      type EntityRow = {
        id: string;
        name: string;
        layer_ontology_id: string | null;
        parent_sub_objective_id: string | null;
        causal_chain: Record<string, unknown> | null;
      };
      let allEntities: EntityRow[] = [];
      // ── All edges scoped to these subs (with mechanism in
      // agent_feedback) — drives both the approvedItems chip strip
      // and the compute-chains pass for approved archetypes. ──
      type EdgeRow = {
        id: string;
        source_entity_id: string;
        target_entity_id: string;
        relationship_type: string;
        strength: number | null;
        polarity: string | null;
        conditions: string | null;
        approved_at: string | null;
        agent_feedback: Record<string, unknown> | null;
        parent_sub_objective_id: string | null;
      };
      let allEdges: EdgeRow[] = [];

      if (subIds.length > 0) {
        const [entRes, edgeRes] = await Promise.all([
          db
            .from("entities")
            .select(
              "id, name, layer_ontology_id, parent_sub_objective_id, causal_chain",
            )
            .in("parent_sub_objective_id", subIds),
          db
            .from("edges")
            .select(
              "id, source_entity_id, target_entity_id, relationship_type, strength, polarity, conditions, approved_at, agent_feedback, parent_sub_objective_id",
            )
            .in("parent_sub_objective_id", subIds),
        ]);
        allEntities = ((entRes.data ?? []) as EntityRow[]);
        allEdges = ((edgeRes.data ?? []) as EdgeRow[]);

        // ── Cross-room signals — reuse the data we already loaded.
        // Computed only when ≥2 sub-objectives exist (the helper
        // returns empty arrays otherwise; we leave null so the UI
        // strip doesn't render anything misleading). ──
        if (subs.length >= 2) {
          initialCrossRoomSignals = computeCrossRoomSignalsFromData({
            subs: subs.map((s) => ({ id: s.id, title: s.title })),
            entities: allEntities.map((e) => ({
              parent_sub_objective_id: e.parent_sub_objective_id,
              causal_chain: e.causal_chain,
            })),
            edges: allEdges.map((e) => ({
              parent_sub_objective_id: e.parent_sub_objective_id,
              agent_feedback: e.agent_feedback,
            })),
          });
        }
      }

      // Index entities by id (for chain compute) and group by sub.
      const entityById = new Map<string, EntityRow>();
      const entitiesBySub = new Map<string, EntityRow[]>();
      for (const e of allEntities) {
        entityById.set(e.id, e);
        if (!e.parent_sub_objective_id) continue;
        const list = entitiesBySub.get(e.parent_sub_objective_id) ?? [];
        list.push(e);
        entitiesBySub.set(e.parent_sub_objective_id, list);
      }

      const edgesBySub = new Map<string, EdgeRow[]>();
      for (const e of allEdges) {
        if (!e.parent_sub_objective_id) continue;
        const list = edgesBySub.get(e.parent_sub_objective_id) ?? [];
        list.push(e);
        edgesBySub.set(e.parent_sub_objective_id, list);
      }

      // Helper: get the sub_category slug out of a causal_chain.
      const slugOf = (cc: Record<string, unknown> | null): string | null => {
        if (!cc || typeof cc.sub_category !== "string") return null;
        return cc.sub_category.length > 0 ? cc.sub_category : null;
      };
      const laneOf = (
        layerOntologyId: string | null,
      ): "pain" | "features" | "outcomes" | "objective" | null => {
        if (!layerOntologyId) return null;
        const slug = slugByLayerId.get(layerOntologyId);
        return slug === "pain" ||
          slug === "features" ||
          slug === "outcomes" ||
          slug === "objective"
          ? slug
          : null;
      };

      // Layer ordering for chip strip
      const LAYER_ORDER = {
        pain: 0,
        features: 1,
        outcomes: 2,
        objective: 3,
      } as const;

      initialMainSubs = subs.map((r) => {
        const subEntities = entitiesBySub.get(r.id) ?? [];
        const subEdges = edgesBySub.get(r.id) ?? [];

        // ── Lane breakdown: count items per (lane × sub_category) ──
        const cats = normalizeRoomCategories(r.room_categories);
        function laneBucket(
          laneEntities: EntityRow[],
          categorySet: Array<{ slug: string; label: string; color: string }>,
        ) {
          const counts = new Map<string, number>();
          let untagged = 0;
          for (const e of laneEntities) {
            const slug = slugOf(e.causal_chain);
            if (!slug) {
              untagged += 1;
              continue;
            }
            counts.set(slug, (counts.get(slug) ?? 0) + 1);
          }
          const rows = categorySet
            .map((c) => ({
              label: c.label,
              color: c.color,
              count: counts.get(c.slug) ?? 0,
            }))
            .filter((c) => c.count > 0);
          return { rows, untagged };
        }

        const painEntities = subEntities.filter(
          (e) => laneOf(e.layer_ontology_id) === "pain",
        );
        const featureEntities = subEntities.filter(
          (e) => laneOf(e.layer_ontology_id) === "features",
        );
        const outcomeEntities = subEntities.filter(
          (e) => laneOf(e.layer_ontology_id) === "outcomes",
        );

        const frictionBreakdown = laneBucket(painEntities, cats.friction);
        const mechanismBreakdown = laneBucket(featureEntities, cats.mechanism);
        const resultBreakdown = laneBucket(outcomeEntities, cats.result);

        // ── Approved archetypes: compute chains + filter to those
        //    where BOTH underlying edges are approved. Group by
        //    category triple for the card's "approved plays" list. ──
        const subEntityIndex = new Map<
          string,
          {
            id: string;
            name: string;
            layer: "pain" | "features" | "outcomes" | "objective";
            subCategorySlug?: string | null;
          }
        >();
        for (const e of subEntities) {
          const lane = laneOf(e.layer_ontology_id);
          if (!lane) continue;
          subEntityIndex.set(e.id, {
            id: e.id,
            name: e.name,
            layer: lane,
            subCategorySlug: slugOf(e.causal_chain),
          });
        }
        const roomEdges: RoomEdge[] = subEdges.map((e) => ({
          id: e.id,
          source_entity_id: e.source_entity_id,
          target_entity_id: e.target_entity_id,
          relationship_type: e.relationship_type,
          strength: e.strength,
          polarity: e.polarity,
          conditions: e.conditions,
          approved_at: e.approved_at,
          agent_feedback: e.agent_feedback,
        }));
        const chains = computeChains(roomEdges, subEntityIndex);
        const approvedChainArchetypes = new Map<
          string,
          {
            triple: Array<{ label: string; color: string } | null>;
            count: number;
          }
        >();
        const resolveTripleEntry = (
          lane: "friction" | "mechanism" | "result",
          slug: string | null,
        ): { label: string; color: string } | null => {
          if (!slug) return null;
          const hit = cats[lane].find((c) => c.slug === slug);
          return hit ? { label: hit.label, color: hit.color } : null;
        };
        for (const c of chains) {
          const isApproved =
            c.painFeatureEdge.approved_at !== null &&
            c.featureOutcomeEdge.approved_at !== null;
          if (!isApproved) continue;
          const p = c.categoryTriple.painSlug ?? "_";
          const f = c.categoryTriple.featureSlug ?? "_";
          const rr = c.categoryTriple.resultSlug ?? "_";
          const key = `${p}::${f}::${rr}`;
          const existing = approvedChainArchetypes.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            approvedChainArchetypes.set(key, {
              triple: [
                resolveTripleEntry("friction", c.categoryTriple.painSlug),
                resolveTripleEntry("mechanism", c.categoryTriple.featureSlug),
                resolveTripleEntry("result", c.categoryTriple.resultSlug),
              ],
              count: 1,
            });
          }
        }
        const approvedArchetypes = Array.from(
          approvedChainArchetypes.entries(),
        )
          .map(([key, v]) => ({ key, ...v }))
          .sort((a, b) => b.count - a.count);

        // Legacy approvedItems (chip strip) — endpoints of approved
        // edges that are pain/feature/outcome.
        const approvedEntityIds = new Set<string>();
        for (const e of subEdges) {
          if (!e.approved_at) continue;
          approvedEntityIds.add(e.source_entity_id);
          approvedEntityIds.add(e.target_entity_id);
        }
        const approvedItems: Array<{
          id: string;
          name: string;
          layer: "pain" | "features" | "outcomes" | "objective";
        }> = [];
        for (const e of subEntities) {
          if (!approvedEntityIds.has(e.id)) continue;
          const lane = laneOf(e.layer_ontology_id);
          if (!lane) continue;
          approvedItems.push({ id: e.id, name: e.name, layer: lane });
        }
        approvedItems.sort(
          (a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer],
        );

        return {
          id: r.id,
          title: r.title,
          description: r.description,
          rationale: r.auto_detection_rationale,
          generatedAt: r.room_layers_generated_at,
          topNegativeOutcome: r.top_negative_outcome,
          approvedItems,
          laneBreakdown: {
            friction: frictionBreakdown.rows,
            mechanism: mechanismBreakdown.rows,
            result: resultBreakdown.rows,
          },
          laneTotalCounts: {
            friction: painEntities.length,
            mechanism: featureEntities.length,
            result: outcomeEntities.length,
          },
          approvedArchetypes,
          approvedPlayCount: chains.filter(
            (c) =>
              c.painFeatureEdge.approved_at !== null &&
              c.featureOutcomeEdge.approved_at !== null,
          ).length,
        };
      });
    }
  }

  // ── Analysis Workbench inputs ──
  // Read the cached cross_room_analysis state if any (lives under
  // synthesis_data.cross_room_analysis). Workbench will silently
  // re-scan on mount if no cache OR if state_hash drifted.
  const cachedAnalysis: CrossRoomAnalysisState | null =
    (space.synthesis_data?.cross_room_analysis as
      | CrossRoomAnalysisState
      | null
      | undefined) ?? null;

  // ── Sub-objective theme analysis (parallel to cross_room_analysis)
  // Cached on synthesis_data.sub_objective_themes. Drives the
  // row-per-theme gallery on MainCanvasView. Type imported lazily so
  // this file doesn't depend on cluster-proposals statically. ──
  type InitialSubObjectiveThemes =
    import("@/lib/objective-canvas/cluster-proposals").ClusterAnalysis;
  const initialSubObjectiveThemes: InitialSubObjectiveThemes | null =
    (space.synthesis_data?.sub_objective_themes as
      | InitialSubObjectiveThemes
      | null
      | undefined) ?? null;
  const roomTitles: Record<string, string> = {};
  for (const s of initialMainSubs) {
    roomTitles[s.id] = s.title;
  }
  // Workbench only matters once rooms exist — gate on main/done
  // stage AND ≥1 sub-objective.
  const showWorkbench =
    (state.stage === "main" || state.stage === "done") &&
    initialMainSubs.length > 0;
  const operationsCatalog = TIER_2_OPERATIONS.map((m) => ({
    key: m.key,
    label: m.label,
    description: m.description,
  }));

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto"
      style={{
        background: "#fafafa",
        backgroundImage:
          "radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        backgroundPosition: "0 0",
      }}
    >
      <HomeTabNav />
      <ModePill
        spaceId={spaceId}
        mode={
          space.pipeline_mode === "review_each"
            ? "review_each"
            : ("autopilot" as PipelineMode)
        }
      />

      <div className="relative mx-auto w-full max-w-5xl px-6 pb-24 pt-24">
        <Link
          href="/app/objective"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium"
          style={{ color: "rgba(15,23,42,0.55)" }}
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back
        </Link>

        {showWorkbench && (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-end">
              <Link
                href={`/app/objective/${spaceId}/brief`}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
                style={{
                  background: "rgba(15,23,42,0.92)",
                  color: "#fff",
                }}
              >
                <FileText className="h-3 w-3" strokeWidth={2} />
                View Strategy Brief →
              </Link>
            </div>
            <AnalysisWorkbench
              spaceId={spaceId}
              initialAnalysis={cachedAnalysis}
              roomTitles={roomTitles}
              operations={operationsCatalog}
            />
          </div>
        )}

        <div className="mt-6">
          <ObjectiveCanvasView
            spaceId={spaceId}
            objective={objective}
            initialStage={state.stage}
            initialClarifying={state.clarifying ?? null}
            initialSubObjectives={state.sub_objectives ?? null}
            initialMainSubs={initialMainSubs}
            initialCoreAnnotations={initialCoreAnnotations}
            initialPreferredIntent={initialPreferredIntent}
            initialPreferenceSource={initialPreferenceSource}
            initialUserPrefs={userPrefs}
            initialCrossRoomSignals={initialCrossRoomSignals}
            initialSubObjectiveThemes={initialSubObjectiveThemes}
            initialConceptMemory={initialConceptMemory}
          />
        </div>
      </div>
    </div>
  );
}

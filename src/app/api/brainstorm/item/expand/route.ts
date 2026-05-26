// ── POST /api/brainstorm/item/expand ──────────────────────────────
//
// Lazy-fetches the item detail drawer's depth surface (definition +
// variations + planning). Called once when the user first opens the
// drawer for an entity; cached on entities.expanded_detail thereafter.
//
// Body: { entityId, mode?: "default" | "force" }
//
// "force" regenerates from scratch (user explicitly asked).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  expandItemDetail,
  type ExpandedItemDetail,
} from "@/lib/objective-canvas/expand-item-detail";
import {
  buildRagBlock,
  type SurfaceBundle,
  type DeepBundle,
} from "@/lib/research/research-service";
import { readConstraints } from "@/lib/objective-canvas/constraints";
import {
  getUserVariationKindPreferences,
  variationKindSignalIsLive,
} from "@/lib/objective-canvas/decision-log";
import { loadRelevantCanonicalConcepts } from "@/lib/objective-canvas/canonical-concept-lookup";
import type { CrossRoomAnalysisState } from "@/lib/objective-canvas/analyses/types";
import {
  resolveParentObjectiveContext,
  resolveEntityLayer,
  type LayerSlug,
} from "@/lib/objective-canvas/context-helpers";

export const runtime = "nodejs";
export const maxDuration = 45;

interface Body {
  entityId?: string;
  mode?: "default" | "force";
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  if (!entityId) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }
  const force = body?.mode === "force";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // ── Load entity + ownership check ──
  const { data: entity, error: entityErr } = await db
    .from("entities")
    .select(
      "id, name, layer_ontology_id, parent_sub_objective_id, causal_chain, expanded_detail, space_id",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (entityErr) {
    return NextResponse.json(
      { error: "DB error", detail: entityErr.message },
      { status: 500 },
    );
  }
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }

  // Verify the user owns the parent space (RLS-ish via app code).
  const { data: space } = await db
    .from("spaces")
    .select(
      "id, user_id, description, input_text, surface_research, deep_research, synthesis_data",
    )
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // ── Cross-space KG read — load BEFORE the cache-hit short-circuit
  // so cache hits return prior_concepts too, enabling the drawer to
  // render the strip + per-variation link badges consistently on
  // every drawer open (not just fresh generations).
  //
  // Query text uses entity.name + causal_chain outcome text. We
  // intentionally skip subObjectiveTitle here (resolved later) — the
  // marginal precision gain isn't worth duplicating the sub-objective
  // lookup. Soft-fail throughout. ──
  const itemQueryText = [
    entity.name,
    typeof entity.causal_chain === "object" && entity.causal_chain
      ? (() => {
          const cc = entity.causal_chain as Record<string, unknown>;
          if (typeof cc.negative_outcome === "string") return cc.negative_outcome;
          if (typeof cc.positive_outcome === "string") return cc.positive_outcome;
          if (typeof cc.measured_by === "string") return cc.measured_by;
          return "";
        })()
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const priorConceptsRaw = await loadRelevantCanonicalConcepts({
    db,
    userId: auth.user.id,
    queryText: itemQueryText,
    excludeSpaceId: entity.space_id,
    limit: 6,
  });
  // Response shape — strips internal similarity scores but keeps
  // canonical_code so chip clicks can open CanonicalConceptDrawer
  // ({canonicalCode}) for cross-space deep-inspection.
  const priorConceptsForResponse = priorConceptsRaw.map((c) => ({
    id: c.id,
    canonical_code: c.canonical_code,
    display_name: c.display_name,
    description: c.description,
    domain_tags: c.domain_tags,
    space_count: c.space_count,
  }));
  // Generator-shape — used later when expandItemDetail fires (only on
  // cache miss). Same data, slimmer (no id).
  const priorConcepts =
    priorConceptsRaw.length > 0
      ? priorConceptsRaw.map((c) => ({
          display_name: c.display_name,
          description: c.description,
          domain_tags: c.domain_tags,
          space_count: c.space_count,
        }))
      : undefined;

  // Idempotent short-circuit on cached detail.
  const existing = entity.expanded_detail as ExpandedItemDetail | null;
  const hasCached =
    !!existing &&
    typeof existing === "object" &&
    typeof (existing as { definition?: unknown }).definition === "string" &&
    (existing as { definition: string }).definition.length > 0;
  if (!force && hasCached) {
    return NextResponse.json({
      expanded_detail: existing,
      cached: true,
      prior_concepts: priorConceptsForResponse,
    });
  }

  // ── Phase-1 helpers: layer + parent-objective context in two calls
  //    that used to be ~50 lines of inline code (resolved layer slug
  //    + sub-objective title walk + parent goal description fallback +
  //    annotation fetch with root-goal recovery). Same behavior. ──
  const layer: LayerSlug = await resolveEntityLayer(
    db,
    entity.layer_ontology_id,
  );
  const {
    subObjectiveTitle,
    coreObjectiveText,
    annotations,
  } = await resolveParentObjectiveContext(db, entity, space);

  // ── Load room pain + outcome titles for P2 ranking context ──
  // Variations score against the room's actual lane content, not
  // a guess. Only fetched when there's a sub-objective; empty
  // arrays fall through to default-fallback ranks in the cleaner.
  const roomPains: string[] = [];
  const roomOutcomes: string[] = [];
  if (entity.parent_sub_objective_id) {
    const { data: laneRows } = await db
      .from("entities")
      .select("name, layer_ontology_id, entity_type")
      .eq("parent_sub_objective_id", entity.parent_sub_objective_id);
    if (Array.isArray(laneRows)) {
      for (const r of laneRows as Array<{
        name: string;
        entity_type: string;
      }>) {
        if (r.entity_type === "pain_point") roomPains.push(r.name);
        else if (r.entity_type === "outcome") roomOutcomes.push(r.name);
      }
    }
  }

  // ── Build RAG block from space-level research ──
  const surface = (space.surface_research as SurfaceBundle | null) ?? null;
  const deep = (space.deep_research as DeepBundle | null) ?? null;
  const ragBlock = buildRagBlock(surface, deep, {
    maxSources: 8,
    maxCharsPerSnippet: 400,
  });

  // ── Polish-4: cross-system signals fed back into generation ──
  // Two soft signals, both gracefully absent when no data:
  //   1. Variation-kind preferences (decision_log, ≥10 events req'd)
  //   2. Distilled themes (Distill analysis cache, ≥1 finding)
  // Loaded in parallel; both soft-fail to undefined so generation
  // continues without them in cold-start states.
  const variationKindPrefsRaw =
    await getUserVariationKindPreferences(db, auth.user.id);
  const variationKindPreferences = variationKindSignalIsLive(
    variationKindPrefsRaw,
    10,
  )
    ? variationKindPrefsRaw.map((p) => ({
        kind: p.kind,
        elects: p.elects,
        rejects: p.rejects,
        rate: p.rate,
      }))
    : undefined;

  // Distilled themes are persisted on space.synthesis_data
  // .cross_room_analysis.findings (written by the analysis run
  // route). We filter to distill_concepts findings only. When the
  // analysis hasn't been run (or has been but produced nothing),
  // distillThemes is undefined and no block is injected.
  const crossRoomAnalysis = (space.synthesis_data as Record<string, unknown> | null)
    ?.cross_room_analysis as CrossRoomAnalysisState | undefined;
  const distillFindings =
    crossRoomAnalysis?.findings?.filter(
      (f) => f.analysis_key === "distill_concepts",
    ) ?? [];
  const distillThemes =
    distillFindings.length > 0
      ? distillFindings.map((f) => {
          const body = f.body as Record<string, unknown>;
          return {
            name:
              typeof body?.name === "string"
                ? body.name
                : f.title,
            description:
              typeof body?.description === "string"
                ? body.description
                : f.summary,
          };
        })
      : undefined;

  // priorConcepts was loaded at the top of the route so cache hits
  // can include them in the response too. Reused as-is here for the
  // generator context — the variable was declared above the cache
  // short-circuit.

  // ── Lazy upstream-read — load the cards that FEED this one ──
  // For a feature card, upstream = pains the feature addresses (edges
  // where target=this_feature, source.layer=pain). For an outcome
  // card, upstream = features that produce it (edges where target=
  // this_outcome, source.layer=feature) plus pains whose absence IS
  // the outcome (same target, source.layer=pain).
  //
  // Pain + objective layers have no canonical upstream in this
  // model — pains are the root of the chain, objective is the
  // umbrella. Skip the fetch for them.
  //
  // Soft-fail throughout: if any query errors or returns nothing,
  // upstreamContext is undefined and the prompt block is omitted.
  const upstreamContext = await (async () => {
    if (layer !== "features" && layer !== "outcomes") return undefined;
    if (!entity.parent_sub_objective_id) return undefined;
    // Find edges where this entity is the TARGET (upstream items
    // point AT this card via correlation edges).
    const { data: incomingEdges } = await db
      .from("edges")
      .select("source_entity_id")
      .eq("parent_sub_objective_id", entity.parent_sub_objective_id)
      .eq("target_entity_id", entity.id);
    const sourceIds = Array.isArray(incomingEdges)
      ? (incomingEdges as Array<{ source_entity_id: string }>)
          .map((e) => e.source_entity_id)
          .filter((id, i, arr) => arr.indexOf(id) === i) // dedupe
      : [];
    if (sourceIds.length === 0) return undefined;
    // Hydrate the source entities + their expanded_detail + layer.
    const { data: sourceRows } = await db
      .from("entities")
      .select("id, name, layer_ontology_id, expanded_detail")
      .in("id", sourceIds);
    if (!Array.isArray(sourceRows) || sourceRows.length === 0) return undefined;
    // Resolve layer slugs in one query for efficiency.
    const layerIds = (
      sourceRows as Array<{ layer_ontology_id: string | null }>
    )
      .map((r) => r.layer_ontology_id)
      .filter((id): id is string => typeof id === "string");
    const slugByLayerId = new Map<string, LayerSlug>();
    if (layerIds.length > 0) {
      const { data: layerRows } = await db
        .from("layer_ontology")
        .select("id, slug")
        .in("id", layerIds);
      if (Array.isArray(layerRows)) {
        for (const r of layerRows as Array<{ id: string; slug: string }>) {
          if (
            r.slug === "pain" ||
            r.slug === "features" ||
            r.slug === "outcomes" ||
            r.slug === "objective"
          ) {
            slugByLayerId.set(r.id, r.slug as LayerSlug);
          }
        }
      }
    }
    // Build the context, cap at 4 most-relevant (prefer ones with
    // elections — they carry the strongest signal).
    type UpstreamItem = {
      name: string;
      layer: LayerSlug;
      elected_variation_names: string[];
      expansion_highlights: string[];
    };
    const items: UpstreamItem[] = [];
    for (const row of sourceRows as Array<{
      id: string;
      name: string;
      layer_ontology_id: string | null;
      expanded_detail: ExpandedItemDetail | null;
    }>) {
      const upstreamLayer = row.layer_ontology_id
        ? slugByLayerId.get(row.layer_ontology_id) ?? "features"
        : "features";
      const ed = row.expanded_detail ?? null;
      const electedNames: string[] = Array.isArray(ed?.variations)
        ? ed!.variations
            .filter((v) => v.disposition === "elected")
            .map((v) => v.name)
        : [];
      const highlights: string[] = Array.isArray(ed?.expansion_tree)
        ? ed!.expansion_tree
            .filter((n) => n.disposition === "kept")
            .slice(0, 3)
            .map((n) => n.title)
        : [];
      items.push({
        name: row.name,
        layer: upstreamLayer,
        elected_variation_names: electedNames,
        expansion_highlights: highlights,
      });
    }
    // Sort: items with elections first, then with kept expansion
    // nodes, then everything else. Cap at 4 to bound token cost.
    items.sort((a, b) => {
      const aSignal =
        a.elected_variation_names.length * 2 + a.expansion_highlights.length;
      const bSignal =
        b.elected_variation_names.length * 2 + b.expansion_highlights.length;
      return bSignal - aSignal;
    });
    return items.slice(0, 4);
  })();

  // ── Closed read loop: tested briefs ──
  // On force-regen (cache miss with prior expanded_detail), pull the
  // concluded prototype briefs from the existing detail so the
  // regenerated variations respect what the user has already learned.
  // First-time expansion → `existing` is null → testedBriefs stays
  // undefined → block silently omitted in the prompt.
  //
  // Filters:
  //   • status === "concluded" — anything other states are still
  //     in-flight, no learned outcome to reference yet
  //   • result_summary present + non-empty — the user must have
  //     actually written down what they learned
  //   • Variation must still exist in the (prior) variations list —
  //     orphan briefs (variation was deleted) are dropped
  // Most-recent first; cap at 4 to bound token cost.
  type TestedBrief = NonNullable<
    Parameters<typeof expandItemDetail>[0]["testedBriefs"]
  >[number];
  const testedBriefs: TestedBrief[] = (() => {
    const briefs = existing?.prototype_briefs ?? [];
    const variations = existing?.variations ?? [];
    if (briefs.length === 0 || variations.length === 0) return [];
    const variationNameById = new Map(
      variations
        .filter((v): v is { id: string; name: string } & typeof v =>
          typeof (v as { id?: unknown }).id === "string",
        )
        .map((v) => [v.id, v.name] as const),
    );
    const out: TestedBrief[] = [];
    for (const b of briefs) {
      if (b.status !== "concluded") continue;
      const result = typeof b.result_summary === "string"
        ? b.result_summary.trim()
        : "";
      if (result.length === 0) continue;
      const variationName = variationNameById.get(b.variation_id);
      if (!variationName) continue;
      out.push({
        variation_name: variationName,
        open_question: b.open_question,
        signal_to_watch: b.signal_to_watch,
        learning_target: b.learning_target,
        result_summary: result,
        status_updated_at: b.status_updated_at,
      });
    }
    // Newest first by status_updated_at, fallback to generated_at.
    out.sort((a, b) => {
      const aT = a.status_updated_at ?? "";
      const bT = b.status_updated_at ?? "";
      return bT.localeCompare(aT);
    });
    return out.slice(0, 4);
  })();

  // ── Run the expansion LLM call ──
  let detail: ExpandedItemDetail;
  try {
    detail = await expandItemDetail({
      layer,
      name: entity.name,
      causalChain: (entity.causal_chain as Record<string, unknown>) ?? {},
      subObjectiveTitle,
      coreObjectiveText,
      ragBlock,
      annotations: annotations.length > 0 ? annotations : undefined,
      roomPains,
      roomOutcomes,
      constraints: readConstraints(space.synthesis_data),
      variationKindPreferences,
      distillThemes,
      priorConcepts,
      upstreamContext,
      testedBriefs: testedBriefs.length > 0 ? testedBriefs : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "expansion failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // ── Persist ──
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: detail })
    .eq("id", entityId);
  if (writeRes.error) {
    console.warn(
      "[item/expand] failed to persist expanded_detail:",
      writeRes.error.message,
    );
  }

  return NextResponse.json({
    expanded_detail: detail,
    prior_concepts: priorConceptsForResponse,
  });
}

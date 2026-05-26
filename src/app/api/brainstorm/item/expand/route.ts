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
import { loadUpstreamContext } from "@/lib/objective-canvas/upstream-context";
import {
  computeUpstreamStaleness,
  computeCompositionStaleness,
  computeBriefStaleness,
  NO_STALENESS,
  type UpstreamStaleness,
} from "@/lib/objective-canvas/upstream-staleness";
import { instrumentedLLMCall } from "@/lib/objective-canvas/record-llm-call";

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
    // Soft-staleness — even when we hit the cache, run the upstream
    // staleness check so the drawer can surface a "refresh from
    // upstream" affordance when upstream has mutated since this
    // detail was generated. Cheap: ≤3 small queries, all soft-fail
    // to NO_STALENESS. Skipped when downstream has no
    // parent_sub_objective_id (orphan / root entity).
    let upstreamStaleness: UpstreamStaleness = NO_STALENESS;
    if (
      entity.parent_sub_objective_id &&
      typeof existing.generated_at === "string"
    ) {
      upstreamStaleness = await computeUpstreamStaleness({
        db,
        downstreamEntityId: entity.id,
        parentSubObjectiveId: entity.parent_sub_objective_id,
        downstreamGeneratedAt: existing.generated_at,
      });
    }

    // Composition + brief staleness — only computed when the cache
    // actually carries those artifacts. Lets the drawer surface
    // staleness banners IMMEDIATELY on open (single round-trip),
    // without waiting for the user to click Recompose / Design
    // experiment first. Same 3-query / soft-fail shape so the cost
    // is bounded even when both artifacts exist.
    let compositionStaleness: UpstreamStaleness | null = null;
    let briefStaleness: Record<string, UpstreamStaleness> | null = null;
    if (
      entity.parent_sub_objective_id &&
      typeof existing.generated_at === "string"
    ) {
      const cd = existing.composed_design ?? null;
      if (cd && typeof cd.generated_at === "string") {
        compositionStaleness = await computeCompositionStaleness({
          db,
          downstreamEntityId: entity.id,
          downstreamEntityName:
            typeof entity.name === "string" ? entity.name : "this item",
          parentSubObjectiveId: entity.parent_sub_objective_id,
          compositionGeneratedAt: cd.generated_at,
          expandedDetailGeneratedAt: existing.generated_at,
        });
      }
      const briefs = Array.isArray(existing.prototype_briefs)
        ? existing.prototype_briefs
        : [];
      if (briefs.length > 0) {
        const map: Record<string, UpstreamStaleness> = {};
        for (const b of briefs) {
          if (typeof b?.generated_at !== "string") continue;
          // Keyed by brief id so the client can match per-brief
          // without us imposing a question-text key (briefs are
          // uniquely identified by id, not by open_question text).
          map[b.id] = await computeBriefStaleness({
            db,
            downstreamEntityId: entity.id,
            downstreamEntityName:
              typeof entity.name === "string" ? entity.name : "this item",
            parentSubObjectiveId: entity.parent_sub_objective_id,
            briefGeneratedAt: b.generated_at,
            expandedDetailGeneratedAt: existing.generated_at,
            composedDesignGeneratedAt: cd?.generated_at ?? null,
          });
        }
        briefStaleness = map;
      }
    }

    return NextResponse.json({
      expanded_detail: existing,
      cached: true,
      prior_concepts: priorConceptsForResponse,
      upstream_staleness: upstreamStaleness,
      composition_staleness: compositionStaleness,
      brief_staleness: briefStaleness,
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

  // ── Closed read loop: cross-room structural findings ──
  // Today the workbench detects shared mechanisms / annotation
  // overlaps / contradictions / duplicate variations / uncovered
  // pains and ranks them for the strip — but the next time a user
  // opens THIS item's drawer to (re)generate variations, the LLM
  // has no idea those patterns exist. Result: variations re-invent
  // a parallel mechanism the workbench just named "shared", or
  // duplicate a sibling room's elected pattern, or re-extend a
  // contradiction the user is already trying to resolve.
  //
  // Filter:
  //   • drop disposition resolved / dismissed — user closed the
  //     signal, do not re-inject as fresh prompt context
  //   • drop distill_concepts — already flows via distillThemes
  //   • drop orphan_annotations + recommend_next_move — space-level /
  //     meta findings, not item-shaping
  //   • for pain_coverage, require ITEM match (uncovered-pain alerts
  //     are noise on a non-pain item's expansion)
  //   • for everything else, accept item OR room match — room-level
  //     redundancy still informs this item's variations
  //
  // Normalize each surviving finding to the LLM-facing shape — a
  // uniform { kind, title, summary, hint? } that the generator's
  // CROSS-ROOM SIGNALS block templates over. The hint pulls the
  // load-bearing fact out of the heterogeneous finding body (mechanism
  // text / contradiction partner / duplicate variation name / etc.).
  type CrossRoomFinding = NonNullable<
    Parameters<typeof expandItemDetail>[0]["crossRoomFindings"]
  >[number];
  const crossRoomFindings: CrossRoomFinding[] = (() => {
    const findings = crossRoomAnalysis?.findings ?? [];
    if (findings.length === 0) return [];
    const roomId = entity.parent_sub_objective_id;
    const itemId = entity.id;
    const out: CrossRoomFinding[] = [];
    for (const f of findings) {
      if (f.disposition === "resolved" || f.disposition === "dismissed") continue;
      if (f.analysis_key === "distill_concepts") continue;
      // Space-level / meta signals — not the right surface to inject
      // into per-item generation context.
      if (
        f.analysis_key === "orphan_annotations" ||
        f.analysis_key === "recommend_next_move"
      ) {
        continue;
      }

      const itemMatches = f.references.item_ids.includes(itemId);
      const roomMatches = !!roomId && f.references.room_ids.includes(roomId);

      if (f.analysis_key === "pain_coverage") {
        if (!itemMatches) continue;
      } else {
        if (!itemMatches && !roomMatches) continue;
      }

      const body = (f.body ?? {}) as Record<string, unknown>;
      if (f.analysis_key === "shared_mechanisms") {
        const mech = typeof body.mechanism === "string" ? body.mechanism : "";
        out.push({
          kind: "shared_mechanism",
          title: f.title,
          summary: f.summary,
          hint: mech ? `lever name: "${mech}"` : undefined,
        });
      } else if (f.analysis_key === "annotation_overlap") {
        const phrase = typeof body.phrase === "string" ? body.phrase : "";
        out.push({
          kind: "annotation_overlap",
          title: f.title,
          summary: f.summary,
          hint: phrase ? `lens phrase: "${phrase}"` : undefined,
        });
      } else if (f.analysis_key === "pain_coverage") {
        const kindStr = typeof body.kind === "string" ? body.kind : "";
        if (kindStr === "uncovered") {
          out.push({
            kind: "pain_uncovered",
            title: f.title,
            summary: f.summary,
            hint: "no feature in any room currently addresses this — your variations should each propose a counter",
          });
        } else if (kindStr === "cross_addressed") {
          const count =
            typeof body.addresser_count === "number"
              ? body.addresser_count
              : 0;
          out.push({
            kind: "pain_cross_addressed",
            title: f.title,
            summary: f.summary,
            hint:
              count > 0
                ? `addressed by ${count} feature(s) in OTHER rooms — coordinate or differentiate`
                : undefined,
          });
        }
      } else if (f.analysis_key === "duplicate_variations") {
        const vname =
          typeof body.variation_name === "string" ? body.variation_name : "";
        const elected =
          typeof body.elected_room_count === "number"
            ? body.elected_room_count
            : 0;
        out.push({
          kind: "duplicate_variation",
          title: f.title,
          summary: f.summary,
          hint: vname
            ? elected >= 1
              ? `duplicate "${vname}" already ELECTED in ${elected} room(s) — propose differentiation`
              : `duplicate "${vname}" — propose differentiation`
            : undefined,
        });
      } else if (f.analysis_key === "cross_room_contradictions") {
        // body.pair = [{room_id, room_title, item_id, item_name, ...}, ...]
        // When THIS entity is one member, surface the OTHER member as
        // the contradiction partner. When matched via room only (this
        // entity isn't in the pair), still emit — the room-level
        // contradiction is context worth carrying.
        const pair = Array.isArray(body.pair)
          ? (body.pair as Array<Record<string, unknown>>)
          : [];
        const other = pair.find((p) => p?.item_id !== itemId) ?? pair[1];
        const otherVar =
          other && typeof other.variation_name === "string"
            ? other.variation_name
            : "";
        const otherRoom =
          other && typeof other.room_title === "string"
            ? other.room_title
            : "";
        out.push({
          kind: "contradiction",
          title: f.title,
          summary: f.summary,
          hint:
            otherVar && otherRoom
              ? `contradicts "${otherVar}" in "${otherRoom}"`
              : otherVar
                ? `contradicts "${otherVar}"`
                : undefined,
        });
      }
      // (Anything else — silently skip. New analysis_keys land in
      //  the strip first; opt them into this loop by adding a case.)
    }
    return out;
  })();

  // priorConcepts was loaded at the top of the route so cache hits
  // can include them in the response too. Reused as-is here for the
  // generator context — the variable was declared above the cache
  // short-circuit.

  // ── Lazy upstream-read — load the cards that FEED this one ──
  // Layer-gated: features/outcomes/objective have canonical upstream
  // (pains → features → outcomes → objective). Pains are graph roots
  // with no incoming edges by design, so we skip the query for them.
  //
  // Shared helper does the edge walk + entity hydration + layer
  // resolution + signal ranking. Returns undefined when no incoming
  // edges exist or every query soft-fails — the prompt block stays
  // omitted on undefined.
  const upstreamContext =
    (layer === "features" || layer === "outcomes" || layer === "objective") &&
    entity.parent_sub_objective_id
      ? await loadUpstreamContext({
          db,
          downstreamEntityId: entity.id,
          parentSubObjectiveId: entity.parent_sub_objective_id,
          limit: 4,
        })
      : undefined;

  // ── Phase 3 — Lateral (sibling) context ──
  // Same-layer items in the SAME room. These don't causally feed
  // THIS card via edges, but they co-exist in the user's mental
  // model. When a sibling has elected variations or kept expansion
  // nodes, the variation generator should compose-with /
  // differentiate-from / interfere-with that sibling instead of
  // silently duplicating its design choices.
  //
  // Filtered to siblings WITH active signal — siblings that have
  // never been opened add no value and would just bloat the prompt.
  // Capped at 3 most-active by the same signal weight as upstream.
  //
  // Soft-fail throughout: any query error → empty array → block
  // omitted.
  const lateralContext = await (async () => {
    if (!entity.parent_sub_objective_id) return undefined;
    if (!entity.layer_ontology_id) return undefined;
    const { data: laneRows } = await db
      .from("entities")
      .select("id, name, expanded_detail")
      .eq("parent_sub_objective_id", entity.parent_sub_objective_id)
      .eq("layer_ontology_id", entity.layer_ontology_id)
      .neq("id", entity.id);
    if (!Array.isArray(laneRows) || laneRows.length === 0) return undefined;
    type LateralItem = {
      name: string;
      elected_variation_names: string[];
      expansion_highlights: string[];
    };
    const items: LateralItem[] = [];
    for (const row of laneRows as Array<{
      id: string;
      name: string;
      expanded_detail: ExpandedItemDetail | null;
    }>) {
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
      // Drop siblings with no active signal — keep the prompt lean.
      if (electedNames.length === 0 && highlights.length === 0) continue;
      items.push({
        name: row.name,
        elected_variation_names: electedNames,
        expansion_highlights: highlights,
      });
    }
    if (items.length === 0) return undefined;
    items.sort((a, b) => {
      const aSignal =
        a.elected_variation_names.length * 2 + a.expansion_highlights.length;
      const bSignal =
        b.elected_variation_names.length * 2 + b.expansion_highlights.length;
      return bSignal - aSignal;
    });
    return items.slice(0, 3);
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

  // ── Run the expansion LLM call (telemetry-wrapped) ──
  // instrumentedLLMCall measures latency, captures status + error
  // message, and fire-and-forget inserts into llm_call_log so quality
  // measurement has a row for every drawer expansion. artifact_kind
  // 'expanded_detail' + entity.id lets the feedback endpoint locate
  // this log row when the user thumbs-rates the variation card.
  let detail: ExpandedItemDetail;
  try {
    detail = await instrumentedLLMCall(
      {
        db,
        userId: auth.user.id,
        spaceId: entity.space_id,
        callSite: "expand_item_detail",
        modelHint: "gpt-4o",
        artifactKind: "expanded_detail",
        artifactId: entity.id,
        metadata: {
          layer,
          had_lens: annotations.length > 0,
          had_upstream: (upstreamContext?.length ?? 0) > 0,
          had_upstream_edge_content:
            (upstreamContext ?? []).some((u) => !!u.edge_mechanism),
          had_lateral: (lateralContext?.length ?? 0) > 0,
          had_constraints: !!readConstraints(space.synthesis_data),
          had_prior_concepts: !!priorConcepts,
          cross_room_finding_count: crossRoomFindings.length,
          // Distinct kinds present — useful to see which structural
          // signals are routinely shaping output across users.
          cross_room_finding_kinds: Array.from(
            new Set(crossRoomFindings.map((f) => f.kind)),
          ),
        },
      },
      () =>
        expandItemDetail({
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
          lateralContext,
          testedBriefs: testedBriefs.length > 0 ? testedBriefs : undefined,
          crossRoomFindings:
            crossRoomFindings.length > 0 ? crossRoomFindings : undefined,
        }),
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "expansion failed",
        detail: sanitizeErrorMessage(err),
      },
      { status: 500 },
    );
  }

  // ── Persist (merge — preserve user-owned artifacts) ──
  // The detail returned from expandItemDetail contains LLM-owned
  // fields (definition, variations, planning, generated_at). Naively
  // writing it would wipe USER-OWNED fields the user has accumulated
  // via separate routes:
  //
  //   • prototype_briefs  — generated via /item/variation/prototype,
  //                          carry irreplaceable user-written
  //                          result_summary on concluded briefs
  //   • expansion_tree    — user-spawned L3+ deep-dive nodes with
  //                          kept/parked disposition (user-elected work)
  //   • variation dispositions — user's elect/defer/reject choices on
  //                          variations. The LLM emits new variations
  //                          with disposition=null; we re-anchor by
  //                          NAME so elections survive when the same
  //                          named variation comes back.
  //
  // composed_design is INTENTIONALLY wiped — it references
  // source_variation_ids that may no longer match (the new variation
  // set may differ) and election state gets re-anchored below. User
  // can re-compose if they re-elect.
  //
  // Variation id is now slug-based (variationId(name) → "v_<slug>"),
  // so identical names across regen produce identical ids → briefs
  // and expansion_tree anchored via variation_id keep their links
  // when the LLM returns the same concept. References on RENAMED
  // variations become orphans; UI will surface or hide them.
  const oldVariationsByName = new Map(
    (existing?.variations ?? [])
      .filter((v): v is { id?: string; name: string; disposition?: unknown } & typeof v =>
        typeof v.name === "string",
      )
      .map((v) => [v.name.trim().toLowerCase(), v] as const),
  );
  const variationsWithReanchoredElections = detail.variations.map((v) => {
    const prior = oldVariationsByName.get(v.name.trim().toLowerCase());
    // Only re-anchor non-null dispositions — preserves the user's
    // intentional elections without manufacturing them.
    if (prior?.disposition && prior.disposition !== null) {
      return { ...v, disposition: prior.disposition };
    }
    return v;
  });

  const merged: ExpandedItemDetail = {
    ...detail,
    variations: variationsWithReanchoredElections,
    // Preserve user-owned bags when present; otherwise inherit
    // whatever the LLM returned (which is typically undefined).
    prototype_briefs:
      existing?.prototype_briefs && existing.prototype_briefs.length > 0
        ? existing.prototype_briefs
        : detail.prototype_briefs,
    expansion_tree:
      existing?.expansion_tree && existing.expansion_tree.length > 0
        ? existing.expansion_tree
        : detail.expansion_tree,
    // Intentional wipe: composed_design depends on the elected
    // variation set, which changes on regen. User re-composes from
    // their re-anchored elections.
    composed_design: null,
  };

  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: merged })
    .eq("id", entityId);
  if (writeRes.error) {
    console.warn(
      "[item/expand] failed to persist expanded_detail:",
      writeRes.error.message,
    );
  }

  // Fresh-generation response — by construction NOT stale (we just
  // pulled fresh upstream context via upstreamContext above). Include
  // NO_STALENESS so the client payload shape stays consistent
  // across cache-hit + fresh paths and the drawer doesn't have to
  // branch on presence of the field.
  //
  // Return MERGED (not raw `detail`) so the client sees re-anchored
  // elections + preserved briefs / expansion_tree alongside the fresh
  // definition / variations / planning.
  return NextResponse.json({
    expanded_detail: merged,
    prior_concepts: priorConceptsForResponse,
    upstream_staleness: NO_STALENESS,
  });
}

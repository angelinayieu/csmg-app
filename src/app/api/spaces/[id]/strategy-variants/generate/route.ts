// POST /api/spaces/[id]/strategy-variants/generate
//
// E3b — user-triggered layer-stratified variant generation.
//
// The user clicks "Generate strategy for this layer" on the canvas
// layer toggle (or the strategy page's variants section) → this route
// fires. We resolve the requested layer slug against the space's layer
// ontology, invoke the strategy engine with `layerFocus` set, append
// the resulting variant to `synthesis_data.strategic_recommendation.
// ranked_strategies[]`, and return the new entry so the caller can
// trigger a canvas reseed.
//
// Body: { layer_focus_slug: string; rationale?: string }
//
// The rationale field is optional — when omitted, we synthesize a
// short default tied to the layer's label. The LLM sees this verbatim
// in the prompt's LAYER FOCUS DIRECTIVE block, so user-provided
// rationales bias the output more sharply than the generic default.
//
// Soft-fail boundary: the variant generation can take 20-40s. The
// route returns 202 on accept with a job id later, OR runs inline and
// returns 200 with the new variant. For now we go inline because the
// engine call already happens inline elsewhere; if latency becomes a
// concern, swap to `after()` + poll pattern matching the twin-proposal
// approve route.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import type { Entity, Edge, Cycle, Space } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";
import type {
  RankedStrategy,
  StrategicRecommendation,
} from "@/types/strategy";
import type { StrategyPipelineContext } from "@/lib/prompts/strategic-recommendation";
import type { LayerOntologyRow, LayerDependencyRow } from "@/types/layer-ontology";
import { generateMultiStepStrategy } from "@/lib/pipeline/strategy-engine";
import { resolveSpaceLayers } from "@/lib/whiteboard/resolve-entity-layer";
import { loadLayerCascades } from "@/lib/pipeline/cross-layer-cascade-prediction";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RequestBody {
  layer_focus_slug?: string;
  rationale?: string;
}

export interface StrategyVariantGenerateResponse {
  /** The new variant appended to ranked_strategies. */
  variant: RankedStrategy;
  /** Total count of ranked strategies AFTER appending. */
  total_ranks: number;
  /** Echo of the layer focus actually used (resolver may have looked up
   *  label/color from the slug). Useful for the client to update the
   *  shape's preview props before the seeder re-fetches. */
  layer_focus: {
    layer_id: string;
    label: string;
    color: string;
    rationale: string;
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const layerFocusSlug = (body as RequestBody | null)?.layer_focus_slug?.trim();
  const userRationale = (body as RequestBody | null)?.rationale?.trim();
  if (!layerFocusSlug) {
    return NextResponse.json(
      { error: "layer_focus_slug is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load everything the engine needs in one parallel round-trip ────
  // The cascade load runs in the same batch so a stratified variant can
  // carry its predicted downstream layers into recommendation.layer_focus
  // .cascade — populated only when the synthesize stage's D-track cascade
  // prediction has materialized rows for this space.
  const [spaceRes, entRes, edgeRes, cycleRes, goalRes, ontologyRes, cascadeRows] =
    await Promise.all([
      db.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
      db
        .from("improvement_goals")
        .select("*")
        .eq("space_id", spaceId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("layer_ontology")
        .select("*")
        .eq("space_id", spaceId)
        .order("ordinal", { ascending: true }),
      loadLayerCascades(db, spaceId, user.id),
    ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const space = spaceRes.data as Space;
  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgeRes.data ?? []) as Edge[];
  const cycles = (cycleRes.data ?? []) as Cycle[];
  const activeGoal = (goalRes?.data ?? null) as ImprovementGoal | null;
  const ontology = (ontologyRes?.data ?? []) as LayerOntologyRow[];
  const cascades = (cascadeRows ?? []) as LayerDependencyRow[];

  // ── Resolve the layer slug to a full focus struct ──────────────────
  // The resolver returns ResolvedLayer[] with fallbacks for spaces
  // without an ontology configured; we find the row whose id matches
  // the slug. 404 if the user requests a slug we don't recognize —
  // better to fail loud than silently produce a "comprehensive" variant
  // labeled as something it isn't.
  const resolvedLayers = resolveSpaceLayers(ontology, { fallback: "knowledge" });
  const targetLayer = resolvedLayers.find((l) => l.id === layerFocusSlug);
  if (!targetLayer) {
    return NextResponse.json(
      {
        error: `Layer "${layerFocusSlug}" is not in this space's resolved layer set. Available: ${resolvedLayers.map((l) => l.id).join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Synthesis_data is required — without it the engine has nothing to
  // ground the variant against. Stratifying a brand-new space (no
  // synthesis yet) doesn't make sense.
  const synthesis = ((): SynthesisData | null => {
    const raw = (space as unknown as { synthesis_data?: unknown })
      .synthesis_data ?? null;
    if (raw && typeof raw === "object") return raw as SynthesisData;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as SynthesisData;
      } catch {
        return null;
      }
    }
    return null;
  })();
  if (!synthesis) {
    return NextResponse.json(
      {
        error:
          "Space has no synthesis_data yet — run a base strategy generation first before requesting a layer-stratified variant.",
      },
      { status: 409 },
    );
  }

  // ── Build engine params (minimal) ──────────────────────────────────
  // entityNameMap: entity_id (string slug) → display name. The engine
  // uses this to substitute names in the prompt where it would
  // otherwise show entity codes.
  const entityNameMap = new Map<string, string>();
  for (const e of entities) entityNameMap.set(e.entity_id, e.name);

  const pipelineCtx: StrategyPipelineContext = {};

  // Synthesize a rationale when the caller didn't supply one. The
  // default ties the focus to the layer's description from the
  // ontology — domain-adapted automatically.
  const rationale =
    userRationale && userRationale.length > 0
      ? userRationale
      : `Stratify the strategy to emphasize the ${targetLayer.label} layer. ${targetLayer.description || "Surface entities, tactics, and infrastructure that center this layer of the user's domain ontology — making this variant directly comparable against variants focused on other layers."}`;

  const layerFocus = {
    layer_id: targetLayer.id,
    label: targetLayer.label,
    color: targetLayer.color,
    rationale,
  };

  // ── Invoke the engine ──────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof generateMultiStepStrategy>>;
  try {
    result = await generateMultiStepStrategy({
      synthesis,
      entities,
      edges,
      cycles,
      entityNameMap,
      pipelineCtx,
      activeGoal,
      layerFocus,
    });
  } catch (err) {
    console.error("[strategy-variants/generate] engine call failed:", err);
    return NextResponse.json(
      {
        error: "Strategy engine call failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // ── D-track Phase β: patch cascade payload onto layer_focus ───────
  // The engine's prompt directive sets recommendation.layer_focus with
  // { layer_id, label, color, rationale }, but it doesn't know about
  // the persisted cross-layer cascades (those are space-level
  // knowledge, not engine-input). We patch them in here so the strategy
  // hero card + variant card can render the ripple chip strip
  // ("Behaviors → Biomarkers · 3 weeks → Cognitive · 3 months").
  //
  // Filter to cascades originating from the focused layer; build the
  // affected_layers array against the resolved layer set so each entry
  // carries label + color the UI needs.
  const outgoingCascades = cascades.filter(
    (c) => c.from_layer_id === targetLayer.id,
  );
  const affectedLayers = outgoingCascades
    .map((c) => {
      const dest = resolvedLayers.find((l) => l.id === c.to_layer_id);
      if (!dest) return null;
      // Predicted-change is free text. Prefer evidence_summary when the
      // LLM gave one; fall back to mechanism (always present per the
      // module's validation).
      const predicted_change =
        c.evidence_summary && c.evidence_summary.length > 0
          ? c.evidence_summary
          : c.mechanism;
      return {
        layer_id: dest.id,
        label: dest.label,
        color: dest.color,
        kind: c.kind,
        strength: c.strength,
        lag_label: c.lag_label,
        predicted_change,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    // Sort by strength desc so the highest-impact ripple chip leads the
    // strip. UI may truncate to top 3 visually but receives the full set.
    .sort((a, b) => b.strength - a.strength);

  const cascadePayload =
    affectedLayers.length > 0
      ? {
          affected_layers: affectedLayers,
          rationale: `${affectedLayers.length} downstream layer${affectedLayers.length === 1 ? "" : "s"} predicted to ripple from ${targetLayer.label}.`,
        }
      : null;

  // Mutate the engine's recommendation in place — its layer_focus block
  // was set by the prompt directive but lacks cascade context.
  if (result.recommendation.layer_focus) {
    result.recommendation.layer_focus = {
      ...result.recommendation.layer_focus,
      cascade: cascadePayload,
    };
  }

  // ── Build the new RankedStrategy + append to synthesis_data ─────────
  // We append rather than replace: the comprehensive (rank 1) variant
  // stays at rank 1; layer-stratified variants slot in at the next
  // available rank. Rank order is composite-score-based in the engine's
  // internal ranking, but for the round-trip here we trust the engine's
  // primary recommendation as rank N+1 where N = current count.
  const wrapper = (synthesis as unknown as {
    strategic_recommendation?: {
      ranked_strategies?: RankedStrategy[];
      recommendation?: StrategicRecommendation;
    };
  }).strategic_recommendation ?? {};

  const existing = Array.isArray(wrapper.ranked_strategies)
    ? wrapper.ranked_strategies
    : [];

  const newVariant: RankedStrategy = {
    rank: existing.length + 1,
    recommendation: result.recommendation,
    ranking_rationale: `Layer-stratified variant emphasizing ${targetLayer.label}. ${rationale}`,
    infrastructure_proposals: result.rankedStrategies?.[0]?.infrastructure_proposals ?? [],
    tradeoff_vs_top:
      "Trades comprehensive coverage for sharper focus on a single layer of the domain ontology — making cross-layer comparison legible.",
  };
  const updatedRanked = [...existing, newVariant];

  // ── Persist ─────────────────────────────────────────────────────────
  // Re-pack synthesis_data with the appended ranked_strategies array.
  // We deliberately leave the rest of synthesis_data unchanged (the
  // engine's internal updates to other fields like reasoning_trace
  // would clobber the original strategy's trace).
  const updatedSynth = {
    ...(synthesis as unknown as Record<string, unknown>),
    strategic_recommendation: {
      ...wrapper,
      ranked_strategies: updatedRanked,
    },
  };

  const { error: updateErr } = await db
    .from("spaces")
    .update({ synthesis_data: updatedSynth })
    .eq("id", spaceId)
    .eq("user_id", user.id);

  if (updateErr) {
    console.error(
      "[strategy-variants/generate] synthesis_data persist failed:",
      updateErr,
    );
    return NextResponse.json(
      { error: "Failed to persist new variant", detail: updateErr.message },
      { status: 500 },
    );
  }

  const payload: StrategyVariantGenerateResponse = {
    variant: newVariant,
    total_ranks: updatedRanked.length,
    layer_focus: layerFocus,
  };
  return NextResponse.json(payload);
}

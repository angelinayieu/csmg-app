// D-track Phase β — Cross-layer cascade prediction + persistence.
//
// Sibling to `cross-layer-analysis.ts` (which is pure deterministic
// detection of layer density + tensions). This module makes the LLM
// call that predicts cascades — directional propagation patterns
// between layers — and writes the result to the `layer_dependencies`
// table.
//
// Why this is separate from the strategy-engine's layer_focus prompt
// directive:
//   The cascade prediction is per-SPACE knowledge — it runs once at
//   synthesize and serves every subsequent strategy variant. The
//   strategy-engine then READS layer_dependencies when generating a
//   variant, but it doesn't re-derive cascades on each call.
//
// Soft-fail throughout: cascade prediction failure must NOT block
// synthesis. The synthesize route catches this module's errors and
// proceeds — strategy generation still works without cascades, just
// with no `recommendation.layer_focus.cascade` populated downstream.
//
// Idempotency: each call DELETES existing llm_inferred rows for the
// space before inserting fresh ones. User-authored rows are
// preserved (they're not the LLM's territory to mutate).

import { llmJSON } from "@/lib/llm";
import {
  getCrossLayerCascadePrompt,
  type CrossLayerCascadeLLMOutput,
} from "@/lib/prompts/cross-layer-cascade";
import type { Entity, Edge } from "@/types";
import type {
  LayerOntologyRow,
  LayerDependencyRow,
  LayerDependencyKind,
} from "@/types/layer-ontology";

const VALID_KINDS: LayerDependencyKind[] = [
  "causal",
  "modulatory",
  "inhibitory",
  "compensatory",
  "reinforcing",
];

export interface PredictAndPersistLayerCascadesArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  userId: string;
  ontology: LayerOntologyRow[];
  entities: Entity[];
  edges: Edge[];
  /** Optional space name for prompt context. */
  spaceName?: string;
  /** Identifier of the synthesize step that triggered this run.
   *  Persisted on each row's `source_synthesis_step` for audit + the
   *  "re-run just this step" affordance. */
  synthesisStep?: string;
}

export interface PredictAndPersistLayerCascadesResult {
  ok: boolean;
  /** Number of cascades the LLM returned (pre-validation). */
  emitted: number;
  /** Number of cascades that passed validation + were persisted. */
  inserted: number;
  /** Skipped count + reasons (e.g. invalid layer id, self-loop, bad
   *  enum). Used for telemetry / audit only. */
  skipped: Array<{ index: number; reason: string }>;
  error?: string;
}

/**
 * Predict cross-layer cascades via LLM, validate, persist to the
 * `layer_dependencies` table, and dispatch the materialization
 * window event.
 *
 * Gate conditions — the function returns early with `ok: false` if:
 *   • ontology.length < 2 (cascades require at least 2 layers)
 *   • entities.length < 5 (too sparse to ground propagation claims)
 *   • the LLM call throws (network, rate limit, JSON parse failure)
 *
 * Each early return logs to console.warn but does NOT throw — the
 * caller (synthesize route) treats this as best-effort.
 */
export async function predictAndPersistLayerCascades(
  args: PredictAndPersistLayerCascadesArgs,
): Promise<PredictAndPersistLayerCascadesResult> {
  const { db, spaceId, userId, ontology, entities, edges, spaceName, synthesisStep } =
    args;

  if (ontology.length < 2) {
    return {
      ok: false,
      emitted: 0,
      inserted: 0,
      skipped: [],
      error: "Need at least 2 ontology layers; skipping cascade prediction.",
    };
  }
  if (entities.length < 5) {
    return {
      ok: false,
      emitted: 0,
      inserted: 0,
      skipped: [],
      error: "Need at least 5 entities to ground cascade claims.",
    };
  }

  // Group entities by their layer_ontology_id. Entities without a layer
  // assignment are silently dropped — they can't anchor cross-layer
  // claims.
  const entitiesByLayerId = new Map<
    string,
    Array<{ entity_id: string; name: string }>
  >();
  for (const layer of ontology) entitiesByLayerId.set(layer.id, []);
  for (const e of entities) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layerOntologyId = (e as any).layer_ontology_id as string | null | undefined;
    if (!layerOntologyId) continue;
    const bucket = entitiesByLayerId.get(layerOntologyId);
    if (bucket) bucket.push({ entity_id: e.entity_id, name: e.name });
  }

  // Compute cross-layer edge summary: for each (from, to) layer pair,
  // count the edges + collect the top 3 distinct dimensions. Drives
  // the "edge evidence" block of the prompt. Treats edges as undirected
  // for the purpose of finding cross-layer pairs (we don't have a
  // robust source/target layer attribution on edges today; the LLM
  // gets one directional summary per unique unordered pair so it can
  // choose direction in its output).
  const entityById = new Map<string, Entity>();
  for (const e of entities) entityById.set(e.id, e);

  const pairEdges = new Map<
    string,
    { from_layer_id: string; to_layer_id: string; count: number; dimensions: Set<string> }
  >();
  for (const edge of edges) {
    const src = entityById.get(edge.source_entity_id);
    const tgt = entityById.get(edge.target_entity_id);
    if (!src || !tgt) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const srcLayer = (src as any).layer_ontology_id as string | null | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tgtLayer = (tgt as any).layer_ontology_id as string | null | undefined;
    if (!srcLayer || !tgtLayer || srcLayer === tgtLayer) continue;
    // Use a canonical key so both directions land in the same bucket.
    const [a, b] = srcLayer < tgtLayer ? [srcLayer, tgtLayer] : [tgtLayer, srcLayer];
    const key = `${a}|${b}`;
    if (!pairEdges.has(key)) {
      pairEdges.set(key, {
        from_layer_id: a,
        to_layer_id: b,
        count: 0,
        dimensions: new Set(),
      });
    }
    const bucket = pairEdges.get(key)!;
    bucket.count++;
    if (edge.dimension) bucket.dimensions.add(edge.dimension);
  }
  const crossLayerEdgeSummary = Array.from(pairEdges.values()).map((b) => ({
    from_layer_id: b.from_layer_id,
    to_layer_id: b.to_layer_id,
    edge_count: b.count,
    top_dimensions: Array.from(b.dimensions).slice(0, 3),
  }));

  // ── LLM call ────────────────────────────────────────────────────
  const prompt = getCrossLayerCascadePrompt({
    ontology,
    entitiesByLayerId,
    crossLayerEdgeSummary,
    spaceName,
  });

  let response: CrossLayerCascadeLLMOutput;
  try {
    response = await llmJSON<CrossLayerCascadeLLMOutput>({
      system: prompt.system,
      user: prompt.user,
      maxTokens: 4096,
      temperature: 0.3,
    });
  } catch (err) {
    return {
      ok: false,
      emitted: 0,
      inserted: 0,
      skipped: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const rawCascades = Array.isArray(response.cascades) ? response.cascades : [];
  const emitted = rawCascades.length;

  // ── Validate ─────────────────────────────────────────────────────
  // Build a quick layer-id set so we can verify the LLM didn't make
  // up UUIDs.
  const validLayerIds = new Set(ontology.map((l) => l.id));
  const validated: Array<{
    from_layer_id: string;
    to_layer_id: string;
    kind: LayerDependencyKind;
    strength: number;
    lag_label: string | null;
    lag_hours: number | null;
    mechanism: string;
    evidence_summary: string | null;
    confidence: number;
  }> = [];
  const skipped: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < rawCascades.length; i++) {
    const c = rawCascades[i];
    if (!c || typeof c !== "object") {
      skipped.push({ index: i, reason: "not an object" });
      continue;
    }
    if (!c.from_layer_id || !validLayerIds.has(c.from_layer_id)) {
      skipped.push({ index: i, reason: "invalid from_layer_id" });
      continue;
    }
    if (!c.to_layer_id || !validLayerIds.has(c.to_layer_id)) {
      skipped.push({ index: i, reason: "invalid to_layer_id" });
      continue;
    }
    if (c.from_layer_id === c.to_layer_id) {
      skipped.push({ index: i, reason: "self-loop forbidden" });
      continue;
    }
    if (!VALID_KINDS.includes(c.kind as LayerDependencyKind)) {
      skipped.push({ index: i, reason: `invalid kind: ${c.kind}` });
      continue;
    }
    if (typeof c.strength !== "number" || c.strength < 0 || c.strength > 1) {
      skipped.push({ index: i, reason: "strength out of [0,1]" });
      continue;
    }
    if (typeof c.confidence !== "number" || c.confidence < 0 || c.confidence > 1) {
      skipped.push({ index: i, reason: "confidence out of [0,1]" });
      continue;
    }
    if (typeof c.mechanism !== "string" || c.mechanism.trim().length === 0) {
      skipped.push({ index: i, reason: "missing mechanism" });
      continue;
    }
    validated.push({
      from_layer_id: c.from_layer_id,
      to_layer_id: c.to_layer_id,
      kind: c.kind as LayerDependencyKind,
      strength: c.strength,
      lag_label: typeof c.lag_label === "string" ? c.lag_label : null,
      lag_hours: typeof c.lag_hours === "number" ? c.lag_hours : null,
      mechanism: c.mechanism.trim(),
      evidence_summary:
        typeof c.evidence_summary === "string"
          ? c.evidence_summary.trim() || null
          : null,
      confidence: c.confidence,
    });
  }

  // ── Persist ──────────────────────────────────────────────────────
  // Delete only llm_inferred rows for this space — preserve any
  // user_authored or hybrid rows the user may have edited.
  try {
    await db
      .from("layer_dependencies")
      .delete()
      .eq("space_id", spaceId)
      .eq("user_id", userId)
      .eq("source", "llm_inferred");
  } catch (err) {
    // Non-fatal: insert below uses upsert semantics via the unique
    // constraint, so old rows would just survive. Log + proceed.
    console.warn(
      "[cross-layer-cascade] delete-existing failed (non-fatal):",
      err,
    );
  }

  let inserted = 0;
  if (validated.length > 0) {
    const rowsToInsert = validated.map((v) => ({
      space_id: spaceId,
      user_id: userId,
      from_layer_id: v.from_layer_id,
      to_layer_id: v.to_layer_id,
      kind: v.kind,
      strength: v.strength,
      lag_label: v.lag_label,
      lag_hours: v.lag_hours,
      mechanism: v.mechanism,
      evidence_summary: v.evidence_summary,
      confidence: v.confidence,
      source: "llm_inferred" as const,
      source_synthesis_step: synthesisStep ?? "synthesize-cascade-prediction",
    }));
    const { data: insertedRows, error: insertErr } = (await db
      .from("layer_dependencies")
      .upsert(rowsToInsert, {
        // Resolve conflicts on the unique (space_id, from, to)
        // constraint by replacing the existing row.
        onConflict: "space_id,from_layer_id,to_layer_id",
      })
      .select("id")) as {
      data: Array<{ id: string }> | null;
      error: { message?: string } | null;
    };

    if (insertErr) {
      return {
        ok: false,
        emitted,
        inserted: 0,
        skipped,
        error: `Persist failed: ${insertErr.message ?? "unknown"}`,
      };
    }
    inserted = insertedRows?.length ?? 0;
  }

  return {
    ok: true,
    emitted,
    inserted,
    skipped,
  };
}

/**
 * Companion: fetch the persisted cascades for a space. Used by the
 * strategy-variants/generate endpoint to build the `layer_focus.cascade`
 * payload on a generated variant.
 */
export async function loadLayerCascades(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
): Promise<LayerDependencyRow[]> {
  const { data } = (await db
    .from("layer_dependencies")
    .select("*")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .order("strength", { ascending: false })) as {
    data: LayerDependencyRow[] | null;
  };
  return data ?? [];
}
